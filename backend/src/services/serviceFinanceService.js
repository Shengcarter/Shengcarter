'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { D, round, toNumber } = require('../utils/money');
const { hasPermission } = require('../middleware/auth');
const { calculateTotals, splitEvenly } = require('./pricing');
const { productCost } = require('./costing');
const { calculateServiceFinancials, FinancialRuleError, normalizeRule, ruleFromSnapshot, findBand, GENERAL_RULE } = require('./financialRules');
const settings = require('./settingsService');
const inventoryService = require('./inventoryService');
const audit = require('./auditService');
const { localDateString, todayLocal } = require('../utils/time');

/**
 * Service finances: the products a service uses and the money split of every
 * service sold (see costing.js for the calculation itself).
 *
 * When a service is billed, in the sale's database transaction:
 *   products used → costed at the salon's recorded purchase cost → taken out of stock
 *   → price − product cost → operations % → staff pool % (shared by the staff) / salon profit %
 *   → breakdown saved (sale_item_finance) with the percentages used
 *   → staff shares and commissions saved (feeding Commission payouts).
 * Anything that fails rolls the whole sale back.
 *
 * Completed figures are never overwritten silently: a correction recalculates
 * the service, moves stock for any change in products used, and keeps the
 * previous and new values with who, when and why (sale_item_finance_revisions).
 */

const MONEY_DECIMALS = () => Number(settings.get('financial.currency_decimals') ?? 0);

/** The split rules in force now (Settings → Financial). */
function rules() {
  return {
    operations: Number(settings.get('financial.operations_percentage') ?? 30),
    employee: Number(settings.get('financial.staff_pool_percentage') ?? 50),
    profit: Number(settings.get('financial.salon_profit_percentage') ?? 50),
    rule: settings.get('financial.staff_split_rule') || 'equal',
  };
}

/** Money figures (costs, splits, profit) are for people who see financial reports or correct sales. */
function canSeeCosts(ctx) {
  return hasPermission(ctx.user, 'reports.financial') || hasPermission(ctx.user, 'sales.correct');
}

/**
 * Each service's current financial rule: Map serviceId → { id, version, method, config }.
 * A service without a rule (none should remain after setup) uses the general formula.
 */
async function rulesFor(serviceIds, conn) {
  const ids = [...new Set(serviceIds)];
  const map = new Map();
  if (!ids.length) return map;
  const rows = await db.query(
    `SELECT s.id AS service_id, r.id, r.version, r.method, r.config
     FROM services s LEFT JOIN service_financial_rules r ON r.id = s.financial_rule_id WHERE s.id IN (?)`,
    [ids],
    conn,
  );
  for (const r of rows) {
    const config = normalizeRule(r.id ? (typeof r.config === 'string' ? JSON.parse(r.config) : r.config) : GENERAL_RULE);
    map.set(r.service_id, { id: r.id || null, version: r.version || null, method: config.method, config });
  }
  return map;
}

/**
 * Run the financial engine, turning a missing or unbalanced rule into a clear
 * API error (the sale, quote, correction or import row is refused).
 */
function calculate({ price, productCost: cost, staffCount, rule, rates, serviceName, decimals, field = 'items', discounted = false }) {
  try {
    return calculateServiceFinancials({ price, productCost: cost, staffCount, rule, generalRates: rates, serviceName, decimals });
  } catch (error) {
    if (error instanceof FinancialRuleError) {
      const hint = error.code === 'no_band' && discounted
        ? ' That is its price after the discount: take the discount off this service, or ask an administrator to add a rule for this price.'
        : '';
      throw ApiError.validation([{ field, message: error.message + hint }]);
    }
    if (error instanceof RangeError) throw ApiError.badRequest(`Service costing: ${error.message}. Check Settings → Financial.`);
    throw error;
  }
}

// ---- Products used ----------------------------------------------------------------------------

const PRODUCT_COLUMNS = 'id, name, branch_id, unit, usage_unit, usage_per_unit, purchase_price, quantity, status';

/** How a product is used in services: its unit, how many of those one stock unit holds, and the cost of one. */
function usageOf(product) {
  const per = product.usage_per_unit ? D(product.usage_per_unit) : D(1);
  return { unit: product.usage_unit || product.unit, per, unitCost: round(D(product.purchase_price).dividedBy(per), 4) };
}

async function loadProducts(conn, ids, { lock = false } = {}) {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  const rows = await db.query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id IN (?) ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [unique], conn);
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * Cost the products used on one service from the salon's recorded purchase
 * cost (never the retail price). `previous` holds the rows already saved for
 * the service when correcting it: kept products keep the cost and unit they
 * were used at, unless a corrected unit cost is given.
 * @returns {{ lines: object[], total: Decimal }}
 */
function priceUsage(rows, products, { branchId, decimals, field, previous = new Map() }) {
  const errors = [];
  const items = [];
  for (const [i, row] of rows.entries()) {
    const product = products.get(row.productId);
    const before = previous.get(row.productId);
    if (!product || product.branch_id !== branchId || (product.status === 'discontinued' && !before)) {
      errors.push({ field: `${field}.${i}.productId`, message: 'Product not found in this branch' });
      continue;
    }
    const usage = usageOf(product);
    const quantity = D(row.quantity);
    let stockQuantity;
    if (!before) stockQuantity = round(quantity.dividedBy(usage.per), 3);
    else if (quantity.equals(before.quantity)) stockQuantity = D(before.stock_quantity);
    else stockQuantity = round(D(before.stock_quantity).times(quantity).dividedBy(before.quantity), 3);
    const unitCost = row.unitCost !== undefined && row.unitCost !== null ? round(row.unitCost, 4) : before ? D(before.unit_cost) : usage.unitCost;
    items.push({ productId: product.id, name: product.name, unit: before ? before.unit : usage.unit, quantity, stockQuantity, unitCost });
  }
  if (errors.length) throw ApiError.validation(errors);
  try {
    return productCost(items, decimals);
  } catch (error) {
    if (error instanceof RangeError) throw ApiError.validation([{ field, message: error.message }]);
    throw error;
  }
}

function describeUsage(usage) {
  return usage.lines.map((l) => ({
    productId: l.productId, name: l.name, unit: l.unit, quantity: toNumber(l.quantity, 3),
    unitCost: toNumber(l.unitCost, 4), cost: toNumber(l.cost, MONEY_DECIMALS()),
  }));
}

/** A readable amount of stock, e.g. "0.2 bottle". */
const amountOf = (quantity, unit) => `${toNumber(quantity, 3)} ${unit}`;

/**
 * Refuse when the products needed (services and retail lines together) are
 * more than what is in stock. `needs`: Map productId → stock units needed.
 */
function assertInStock(needs, products) {
  const errors = [];
  for (const [productId, needed] of needs) {
    const product = products.get(productId);
    if (product && D(needed).greaterThan(product.quantity)) {
      errors.push({
        field: 'items',
        message: `Not enough ${product.name} in stock: ${amountOf(product.quantity, product.unit)} left, ${amountOf(needed, product.unit)} needed. Record the delivery or correct the stock count first.`,
      });
    }
  }
  if (errors.length) throw ApiError.validation(errors);
}

// ---- Service recipes --------------------------------------------------------------------------

/** The products each service normally uses in this branch: Map serviceId → rows. */
async function recipesFor(serviceIds, branchId, conn) {
  const ids = [...new Set(serviceIds)];
  const map = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return map;
  const rows = await db.query(
    `SELECT sp.service_id, sp.quantity AS recipe_quantity, p.${PRODUCT_COLUMNS.split(', ').join(', p.')}
     FROM service_products sp JOIN products p ON p.id = sp.product_id
     WHERE sp.service_id IN (?) AND p.branch_id = ? AND p.status <> 'discontinued'
     ORDER BY p.name`,
    [ids, branchId],
    conn,
  );
  const decimals = MONEY_DECIMALS();
  for (const r of rows) {
    const usage = usageOf(r);
    map.get(r.service_id).push({
      productId: r.id,
      name: r.name,
      unit: usage.unit,
      quantity: Number(r.recipe_quantity),
      unitCost: toNumber(usage.unitCost, 4),
      cost: toNumber(D(r.recipe_quantity).times(usage.unitCost), decimals),
      inStock: toNumber(D(r.quantity).times(usage.per), 3),
    });
  }
  return map;
}

/** Replace a service's recipe for the products of this branch (other branches keep theirs). */
async function setRecipe(conn, serviceId, rows, branchId) {
  const ids = rows.map((r) => r.productId);
  if (new Set(ids).size !== ids.length) throw ApiError.validation([{ field: 'recipe', message: 'List each product once' }]);
  const products = await loadProducts(conn, ids);
  const errors = [];
  rows.forEach((row, i) => {
    const p = products.get(row.productId);
    if (!p || p.branch_id !== branchId || p.status === 'discontinued') errors.push({ field: `recipe.${i}.productId`, message: 'Product not found in this branch' });
  });
  if (errors.length) throw ApiError.validation(errors);
  await db.query(
    'DELETE sp FROM service_products sp JOIN products p ON p.id = sp.product_id WHERE sp.service_id = ? AND p.branch_id = ?',
    [serviceId, branchId],
    conn,
  );
  if (rows.length) {
    await db.query('INSERT INTO service_products (service_id, product_id, quantity) VALUES ?', [rows.map((r) => [serviceId, r.productId, r.quantity])], conn);
  }
}

// ---- Products used, recorded on the appointment -------------------------------------------------

async function appointmentProducts(appointmentId, conn) {
  const rows = await db.query(
    `SELECT ap.service_id, ap.product_id, ap.quantity, ap.recorded_at, u.full_name AS recorded_by_name, p.name, p.unit, p.usage_unit
     FROM appointment_products ap JOIN products p ON p.id = ap.product_id LEFT JOIN users u ON u.id = ap.recorded_by
     WHERE ap.appointment_id = ? ORDER BY ap.service_id, p.name`,
    [appointmentId],
    conn,
  );
  return rows.map((r) => ({
    serviceId: r.service_id, productId: r.product_id, name: r.name, unit: r.usage_unit || r.unit,
    quantity: Number(r.quantity), recordedBy: r.recorded_by_name, recordedAt: r.recorded_at,
  }));
}

/**
 * What an appointment's services use: what the stylist recorded, or the recipe
 * when nothing was recorded for a service yet.
 * @returns {{ serviceId, source: 'recorded'|'recipe'|'none', recordedBy, products }[]}
 */
async function appointmentUsage(appointment, serviceIds, conn) {
  const [recorded, recipes] = await Promise.all([appointmentProducts(appointment.id, conn), recipesFor(serviceIds, appointment.branch_id, conn)]);
  return serviceIds.map((serviceId) => {
    const own = recorded.filter((r) => r.serviceId === serviceId);
    if (own.length) {
      return { serviceId, source: 'recorded', recordedBy: own[0].recordedBy, products: own.map(({ productId, name, unit, quantity }) => ({ productId, name, unit, quantity })) };
    }
    const recipe = recipes.get(serviceId) || [];
    return { serviceId, source: recipe.length ? 'recipe' : 'none', recordedBy: null, products: recipe.map(({ productId, name, unit, quantity }) => ({ productId, name, unit, quantity })) };
  });
}

/**
 * A stylist (or the front desk) records the products used on an appointment's
 * services. Stock only moves when the appointment is billed.
 */
async function recordAppointmentProducts(appointmentId, { services }, ctx, { ownOnly = false } = {}) {
  await db.withTransaction(async (conn) => {
    const appointment = await db.queryOne('SELECT id, code, branch_id, status FROM appointments WHERE id = ? FOR UPDATE', [appointmentId], conn);
    if (!appointment || appointment.branch_id !== ctx.branchId) throw ApiError.notFound('Appointment not found');
    if (ownOnly) {
      const member = await db.queryOne(
        'SELECT 1 FROM appointment_staff s JOIN employees e ON e.id = s.employee_id WHERE s.appointment_id = ? AND e.user_id = ?',
        [appointmentId, ctx.userId],
        conn,
      );
      if (!member) throw ApiError.notFound('Appointment not found');
    }
    if (['cancelled', 'no_show'].includes(appointment.status)) throw ApiError.badRequest(`Appointment ${appointment.code} is ${appointment.status.replace('_', ' ')}`);
    const billed = await db.queryOne("SELECT invoice_number FROM sales WHERE appointment_id = ? AND status = 'completed'", [appointmentId], conn);
    if (billed) throw ApiError.conflict(`Appointment ${appointment.code} was already billed on ${billed.invoice_number}; the products used are on that sale`);

    const booked = new Set((await db.query('SELECT service_id FROM appointment_services WHERE appointment_id = ?', [appointmentId], conn)).map((r) => r.service_id));
    const errors = [];
    services.forEach((s, i) => {
      if (!booked.has(s.serviceId)) errors.push({ field: `services.${i}.serviceId`, message: 'This service is not on the appointment' });
    });
    const products = await loadProducts(conn, services.flatMap((s) => s.products.map((p) => p.productId)));
    services.forEach((s, i) => s.products.forEach((p, j) => {
      const product = products.get(p.productId);
      if (!product || product.branch_id !== ctx.branchId || product.status === 'discontinued') {
        errors.push({ field: `services.${i}.products.${j}.productId`, message: 'Product not found in this branch' });
      }
    }));
    if (errors.length) throw ApiError.validation(errors);

    for (const s of services) {
      await db.query('DELETE FROM appointment_products WHERE appointment_id = ? AND service_id = ?', [appointmentId, s.serviceId], conn);
      if (s.products.length) {
        await db.query(
          'INSERT INTO appointment_products (appointment_id, service_id, product_id, quantity, recorded_by) VALUES ?',
          [s.products.map((p) => [appointmentId, s.serviceId, p.productId, p.quantity, ctx.userId])],
          conn,
        );
      }
    }
    await audit.record(ctx, {
      action: 'appointment.products_recorded', entityType: 'appointment', entityId: appointmentId,
      description: `Recorded the products used on ${appointment.code}`,
      metadata: { services: services.map((s) => ({ serviceId: s.serviceId, products: s.products })) },
    }, conn);
  });
  const appointment = await db.queryOne('SELECT id, branch_id FROM appointments WHERE id = ?', [appointmentId]);
  const serviceIds = (await db.query('SELECT service_id FROM appointment_services WHERE appointment_id = ? ORDER BY sort_order', [appointmentId])).map((r) => r.service_id);
  return appointmentUsage(appointment, serviceIds);
}

// ---- Recording a service sold -------------------------------------------------------------------

/** The line's price for costing: its net amount, without any tax included in it. */
function serviceRevenue(netAmount, tax, decimals) {
  if (tax?.mode === 'inclusive' && Number(tax.rate) > 0) {
    return round(D(netAmount).times(100).dividedBy(D(100).plus(tax.rate)), decimals);
  }
  return round(netAmount, decimals);
}

/**
 * Cost and split a service line (nothing is saved yet) with the service's own
 * financial rule: the same calculation for the till, a sale recorded for a
 * previous date, a correction and an Excel import.
 */
function costLine({ line, tax, decimals, rates = rules(), field = 'items' }) {
  const discounted = line.lineTotal !== undefined && !D(line.netAmount).equals(line.lineTotal);
  const costing = calculate({
    discounted,
    price: serviceRevenue(line.netAmount, tax, decimals),
    productCost: line.usage.total,
    staffCount: line.staff.length,
    rule: line.rule?.config,
    rates,
    serviceName: line.description,
    decimals,
    field,
  });
  return { ...costing, ruleId: line.rule?.id || null, ruleVersion: line.rule?.version || null, productCostBasis: line.usage.basis || (line.usage.lines.length ? 'recorded' : 'none') };
}

/**
 * Save who performed a line and their shares, and keep their commission rows
 * in step: existing rows are updated in place (so a pending payout keeps them),
 * rows for people no longer on the line are removed, new people get new rows.
 * @returns {Set<number>} pending payouts whose totals must be refreshed
 */
async function writeStaff(conn, { saleItemId, saleId, branchId, staff, revenueShares, costing, at, commissionStatus = 'earned' }) {
  await db.query('DELETE FROM sale_item_staff WHERE sale_item_id = ?', [saleItemId], conn);
  const decimals = MONEY_DECIMALS();
  const baseShares = costing ? splitEvenly(costing.distributable, Math.max(1, staff.length), decimals) : [];
  for (const [i, person] of staff.entries()) {
    await db.query(
      'INSERT INTO sale_item_staff (sale_item_id, employee_id, revenue_share, commission_amount, sort_order) VALUES (?, ?, ?, ?, ?)',
      [saleItemId, person.id, toNumber(revenueShares[i], decimals), costing ? toNumber(costing.staffShares[i], decimals) : 0, i],
      conn,
    );
  }

  const touched = new Set();
  const existing = await db.query('SELECT id, employee_id, salary_record_id FROM commissions WHERE sale_item_id = ? FOR UPDATE', [saleItemId], conn);
  for (const [i, person] of staff.entries()) {
    const amount = costing ? costing.staffShares[i] : D(0);
    const row = existing.find((c) => c.employee_id === person.id);
    if (row?.salary_record_id) touched.add(row.salary_record_id);
    // Fixed-amount rules have no staff percentage.
    const rate = costing?.rates ? costing.rates.employee : 0;
    if (row && amount.greaterThan(0)) {
      await db.query('UPDATE commissions SET base_amount = ?, rate = ?, amount = ? WHERE id = ?', [toNumber(baseShares[i], decimals), rate, toNumber(amount, decimals), row.id], conn);
    } else if (row) {
      await db.query('DELETE FROM commissions WHERE id = ?', [row.id], conn);
    } else if (amount.greaterThan(0)) {
      await db.query(
        `INSERT INTO commissions (employee_id, branch_id, sale_id, sale_item_id, base_amount, rate, amount, status, earned_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [person.id, branchId, saleId, saleItemId, toNumber(baseShares[i], decimals), rate, toNumber(amount, decimals), commissionStatus, at],
        conn,
      );
    }
  }
  for (const row of existing.filter((c) => !staff.some((p) => p.id === c.employee_id))) {
    if (row.salary_record_id) touched.add(row.salary_record_id);
    await db.query('DELETE FROM commissions WHERE id = ?', [row.id], conn);
  }
  return touched;
}

/** Recalculate pending payouts after commissions in them changed. */
async function refreshPayouts(conn, payoutIds) {
  for (const id of payoutIds) {
    const payout = await db.queryOne('SELECT id, status, base_salary, bonus, deductions FROM salary_records WHERE id = ? FOR UPDATE', [id], conn);
    if (!payout || payout.status !== 'pending') continue;
    const { total } = await db.queryOne("SELECT COALESCE(SUM(amount), 0) AS total FROM commissions WHERE salary_record_id = ? AND status = 'earned'", [id], conn);
    const net = D(payout.base_salary).plus(total).plus(payout.bonus).minus(payout.deductions);
    if (net.lessThan(0)) throw ApiError.badRequest('The correction would make a pending payout negative. Lower its deductions first.');
    await db.query('UPDATE salary_records SET commission_amount = ?, net_pay = ? WHERE id = ?', [Number(total), toNumber(net), id], conn);
  }
}

/** Products used on a service line: saved, and taken out of stock. */
async function writeUsage(conn, { saleItemId, saleId, branchId, usage, reason, userId, at }) {
  for (const used of usage.lines) {
    await db.query(
      `INSERT INTO sale_item_products (sale_item_id, product_id, product_name, unit, quantity, stock_quantity, unit_cost, total_cost)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [saleItemId, used.productId, used.name, used.unit, toNumber(used.quantity, 3), toNumber(used.stockQuantity, 3), toNumber(used.unitCost, 4), toNumber(used.cost, MONEY_DECIMALS())],
      conn,
    );
    if (D(used.stockQuantity).greaterThan(0)) {
      await inventoryService.changeStock(conn, {
        productId: used.productId, branchId, change: -toNumber(used.stockQuantity, 3), type: 'service_use',
        referenceType: 'sale', referenceId: saleId, reason, userId, at,
      });
    }
  }
}

function financeValues(costing) {
  const decimals = MONEY_DECIMALS();
  const m = (v) => toNumber(v, decimals);
  const rates = costing.rates || {};
  return {
    price: m(costing.price), product_cost: m(costing.productCost), consumption_cost: m(costing.consumptionCost ?? costing.productCost),
    product_cost_basis: costing.productCostBasis || 'recorded', amount_after_products: m(costing.afterProducts),
    operations_rate: rates.operations ?? null, operations_amount: m(costing.operations), distributable_amount: m(costing.distributable),
    staff_rate: rates.employee ?? null, staff_pool: m(costing.staffPool), profit_rate: rates.profit ?? null, salon_profit: m(costing.salonProfit),
    staff_count: costing.staffShares.length, split_rule: costing.rule, margin_status: costing.marginStatus,
    calculation_method: costing.method || 'general', rule_id: costing.ruleId || null, rule_version: costing.ruleVersion || null,
    rule_snapshot: JSON.stringify(costing.snapshot || null),
  };
}

/** Save the breakdown of a service line of a sale being completed. */
async function recordLine(conn, { saleItemId, saleId, branchId, line, costing, at, stockAt = at, invoiceNumber, userId, note = '' }) {
  await writeUsage(conn, { saleItemId, saleId, branchId, usage: line.usage, reason: `Used for ${line.description} on ${invoiceNumber}${note}`, userId, at: stockAt });
  const v = financeValues(costing);
  await db.query(
    `INSERT INTO sale_item_finance (sale_item_id, sale_id, branch_id, service_id, service_name, performed_at, price, product_cost, consumption_cost,
       product_cost_basis, amount_after_products, operations_rate, operations_amount, distributable_amount, staff_rate, staff_pool, profit_rate,
       salon_profit, staff_count, split_rule, calculation_method, rule_id, rule_version, rule_snapshot, margin_status, review_status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [saleItemId, saleId, branchId, line.serviceId, line.description, at, v.price, v.product_cost, v.consumption_cost,
      v.product_cost_basis, v.amount_after_products, v.operations_rate, v.operations_amount, v.distributable_amount, v.staff_rate, v.staff_pool, v.profit_rate,
      v.salon_profit, v.staff_count, v.split_rule, v.calculation_method, v.rule_id, v.rule_version, v.rule_snapshot, v.margin_status,
      costing.needsReview ? 'pending' : 'not_needed'],
    conn,
  );
}

// ---- Reading ---------------------------------------------------------------------------------------

const rateOf = (v) => (v === null || v === undefined ? null : Number(v));

function snapshotOf(r) {
  if (!r.rule_snapshot) return null;
  return typeof r.rule_snapshot === 'string' ? JSON.parse(r.rule_snapshot) : r.rule_snapshot;
}

function financeFromRow(r) {
  const snapshot = snapshotOf(r);
  return {
    price: Number(r.price), productCost: Number(r.product_cost), consumptionCost: Number(r.consumption_cost ?? r.product_cost),
    productCostBasis: r.product_cost_basis || 'recorded', amountAfterProducts: Number(r.amount_after_products),
    operationsRate: rateOf(r.operations_rate), operations: Number(r.operations_amount), distributable: Number(r.distributable_amount),
    staffRate: rateOf(r.staff_rate), staffPool: Number(r.staff_pool), profitRate: rateOf(r.profit_rate), salonProfit: Number(r.salon_profit),
    staffCount: r.staff_count, splitRule: r.split_rule, marginStatus: r.margin_status, reviewStatus: r.review_status,
    calculationMethod: r.calculation_method || 'general', ruleId: r.rule_id || null, ruleVersion: r.rule_version || null,
    band: snapshot?.band ? { min: snapshot.band.min, max: snapshot.band.max, label: snapshot.band.label || null } : null,
    reviewNote: r.review_note, reviewedBy: r.reviewed_by_name || null, reviewedAt: r.reviewed_at, revision: r.revision,
  };
}

/**
 * Products used and (for people who see costs) the money split of each service
 * line of a sale: Map saleItemId → { productsUsed, costing? }.
 */
async function forSale(saleId, itemIds, ctx) {
  const map = new Map();
  if (!itemIds.length) return map;
  const [used, finance, revisions] = await Promise.all([
    db.query('SELECT * FROM sale_item_products WHERE sale_item_id IN (?) ORDER BY id', [itemIds]),
    db.query('SELECT f.*, u.full_name AS reviewed_by_name FROM sale_item_finance f LEFT JOIN users u ON u.id = f.reviewed_by WHERE f.sale_id = ?', [saleId]),
    db.query(
      `SELECT r.sale_item_id, r.revision, r.reason, r.before_data, r.after_data, r.changed_at, u.full_name AS changed_by_name
       FROM sale_item_finance_revisions r LEFT JOIN users u ON u.id = r.changed_by WHERE r.sale_item_id IN (?) ORDER BY r.revision DESC`,
      [itemIds],
    ),
  ]);
  const showCosts = canSeeCosts(ctx);
  for (const id of itemIds) {
    const productsUsed = used.filter((u) => u.sale_item_id === id).map((u) => ({
      productId: u.product_id, name: u.product_name, unit: u.unit, quantity: Number(u.quantity),
      ...(showCosts ? { unitCost: Number(u.unit_cost), cost: Number(u.total_cost) } : {}),
    }));
    const row = finance.find((f) => f.sale_item_id === id);
    const entry = { productsUsed, hasCosting: Boolean(row) };
    if (row && showCosts) {
      entry.costing = {
        ...financeFromRow(row),
        revisions: revisions.filter((r) => r.sale_item_id === id).map((r) => ({
          revision: r.revision, reason: r.reason, before: r.before_data, after: r.after_data, changedAt: r.changed_at, changedBy: r.changed_by_name,
        })),
      };
    } else if (row) {
      // Everyone may see that a service needs a manager's look, not the figures.
      entry.needsReview = row.review_status === 'pending';
    }
    map.set(id, entry);
  }
  return map;
}

// ---- Corrections and review ---------------------------------------------------------------------

/** Everything about a service line that a correction can change, for the audit trail. */
async function snapshot(conn, saleItemId) {
  const [item, finance, products, staff] = await Promise.all([
    db.queryOne('SELECT unit_price, net_amount FROM sale_items WHERE id = ?', [saleItemId], conn),
    db.queryOne('SELECT * FROM sale_item_finance WHERE sale_item_id = ?', [saleItemId], conn),
    db.query('SELECT product_id, product_name, unit, quantity, unit_cost, total_cost FROM sale_item_products WHERE sale_item_id = ? ORDER BY id', [saleItemId], conn),
    db.query(
      `SELECT s.employee_id, e.full_name, s.commission_amount FROM sale_item_staff s JOIN employees e ON e.id = s.employee_id
       WHERE s.sale_item_id = ? ORDER BY s.sort_order`,
      [saleItemId],
      conn,
    ),
  ]);
  const f = financeFromRow(finance);
  return {
    unitPrice: Number(item.unit_price),
    price: f.price, productCost: f.productCost, operations: f.operations, staffPool: f.staffPool, salonProfit: f.salonProfit, marginStatus: f.marginStatus,
    calculationMethod: f.calculationMethod, ruleVersion: f.ruleVersion,
    products: products.map((p) => ({ productId: p.product_id, name: p.product_name, unit: p.unit, quantity: Number(p.quantity), unitCost: Number(p.unit_cost), cost: Number(p.total_cost) })),
    staff: staff.map((s) => ({ id: s.employee_id, name: s.full_name, share: Number(s.commission_amount) })),
  };
}

/**
 * Refuse once a commission from these lines was paid out. Imported history's
 * commissions were settled outside the system (no payout here), so they can
 * still be corrected.
 */
async function assertPayNotPaid(conn, itemIds) {
  const paid = await db.queryOne(
    `SELECT e.full_name, r.paid_at FROM commissions c JOIN employees e ON e.id = c.employee_id LEFT JOIN salary_records r ON r.id = c.salary_record_id
     JOIN sales s ON s.id = c.sale_id
     WHERE c.sale_item_id IN (?) AND (c.status = 'paid' OR r.status = 'paid') AND NOT (s.is_imported = 1 AND c.salary_record_id IS NULL) LIMIT 1`,
    [itemIds],
    conn,
  );
  if (paid) {
    throw ApiError.conflict(`${paid.full_name}'s commission for this sale was already paid out, so its figures can no longer be corrected. Settle the difference with a bonus or deduction on the next payout.`);
  }
}

async function loadTeam(conn, employeeIds, branchId) {
  const rows = await db.query('SELECT id, full_name, branch_id, status FROM employees WHERE id IN (?)', [employeeIds], conn);
  const team = employeeIds.map((id) => rows.find((r) => r.id === id));
  if (team.some((e) => !e || e.branch_id !== branchId || e.status === 'terminated')) {
    throw ApiError.validation([{ field: 'employeeIds', message: 'Staff member not found in this branch' }]);
  }
  return team.map((e) => ({ id: e.id, fullName: e.full_name }));
}

/**
 * Correct a completed service: products used (quantity or cost), price and/or
 * staff. The service is recalculated with the rule (and percentages) that
 * applied when it was sold — or, when a new price is outside that rule's price
 * band, with the service's current rule; stock moves for any change in products used; staff commissions and
 * pending payouts follow; and the previous and new figures are kept with the
 * reason. A price change re-totals the sale (other lines' shares of an invoice
 * discount can change, so they are recalculated too).
 */
async function correct(saleId, saleItemId, data, ctx) {
  const decimals = MONEY_DECIMALS();
  await db.withTransaction(async (conn) => {
    const sale = await db.queryOne('SELECT * FROM sales WHERE id = ? FOR UPDATE', [saleId], conn);
    if (!sale || sale.branch_id !== ctx.branchId) throw ApiError.notFound('Sale not found');
    if (sale.status !== 'completed') throw ApiError.badRequest(`A ${sale.status} sale cannot be corrected`);
    if (localDateString(sale.sold_at) < todayLocal() && !hasPermission(ctx.user, 'sales.edit_history')) {
      throw ApiError.forbidden('This sale is from a previous day. Correcting it needs the "Change past sales" permission.');
    }
    const items = await db.query('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id FOR UPDATE', [saleId], conn);
    const item = items.find((i) => i.id === saleItemId);
    const finance = await db.queryOne('SELECT * FROM sale_item_finance WHERE sale_item_id = ? FOR UPDATE', [saleItemId], conn);
    if (!item || !finance) throw ApiError.notFound('Service not found on this sale');

    const priceChanges = data.price !== undefined && !D(data.price).equals(item.unit_price);
    const finances = await db.query('SELECT * FROM sale_item_finance WHERE sale_id = ? FOR UPDATE', [saleId], conn);
    // A price change can move every service line of the sale (shared invoice discount).
    const affected = priceChanges ? finances.map((f) => f.sale_item_id) : [saleItemId];
    await assertPayNotPaid(conn, affected);
    const before = new Map();
    for (const id of affected) before.set(id, await snapshot(conn, id));

    // New net amounts, from the sale's own discount and tax.
    let nets = new Map(items.map((i) => [i.id, D(i.net_amount)]));
    if (priceChanges) {
      const lines = items.map((i) => ({ ...i, unitPrice: i.id === saleItemId ? data.price : i.unit_price, quantity: i.quantity }));
      let totals;
      try {
        totals = calculateTotals({
          lines, discount: { type: sale.discount_type, value: sale.discount_value }, loyaltyDiscount: sale.loyalty_discount,
          tax: { mode: sale.tax_mode, rate: sale.tax_rate }, decimals,
        });
      } catch (error) {
        if (error instanceof RangeError) throw ApiError.validation([{ field: 'price', message: error.message }]);
        throw error;
      }
      if (totals.total.lessThan(sale.amount_paid)) {
        throw ApiError.badRequest(`The customer has already paid ${toNumber(sale.amount_paid, decimals).toLocaleString('en')}; the corrected total would be ${toNumber(totals.total, decimals).toLocaleString('en')}. Refund the sale instead.`);
      }
      nets = new Map(totals.lines.map((l) => [l.id, l.netAmount]));
      for (const l of totals.lines) {
        await db.query('UPDATE sale_items SET unit_price = ?, line_total = ?, net_amount = ? WHERE id = ?', [toNumber(l.unitPrice, decimals), toNumber(l.lineTotal, decimals), toNumber(l.netAmount, decimals), l.id], conn);
      }
      const balance = totals.total.minus(sale.amount_paid);
      await db.query(
        'UPDATE sales SET subtotal = ?, discount_amount = ?, tax_amount = ?, total = ?, balance_due = ?, payment_status = ? WHERE id = ?',
        [toNumber(totals.subtotal, decimals), toNumber(totals.discountAmount, decimals), toNumber(totals.taxAmount, decimals), toNumber(totals.total, decimals),
          toNumber(balance, decimals), balance.lessThanOrEqualTo(0) ? 'paid' : D(sale.amount_paid).greaterThan(0) ? 'partial' : 'unpaid', saleId],
        conn,
      );
      if (sale.customer_id) {
        await db.query('UPDATE customers SET total_spent = GREATEST(0, total_spent + ?) WHERE id = ?', [toNumber(totals.total.minus(sale.total), decimals), sale.customer_id], conn);
      }
    }

    const touchedPayouts = new Set();
    const currentRules = await rulesFor(finances.map((x) => x.service_id).filter(Boolean), conn);
    for (const id of affected) {
      const f = finances.find((x) => x.sale_item_id === id);
      const line = items.find((i) => i.id === id);
      const isTarget = id === saleItemId;

      // Products used: the corrected list, or what was saved.
      const saved = await db.query('SELECT * FROM sale_item_products WHERE sale_item_id = ? ORDER BY id', [id], conn);
      const previous = new Map(saved.map((u) => [u.product_id, u]));
      const rows = isTarget && data.consumption
        ? data.consumption
        : saved.map((u) => ({ productId: u.product_id, quantity: Number(u.quantity) }));
      const products = await loadProducts(conn, [...rows.map((r) => r.productId), ...saved.map((u) => u.product_id)], { lock: true });
      const changesUsage = isTarget && Boolean(data.consumption);
      let usage = priceUsage(rows, products, { branchId: sale.branch_id, decimals, field: 'consumption', previous });
      // An imported sale's product cost is an estimate from the recipe, kept until corrected.
      if (f.product_cost_basis === 'recipe_estimate' && !changesUsage) usage = { lines: [], total: D(f.consumption_cost) };

      // Stock follows the change in products used (imported history never moved stock).
      if (changesUsage && !sale.is_imported) {
        const deltas = new Map();
        for (const u of saved) deltas.set(u.product_id, D(u.stock_quantity));
        for (const l of usage.lines) deltas.set(l.productId, (deltas.get(l.productId) || D(0)).minus(l.stockQuantity));
        for (const [productId, change] of deltas) {
          if (change.isZero()) continue;
          await inventoryService.changeStock(conn, {
            productId, branchId: sale.branch_id, change: toNumber(change, 3), type: 'service_use', referenceType: 'sale', referenceId: saleId,
            reason: `Correction of ${line.description} on ${sale.invoice_number}: ${data.reason}`, userId: ctx.userId,
          });
        }
      }
      await db.query('DELETE FROM sale_item_products WHERE sale_item_id = ?', [id], conn);
      for (const used of usage.lines) {
        await db.query(
          `INSERT INTO sale_item_products (sale_item_id, product_id, product_name, unit, quantity, stock_quantity, unit_cost, total_cost)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, used.productId, used.name, used.unit, toNumber(used.quantity, 3), toNumber(used.stockQuantity, 3), toNumber(used.unitCost, 4), toNumber(used.cost, decimals)],
          conn,
        );
      }

      // Staff: the corrected team, or who was saved.
      const staffRows = await db.query('SELECT employee_id FROM sale_item_staff WHERE sale_item_id = ? ORDER BY sort_order', [id], conn);
      const team = await loadTeam(conn, isTarget && data.employeeIds ? data.employeeIds : staffRows.map((r) => r.employee_id), sale.branch_id);
      if (!team.length) throw ApiError.validation([{ field: 'employeeIds', message: 'A service needs at least one person who performed it' }]);

      // Recalculated with the rule that applied when it was sold. A new price
      // outside that rule's band takes the service's current rule instead.
      const price = serviceRevenue(nets.get(id), { mode: sale.tax_mode, rate: sale.tax_rate }, decimals);
      const original = ruleFromSnapshot(snapshotOf(f) || { method: 'general', rates: { operations: f.operations_rate, employee: f.staff_rate, profit: f.profit_rate } });
      let applied = { config: original.rule, rates: original.rates || rules(), id: f.rule_id, version: f.rule_version };
      if (original.rule.method === 'bands' && !findBand(normalizeRule(original.rule), price)) {
        const current = currentRules.get(f.service_id);
        if (current) applied = { config: current.config, rates: rules(), id: current.id, version: current.version };
      }
      const costing = {
        ...calculate({
          price, productCost: usage.total, staffCount: team.length, rule: applied.config, rates: applied.rates,
          serviceName: line.description, decimals, field: isTarget ? 'price' : 'items',
        }),
        ruleId: applied.id || null,
        ruleVersion: applied.version || null,
        productCostBasis: f.product_cost_basis === 'recipe_estimate' && !changesUsage ? 'recipe_estimate' : (usage.lines.length ? 'recorded' : 'none'),
      };
      const revenueShares = splitEvenly(nets.get(id), team.length, decimals);
      const commissionStatus = sale.is_imported ? 'paid' : 'earned';
      for (const payout of await writeStaff(conn, { saleItemId: id, saleId, branchId: sale.branch_id, staff: team, revenueShares, costing, at: sale.sold_at, commissionStatus })) {
        touchedPayouts.add(payout);
      }
      const v = financeValues(costing);
      const stillFlagged = costing.needsReview;
      await db.query(
        `UPDATE sale_item_finance SET price = ?, product_cost = ?, consumption_cost = ?, product_cost_basis = ?, amount_after_products = ?,
           operations_rate = ?, operations_amount = ?, distributable_amount = ?, staff_rate = ?, staff_pool = ?, profit_rate = ?, salon_profit = ?,
           staff_count = ?, calculation_method = ?, rule_id = ?, rule_version = ?, rule_snapshot = ?, margin_status = ?,
           review_status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?, revision = revision + 1
         WHERE sale_item_id = ?`,
        [v.price, v.product_cost, v.consumption_cost, v.product_cost_basis, v.amount_after_products,
          v.operations_rate, v.operations_amount, v.distributable_amount, v.staff_rate, v.staff_pool, v.profit_rate, v.salon_profit,
          v.staff_count, v.calculation_method, v.rule_id, v.rule_version, v.rule_snapshot, v.margin_status,
          stillFlagged ? 'pending' : 'not_needed', null, null, null, id],
        conn,
      );
      await db.query(
        'UPDATE sale_items SET employee_id = ?, unit_cost = ?, commission_rate = ?, commission_amount = ? WHERE id = ?',
        [team[0].id, toNumber(usage.total.dividedBy(line.quantity), 2), effectiveRate(costing), v.staff_pool, id],
        conn,
      );
      const after = await snapshot(conn, id);
      await db.query(
        'INSERT INTO sale_item_finance_revisions (sale_item_id, revision, reason, before_data, after_data, changed_by) VALUES (?, ?, ?, ?, ?, ?)',
        [id, f.revision + 1, isTarget ? data.reason : `${data.reason} (price of ${item.description} changed on the same sale)`, JSON.stringify(before.get(id)), JSON.stringify(after), ctx.userId],
        conn,
      );
    }
    await refreshPayouts(conn, touchedPayouts);

    // The sale's cost of goods: retail products sold plus products used on services.
    await db.query(
      `UPDATE sales SET cost_of_goods = (
         SELECT COALESCE(SUM(CASE WHEN si.item_type = 'product' THEN si.unit_cost * si.quantity ELSE 0 END), 0)
              + COALESCE((SELECT SUM(f.product_cost) FROM sale_item_finance f WHERE f.sale_id = ?), 0)
         FROM sale_items si WHERE si.sale_id = ?)
       WHERE id = ?`,
      [saleId, saleId, saleId],
      conn,
    );
    await audit.record(ctx, {
      action: 'sale.service_corrected', entityType: 'sale', entityId: saleId,
      description: `Corrected ${item.description} on ${sale.invoice_number}: ${data.reason}`,
      metadata: { saleItemId, changed: Object.keys(data).filter((k) => k !== 'reason') },
      before: before.get(saleItemId),
      after: await snapshot(conn, saleItemId),
    }, conn);
  });
}

/** An authorised person has looked at a zero or negative margin service. */
async function review(saleId, saleItemId, { note }, ctx) {
  await db.withTransaction(async (conn) => {
    const row = await db.queryOne(
      `SELECT f.review_status, f.service_name, s.invoice_number, s.branch_id FROM sale_item_finance f JOIN sales s ON s.id = f.sale_id
       WHERE f.sale_item_id = ? AND f.sale_id = ? FOR UPDATE`,
      [saleItemId, saleId],
      conn,
    );
    if (!row || row.branch_id !== ctx.branchId) throw ApiError.notFound('Service not found on this sale');
    if (row.review_status !== 'pending') throw ApiError.badRequest('This service does not need a review');
    await db.query(
      "UPDATE sale_item_finance SET review_status = 'reviewed', review_note = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE sale_item_id = ?",
      [note, ctx.userId, saleItemId],
      conn,
    );
    await audit.record(ctx, {
      action: 'sale.service_reviewed', entityType: 'sale', entityId: saleId,
      description: `Reviewed the margin of ${row.service_name} on ${row.invoice_number}: ${note}`,
    }, conn);
  });
}

/** Share of the price that went to staff, as a percentage (for the sale line). */
function effectiveRate(costing) {
  if (!costing.price.greaterThan(0)) return 0;
  return Math.min(100, Math.max(0, toNumber(costing.staffPool.times(100).dividedBy(costing.price), 2)));
}

module.exports = {
  rules, rulesFor, calculate, snapshotOf, canSeeCosts, usageOf, loadProducts, priceUsage, describeUsage, assertInStock, recipesFor, setRecipe,
  appointmentUsage, recordAppointmentProducts, serviceRevenue, costLine, writeStaff, refreshPayouts, recordLine, effectiveRate,
  forSale, correct, review,
};
