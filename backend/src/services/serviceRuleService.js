'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { D, toNumber } = require('../utils/money');
const { hasPermission } = require('../middleware/auth');
const audit = require('./auditService');
const settings = require('./settingsService');
const serviceFinance = require('./serviceFinanceService');
const { normalizeRule, validateRule, bandName, calculateServiceFinancials, FinancialRuleError, deductsProducts } = require('./financialRules');

/**
 * Configuring each service's financial rule (Services → service → Financial
 * rule). Rules are versioned: a change adds a new version and points the
 * service at it, so sales already made keep the version they were calculated
 * with. Every change is in the activity log with the previous and new rule.
 */

const decimals = () => Number(settings.get('financial.currency_decimals') ?? 0);
const fmt = (n) => Number(n).toLocaleString('en');
const parse = (config) => normalizeRule(typeof config === 'string' ? JSON.parse(config) : config);

/**
 * Prices between the service's lowest and highest price that no band covers
 * (those prices cannot be sold), e.g. ["5,001–5,999"].
 */
function uncoveredPrices(rule, price, maxPrice, places = 0) {
  if (rule.method !== 'bands') return [];
  const step = D(1).dividedBy(D(10).pow(places));
  const low = D(price);
  const high = D(maxPrice ?? price);
  const bands = [...rule.bands].sort((a, b) => a.min - b.min);
  const gaps = [];
  let from = low;
  for (const band of bands) {
    if (D(band.max).lessThan(from)) continue;
    if (D(band.min).greaterThan(high)) break;
    if (D(band.min).greaterThan(from)) {
      const to = D(band.min).minus(step);
      gaps.push(from.equals(to) ? fmt(from.toNumber()) : `${fmt(from.toNumber())}–${fmt(to.toNumber())}`);
    }
    from = D(band.max).plus(step);
  }
  if (from.lessThanOrEqualTo(high)) gaps.push(from.equals(high) ? fmt(from.toNumber()) : `${fmt(from.toNumber())}–${fmt(high.toNumber())}`);
  return gaps;
}

/** Plain-language warnings about a rule for this service's prices. */
function warningsFor(rule, service, places) {
  const warnings = [];
  if (rule.method === 'unconfigured') warnings.push(`${service.name} cannot be sold or imported until its rule is set.`);
  if (rule.method !== 'bands') return warnings;
  const points = rule.bands.length && rule.bands.every((b) => b.min === b.max);
  if (points) {
    warnings.push(`Only these prices can be charged: ${rule.bands.map((b) => fmt(b.min)).join(', ')}.`);
  } else {
    const gaps = uncoveredPrices(rule, service.price, service.max_price, places);
    if (gaps.length) warnings.push(`No rule for ${gaps.join(', ')}: these prices cannot be charged.`);
  }
  return warnings;
}

function versionRow(r) {
  return {
    id: r.id, version: r.version, method: r.method, config: parse(r.config), notes: r.notes,
    createdAt: r.created_at, createdBy: r.created_by_name || null,
  };
}

/** A service's current rule, its earlier versions and the general formula's percentages. */
async function getRule(serviceId) {
  const service = await db.queryOne('SELECT id, name, price, max_price, financial_rule_id FROM services WHERE id = ?', [serviceId]);
  if (!service) throw ApiError.notFound('Service not found');
  const versions = await db.query(
    `SELECT r.*, u.full_name AS created_by_name FROM service_financial_rules r LEFT JOIN users u ON u.id = r.created_by
     WHERE r.service_id = ? ORDER BY r.version DESC`,
    [serviceId],
  );
  const current = versions.find((v) => v.id === service.financial_rule_id);
  const rule = current ? parse(current.config) : normalizeRule({ method: 'general' });
  const places = decimals();
  const used = await db.query('SELECT rule_id, COUNT(*) AS n FROM sale_item_finance WHERE service_id = ? AND rule_id IS NOT NULL GROUP BY rule_id', [serviceId]);
  return {
    serviceId: service.id,
    serviceName: service.name,
    price: Number(service.price),
    maxPrice: service.max_price === null ? null : Number(service.max_price),
    current: current ? versionRow(current) : null,
    rule,
    warnings: warningsFor(rule, service, places),
    generalRates: serviceFinance.rules(),
    history: versions.map((v) => ({ ...versionRow(v), salesCount: Number(used.find((u) => u.rule_id === v.id)?.n || 0) })),
  };
}

/** Save a new version of a service's rule and make it the one in force. */
async function setRule(serviceId, { rule: raw, notes }, ctx) {
  const places = decimals();
  const problems = validateRule(raw, { decimals: places });
  if (problems.length) throw ApiError.validation(problems.map((p) => ({ field: `rule.${p.field}`, message: p.message })));
  const rule = normalizeRule(raw);

  await db.withTransaction(async (conn) => {
    const service = await db.queryOne('SELECT id, name, price, max_price, financial_rule_id FROM services WHERE id = ? FOR UPDATE', [serviceId], conn);
    if (!service) throw ApiError.notFound('Service not found');
    const previous = service.financial_rule_id
      ? await db.queryOne('SELECT version, config FROM service_financial_rules WHERE id = ?', [service.financial_rule_id], conn)
      : null;
    const before = previous ? parse(previous.config) : null;
    if (before && JSON.stringify(before) === JSON.stringify(rule)) throw ApiError.badRequest('The rule is unchanged');
    const [{ next }] = await db.query('SELECT COALESCE(MAX(version), 0) + 1 AS next FROM service_financial_rules WHERE service_id = ?', [serviceId], conn);
    const result = await db.query(
      'INSERT INTO service_financial_rules (service_id, version, method, config, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      [serviceId, next, rule.method, JSON.stringify(rule), notes || null, ctx.userId],
      conn,
    );
    await db.query('UPDATE services SET financial_rule_id = ? WHERE id = ?', [result.insertId, serviceId], conn);
    await audit.record(ctx, {
      action: 'service.financial_rule_changed', entityType: 'service', entityId: serviceId,
      description: `Changed the financial rule of ${service.name} to version ${next} (${describe(rule)})${notes ? `: ${notes}` : ''}`,
      metadata: { version: next, previousVersion: previous?.version || null },
      before,
      after: rule,
    }, conn);
  });
  return getRule(serviceId);
}

/** "general formula", "price bands: 10,000, 15,000", "not configured". */
function describe(rule) {
  if (rule.method === 'general') return 'general formula';
  if (rule.method === 'unconfigured') return 'not configured';
  return `price bands: ${rule.bands.map(bandName).join(', ')}`;
}

/** Try a rule (saved or not) on a price, without saving anything. */
function preview({ rule: raw, price, productCost = 0, staffCount = 1 }) {
  const places = decimals();
  const problems = validateRule(raw, { decimals: places });
  if (problems.length) return { ok: false, error: problems[0].message };
  try {
    const r = calculateServiceFinancials({
      price, productCost, staffCount, rule: raw, generalRates: serviceFinance.rules(), serviceName: 'This service', decimals: places,
    });
    const m = (v) => toNumber(v, places);
    return {
      ok: true,
      method: r.method,
      band: r.band,
      price: m(r.price),
      productCost: m(r.productCost),
      productCostDeducted: deductsProducts(normalizeRule(raw)),
      operations: m(r.operations),
      staffPool: m(r.staffPool),
      staffShares: r.staffShares.map(m),
      salonProfit: m(r.salonProfit),
      totalAllocated: m(r.productCost.plus(r.operations).plus(r.staffPool).plus(r.salonProfit)),
      unallocated: m(r.unallocated),
      rates: r.rates,
      marginStatus: r.marginStatus,
    };
  } catch (error) {
    if (error instanceof FinancialRuleError || error instanceof RangeError) return { ok: false, error: error.message };
    throw error;
  }
}

/**
 * What the catalog shows about each service's rule: everyone selling sees
 * how it is priced (and the prices allowed); the amounts are for people who
 * see costs or configure rules.
 */
async function summaries(serviceIds, ctx) {
  const rules = await serviceFinance.rulesFor(serviceIds);
  const full = serviceFinance.canSeeCosts(ctx) || hasPermission(ctx.user, 'services.rules');
  const map = new Map();
  for (const [id, r] of rules) {
    const points = r.method === 'bands' && r.config.bands.length && r.config.bands.every((b) => b.min === b.max);
    map.set(id, {
      method: r.method,
      version: r.version,
      configured: r.method !== 'unconfigured',
      productsIncluded: r.config.productsIncluded !== false,
      productCostDeducted: deductsProducts(r.config),
      priceOptions: points ? r.config.bands.map((b) => b.min).sort((a, b) => a - b) : null,
      bands: r.method === 'bands' ? r.config.bands.map((b) => (full ? { ...b, label: bandName(b) } : { min: b.min, max: b.max, label: bandName(b) })) : [],
    });
  }
  return map;
}

module.exports = { getRule, setRule, preview, summaries, uncoveredPrices, describe };
