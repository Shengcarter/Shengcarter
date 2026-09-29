'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { camelizeRows, camelizeRow } = require('../utils/case');
const { D, round } = require('../utils/money');
const settings = require('./settingsService');
const audit = require('./auditService');
const { getPaging, paginate } = require('../utils/pagination');

/**
 * Loyalty program.
 *   Earning:    floor(eligible amount / earn_amount_unit) × points_per_unit × tier multiplier
 *   Redeeming:  points × redeem_value_per_point, limited to max_redeem_percent of the bill
 *   Tiers:      reached by lifetime points (Bronze, Silver, Gold, VIP by default)
 * All balance changes write a loyalty_transactions row (auditable ledger).
 */
const CACHE_TTL_MS = 30_000;
let tierCache = { rows: null, at: 0 };

async function getTiers() {
  if (tierCache.rows && Date.now() - tierCache.at < CACHE_TTL_MS) return tierCache.rows;
  const rows = camelizeRows(await db.query('SELECT id, name, min_points, points_multiplier, color, benefits FROM loyalty_tiers ORDER BY min_points'));
  tierCache = { rows, at: Date.now() };
  return rows;
}

function clearCache() {
  tierCache = { rows: null, at: 0 };
}

/** The tier a customer with `lifetimePoints` belongs to (plus the next tier). */
async function tierFor(lifetimePoints) {
  const tiers = await getTiers();
  let current = null;
  for (const tier of tiers) if (lifetimePoints >= tier.minPoints) current = tier;
  const next = tiers.find((t) => t.minPoints > lifetimePoints) || null;
  return { tier: current, nextTier: next, pointsToNext: next ? next.minPoints - lifetimePoints : 0 };
}

function config() {
  return {
    enabled: Boolean(settings.get('loyalty.enabled')),
    earnAmountUnit: Number(settings.get('loyalty.earn_amount_unit')),
    pointsPerUnit: Number(settings.get('loyalty.points_per_unit')),
    redeemValuePerPoint: Number(settings.get('loyalty.redeem_value_per_point')),
    minRedeemPoints: Number(settings.get('loyalty.min_redeem_points')),
    maxRedeemPercent: Number(settings.get('loyalty.max_redeem_percent')),
  };
}

/** Points earned for an eligible amount (pre-tax, after discounts). */
async function pointsForAmount(amount, lifetimePoints) {
  const cfg = config();
  if (!cfg.enabled || cfg.earnAmountUnit <= 0 || cfg.pointsPerUnit <= 0) return 0;
  const units = D(amount).dividedToIntegerBy(cfg.earnAmountUnit);
  const { tier } = await tierFor(lifetimePoints);
  const multiplier = tier ? tier.pointsMultiplier : 1;
  return units.times(cfg.pointsPerUnit).times(multiplier).floor().toNumber();
}

/**
 * Validate a redemption request and return the discount it is worth.
 * `billAmount` is the amount after other discounts, before tax.
 */
function redemptionValue(points, availablePoints, billAmount, decimals) {
  const cfg = config();
  if (!points) return D(0);
  if (!cfg.enabled) throw ApiError.badRequest('The loyalty program is disabled');
  if (points > availablePoints) throw ApiError.validation([{ field: 'loyaltyPoints', message: `Customer only has ${availablePoints} points` }]);
  if (points < cfg.minRedeemPoints) throw ApiError.validation([{ field: 'loyaltyPoints', message: `At least ${cfg.minRedeemPoints} points are needed to redeem` }]);
  const value = round(D(points).times(cfg.redeemValuePerPoint), decimals);
  const cap = round(D(billAmount).times(cfg.maxRedeemPercent).dividedBy(100), decimals);
  if (value.greaterThan(cap)) {
    throw ApiError.validation([{ field: 'loyaltyPoints', message: `Points can cover at most ${cfg.maxRedeemPercent}% of the bill` }]);
  }
  return value;
}

/**
 * Apply a points change inside a transaction and write the ledger entry.
 * `affectsLifetime` moves lifetime points (used for tiers) as well: true for
 * earned points and for reversing earned points, false for redemptions.
 */
async function applyChange(conn, { customerId, points, type, saleId = null, description, userId, affectsLifetime = type === 'earn', at = null }) {
  if (!points) return null;
  const customer = await db.queryOne('SELECT loyalty_points, lifetime_points FROM customers WHERE id = ? FOR UPDATE', [customerId], conn);
  if (!customer) throw ApiError.notFound('Customer not found');
  const balance = customer.loyalty_points + points;
  if (balance < 0) throw ApiError.badRequest('Customer does not have enough loyalty points');
  const lifetimeDelta = affectsLifetime ? points : 0;
  await db.query(
    'UPDATE customers SET loyalty_points = ?, lifetime_points = GREATEST(0, lifetime_points + ?) WHERE id = ?',
    [balance, lifetimeDelta, customerId],
    conn,
  );
  await db.query(
    `INSERT INTO loyalty_transactions (customer_id, sale_id, type, points, balance_after, description, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))`,
    [customerId, saleId, type, points, balance, description, userId || null, at],
    conn,
  );
  return balance;
}

async function listTransactions(customerId, filters) {
  const result = await paginate({
    select: 'lt.id, lt.type, lt.points, lt.balance_after, lt.description, lt.created_at, lt.sale_id, s.invoice_number, u.full_name AS created_by_name',
    from: `FROM loyalty_transactions lt
           LEFT JOIN sales s ON s.id = lt.sale_id
           LEFT JOIN users u ON u.id = lt.created_by
           WHERE lt.customer_id = ?`,
    params: [customerId],
    orderBy: 'lt.created_at DESC, lt.id DESC',
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows) };
}

/** Manual adjustment (e.g. goodwill points or correction). */
async function adjust(customerId, { points, reason }, ctx) {
  return db.withTransaction(async (conn) => {
    const balance = await applyChange(conn, { customerId, points, type: 'adjust', description: reason, userId: ctx.userId, affectsLifetime: points > 0 });
    await audit.record(ctx, {
      action: 'loyalty.adjusted', entityType: 'customer', entityId: customerId,
      description: `Adjusted loyalty points by ${points}: ${reason}`, metadata: { points },
    }, conn);
    return { balance };
  });
}

// ---- Tier management ----------------------------------------------------------
async function listTiersWithCounts() {
  const tiers = await getTiers();
  const counts = await db.query('SELECT lifetime_points FROM customers WHERE deleted_at IS NULL');
  return tiers.map((tier, i) => {
    const next = tiers[i + 1];
    const members = counts.filter((c) => c.lifetime_points >= tier.minPoints && (!next || c.lifetime_points < next.minPoints)).length;
    return { ...tier, members };
  });
}

async function saveTier(id, data, ctx) {
  const params = [data.name, data.minPoints, data.pointsMultiplier, data.color || '#D4AF37', data.benefits || null];
  const tierId = await db.withTransaction(async (conn) => {
    let targetId = id;
    if (id) {
      const result = await db.query('UPDATE loyalty_tiers SET name = ?, min_points = ?, points_multiplier = ?, color = ?, benefits = ? WHERE id = ?', [...params, id], conn);
      if (!result.affectedRows) throw ApiError.notFound('Tier not found');
    } else {
      const result = await db.query('INSERT INTO loyalty_tiers (name, min_points, points_multiplier, color, benefits) VALUES (?, ?, ?, ?, ?)', params, conn);
      targetId = result.insertId;
    }
    const lowest = await db.queryOne('SELECT MIN(min_points) AS lowest FROM loyalty_tiers', [], conn);
    if (Number(lowest.lowest) !== 0) throw ApiError.validation([{ field: 'minPoints', message: 'One tier must start at 0 points' }]);
    await audit.record(ctx, { action: id ? 'loyalty.tier_updated' : 'loyalty.tier_created', entityType: 'loyalty_tier', entityId: targetId, description: `Saved loyalty tier ${data.name}` }, conn);
    return targetId;
  });
  clearCache();
  return camelizeRow(await db.queryOne('SELECT * FROM loyalty_tiers WHERE id = ?', [tierId]));
}

async function deleteTier(id, ctx) {
  const tier = await db.queryOne('SELECT id, name, min_points FROM loyalty_tiers WHERE id = ?', [id]);
  if (!tier) throw ApiError.notFound('Tier not found');
  if (tier.min_points === 0) throw ApiError.badRequest('The starting tier (0 points) cannot be deleted');
  await db.query('DELETE FROM loyalty_tiers WHERE id = ?', [id]);
  await audit.record(ctx, { action: 'loyalty.tier_deleted', entityType: 'loyalty_tier', entityId: id, description: `Deleted loyalty tier ${tier.name}` });
  clearCache();
}

module.exports = {
  getTiers,
  tierFor,
  config,
  pointsForAmount,
  redemptionValue,
  applyChange,
  listTransactions,
  adjust,
  listTiersWithCounts,
  saveTier,
  deleteTier,
};
