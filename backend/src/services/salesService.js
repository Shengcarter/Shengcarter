'use strict';

const db = require('../config/database');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const { camelizeRow, camelizeRows } = require('../utils/case');
const { getPaging, getSort, paginate } = require('../utils/pagination');
const { contains } = require('../utils/sql');
const { D, toNumber } = require('../utils/money');
const { nextSequenceValue, formatNumber } = require('../utils/sequence');
const { DateTime } = require('luxon');
const { localDateRange, localDateString, todayLocal, nowLocal, timezone } = require('../utils/time');
const { hasPermission } = require('../middleware/auth');
const { calculateTotals, applyPayments, splitEvenly } = require('./pricing');
const { findBand, bandName } = require('./financialRules');
const settings = require('./settingsService');
const inventoryService = require('./inventoryService');
const serviceFinance = require('./serviceFinanceService');
const loyaltyService = require('./loyaltyService');
const notificationService = require('./notificationService');
const messaging = require('./messaging');
const audit = require('./auditService');

/**
 * Point of sale.
 *
 * createSale() is a single database transaction:
 *   BEGIN → sale → sale items → for each service: products used taken out of
 *   stock, money split saved (price − products → operations → staff / salon),
 *   staff shares + commissions → payments → retail stock deduction
 *   → loyalty (redeem + earn) → customer stats → appointment completed
 *   → activity log → COMMIT
 * Any failure (e.g. not enough stock) rolls everything back, so a sale is
 * never partially saved. All amounts are computed here with decimal maths;
 * the browser only sends what was sold, the products used and how it was
 * paid. Each service is split with its own financial rule (financialRules.js);
 * a service done by several people shares the staff pool equally.
 *
 * A sale recorded for a previous date keeps that date as its business date
 * (sold_at) while created_at is always when it was actually entered.
 */

function moneySettings() {
  return {
    decimals: Number(settings.get('financial.currency_decimals') ?? 0),
    tax: { mode: settings.get('financial.tax_mode'), rate: Number(settings.get('financial.tax_rate') || 0) },
    allowPartial: Boolean(settings.get('financial.allow_partial_payments')),
  };
}

/** "TZS 40,000" for customer messages. */
function formatAmount(value) {
  const { decimals } = moneySettings();
  const amount = Number(value).toLocaleString('en', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${settings.get('financial.currency_code') || ''} ${amount}`.trim();
}

/** Thank-you message after the customer pays (Settings → Notifications). */
function sendThankYou(customer, { amount, invoiceNumber, saleId }, ctx, conn) {
  return messaging.notifyCustomer(
    'payment_receipt',
    customer,
    { customer_name: customer.full_name.split(' ')[0], amount: formatAmount(amount), invoice_number: invoiceNumber },
    { branchId: ctx.branchId, relatedType: 'sale', relatedId: saleId, createdBy: ctx.userId },
    conn,
  );
}

async function nextDocumentNumbers(conn) {
  const padding = Number(settings.get('financial.number_padding') || 6);
  const invoice = await nextSequenceValue(conn, 'invoice');
  const receipt = await nextSequenceValue(conn, 'receipt');
  return {
    invoiceNumber: formatNumber(settings.get('financial.invoice_prefix') || '', invoice, padding),
    receiptNumber: formatNumber(settings.get('financial.receipt_prefix') || '', receipt, padding),
  };
}

/** Staff on a line: employeeIds (first = lead), or employeeId from older clients. */
function staffOf(item) {
  return [...new Set(item.employeeIds?.length ? item.employeeIds : item.employeeId ? [item.employeeId] : [])];
}

/**
 * Load and validate every line item against the database (prices come from
 * here, never the browser). Products, sold or used on services, are
 * row-locked when `lock` is true. `requireUsage`: services with a recipe must
 * say which products were actually used (an empty list means none).
 */
async function resolveLines(conn, items, branchId, { lock = true, requireEmployee = true, requireUsage = false, decimals = 0 } = {}) {
  const serviceIds = items.filter((i) => i.type === 'service').map((i) => i.serviceId);
  const productIds = items.filter((i) => i.type === 'product').map((i) => i.productId);
  const usedIds = items.filter((i) => i.type === 'service').flatMap((i) => (i.consumption || []).map((c) => c.productId));
  const employeeIds = [...new Set(items.flatMap(staffOf))];

  const services = serviceIds.length ? await db.query('SELECT id, name, price, max_price, is_active FROM services WHERE id IN (?)', [serviceIds], conn) : [];
  const serviceRules = await serviceFinance.rulesFor(serviceIds, conn);
  // Products are locked (in id order) so the stock check and deduction see the same quantity.
  const productRows = productIds.length || usedIds.length
    ? await db.query(
      `SELECT id, name, branch_id, unit, usage_unit, usage_per_unit, selling_price, purchase_price, quantity, status, is_retail
       FROM products WHERE id IN (?) ORDER BY id${lock ? ' FOR UPDATE' : ''}`,
      [[...new Set([...productIds, ...usedIds])]],
      conn,
    )
    : [];
  const productMap = new Map(productRows.map((p) => [p.id, p]));
  const recipes = requireUsage
    ? await serviceFinance.recipesFor(items.filter((i) => i.type === 'service' && !i.consumption).map((i) => i.serviceId), branchId, conn)
    : new Map();
  const employees = employeeIds.length
    ? await db.query("SELECT id, full_name, branch_id, commission_rate, status FROM employees WHERE id IN (?)", [employeeIds], conn)
    : [];

  const errors = [];
  const lines = items.map((item, index) => {
    const staff = staffOf(item).map((employeeId) => employees.find((e) => e.id === employeeId));
    if (staff.some((e) => !e || e.branch_id !== branchId || e.status === 'terminated')) {
      errors.push({ field: `items.${index}.employeeIds`, message: 'Staff member not found in this branch' });
    }
    const team = staff.filter(Boolean).map((e) => ({ id: e.id, fullName: e.full_name, commissionRate: Number(e.commission_rate || 0) }));
    if (item.type === 'service') {
      const service = services.find((s) => s.id === item.serviceId);
      if (!service || !service.is_active) {
        errors.push({ field: `items.${index}.serviceId`, message: 'Service is not available' });
        return null;
      }
      if (!team.length && requireEmployee) errors.push({ field: `items.${index}.employeeIds`, message: `Choose who performed ${service.name}` });
      // Fixed price, or the actual price chosen within the service's range.
      let unitPrice = Number(service.price);
      if (item.price !== undefined && !D(item.price).equals(service.price)) {
        if (service.max_price === null) {
          errors.push({ field: `items.${index}.price`, message: `${service.name} has a fixed price` });
        } else if (D(item.price).lessThan(service.price) || D(item.price).greaterThan(service.max_price)) {
          errors.push({ field: `items.${index}.price`, message: `Enter a price for ${service.name} between ${Number(service.price).toLocaleString('en')} and ${Number(service.max_price).toLocaleString('en')}` });
        } else {
          unitPrice = Number(item.price);
        }
      }
      // The service's financial rule must cover the price charged.
      const rule = serviceRules.get(service.id);
      if (rule?.method === 'unconfigured') {
        errors.push({ field: `items.${index}.serviceId`, message: `${service.name} has no financial rule yet. An administrator must set it up under Services before it can be sold.` });
      } else if (rule?.method === 'bands') {
        if ((item.quantity || 1) !== 1) {
          errors.push({ field: `items.${index}.quantity`, message: `${service.name} is priced per service: add it once for each customer` });
        }
        if (!findBand(rule.config, unitPrice)) {
          errors.push({ field: `items.${index}.price`, message: `${service.name} has no financial rule for ${unitPrice.toLocaleString('en')}. Configured prices: ${rule.config.bands.map(bandName).join(', ')}.` });
        }
      }
      // Products actually used, costed at the salon's recorded purchase cost.
      let usage = { lines: [], total: D(0) };
      if (item.consumption) {
        usage = serviceFinance.priceUsage(item.consumption, productMap, { branchId, decimals, field: `items.${index}.consumption` });
      } else if (recipes.get(service.id)?.length) {
        errors.push({ field: `items.${index}.consumption`, message: `Confirm the products used for ${service.name} (clear the list if none were used)` });
      }
      return {
        type: 'service', serviceId: service.id, productId: null, employeeId: team[0]?.id || null, staff: team,
        description: service.name, quantity: item.quantity || 1, unitPrice, unitCost: 0, usage, rule,
        priceRange: service.max_price === null ? null : { min: Number(service.price), max: Number(service.max_price) },
      };
    }
    const product = productMap.get(item.productId);
    if (!product || product.branch_id !== branchId || product.status !== 'active' || !product.is_retail) {
      errors.push({ field: `items.${index}.productId`, message: 'Product is not available for sale in this branch' });
      return null;
    }
    const alreadyInCart = items.slice(0, index).filter((i) => i.productId === product.id).reduce((s, i) => s + i.quantity, 0);
    if (product.quantity < alreadyInCart + item.quantity) {
      errors.push({ field: `items.${index}.quantity`, message: `Only ${product.quantity} × ${product.name} in stock` });
    }
    return {
      type: 'product', serviceId: null, productId: product.id, employeeId: team[0]?.id || null, staff: team.slice(0, 1),
      description: product.name, quantity: item.quantity, unitPrice: product.selling_price, unitCost: product.purchase_price,
    };
  });
  if (errors.length) throw ApiError.validation(errors);

  // Products used on services come out of the same stock as products sold.
  const needs = new Map();
  for (const line of lines) {
    for (const used of line.usage?.lines || []) needs.set(used.productId, (needs.get(used.productId) || D(0)).plus(used.stockQuantity));
  }
  for (const line of lines.filter((l) => l.type === 'product' && needs.has(l.productId))) needs.set(line.productId, needs.get(line.productId).plus(line.quantity));
  serviceFinance.assertInStock(needs, productMap);
  return lines;
}

/**
 * Insert one sale line with its staff shares. A service line carries its money
 * split (`line.costing`): the products used are saved and taken out of stock,
 * the breakdown is saved, and the staff pool is shared equally between the
 * people who performed it as their commission. Product lines (who sold it)
 * have no split and earn no commission, but the value is still shared so staff
 * figures add up. Imported history is split the same way; its commissions are
 * recorded as already paid (`commissionStatus`).
 */
async function insertLine(conn, { saleId, line, branchId, at, stockAt = at, decimals, invoiceNumber = null, userId = null, note = '', commissionStatus = 'earned' }) {
  const costing = line.costing || null;
  const revenueShares = splitEvenly(line.netAmount, Math.max(1, line.staff.length), decimals);
  const unitCost = costing ? toNumber(line.usage.total.dividedBy(line.quantity)) : line.unitCost;
  const itemResult = await db.query(
    `INSERT INTO sale_items (sale_id, item_type, service_id, product_id, employee_id, description, quantity, unit_price, unit_cost,
                             line_total, net_amount, commission_rate, commission_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [saleId, line.type, line.serviceId, line.productId, line.employeeId, line.description, line.quantity, line.unitPrice, unitCost,
      toNumber(line.lineTotal), toNumber(line.netAmount), costing ? serviceFinance.effectiveRate(costing) : 0, costing ? toNumber(costing.staffPool) : 0],
    conn,
  );
  const saleItemId = itemResult.insertId;
  if (costing) await serviceFinance.recordLine(conn, { saleItemId, saleId, branchId, line, costing, at, stockAt, invoiceNumber, userId, note });
  await serviceFinance.writeStaff(conn, { saleItemId, saleId, branchId, staff: line.staff, revenueShares, costing, at, commissionStatus });
  return saleItemId;
}

/**
 * Each service line's money split with its own rule (from what it was charged
 * after discounts). Errors point at the line.
 */
function costServiceLines(lines, { tax, decimals, rates = serviceFinance.rules() }) {
  lines.forEach((line, index) => {
    if (line.type !== 'service') return;
    line.costing = serviceFinance.costLine({ line, tax, decimals, rates, field: `items.${index}.price` });
  });
}

/**
 * When the sale happened (its business date) and how it was entered. A sale
 * recorded for a previous date ("Record previous sale") needs the
 * sales.backdate permission and a reason, and cannot be in the future.
 */
function saleTiming(data, ctx, options) {
  if (options.soldAt) return { soldAt: options.soldAt, source: 'pos', backdated: false, reason: null }; // trusted callers (demo history)
  if (!data.soldDate) return { soldAt: new Date(), source: 'pos', backdated: false, reason: null };
  if (!hasPermission(ctx.user, 'sales.backdate')) {
    throw ApiError.forbidden('Recording a sale for a previous date needs the "Record previous sales" permission');
  }
  const today = todayLocal();
  if (data.soldDate > today) throw ApiError.validation([{ field: 'soldDate', message: 'A sale cannot be recorded for a future date' }]);
  const time = data.soldTime || (data.soldDate === today ? nowLocal().toFormat('HH:mm') : '12:00');
  const at = DateTime.fromISO(`${data.soldDate}T${time}`, { zone: timezone() });
  if (!at.isValid) throw ApiError.validation([{ field: 'soldTime', message: 'Enter a valid date and time' }]);
  if (at.toMillis() > Date.now()) throw ApiError.validation([{ field: 'soldTime', message: 'The time of the sale cannot be later than now' }]);
  const reason = String(data.backdateReason || '').trim();
  if (reason.length < 3) throw ApiError.validation([{ field: 'backdateReason', message: 'Say why this sale is being recorded late' }]);
  return { soldAt: at.toJSDate(), source: 'backdated', backdated: true, reason };
}

async function createSale(data, ctx, options = {}) {
  const { decimals, tax, allowPartial } = moneySettings();
  const timing = saleTiming(data, ctx, options);
  const { soldAt } = timing;

  const result = await db.withTransaction(async (conn) => {
    // Customer and appointment
    let customer = null;
    if (data.customerId) {
      customer = await db.queryOne('SELECT id, full_name, phone, email, preferred_channel, loyalty_points, lifetime_points FROM customers WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [data.customerId], conn);
      if (!customer) throw ApiError.validation([{ field: 'customerId', message: 'Customer not found' }]);
    }
    let appointment = null;
    if (data.appointmentId) {
      appointment = await db.queryOne('SELECT id, code, branch_id, customer_id, status, start_time FROM appointments WHERE id = ? FOR UPDATE', [data.appointmentId], conn);
      if (!appointment || appointment.branch_id !== ctx.branchId) throw ApiError.validation([{ field: 'appointmentId', message: 'Appointment not found' }]);
      if (['cancelled', 'no_show'].includes(appointment.status)) throw ApiError.badRequest(`Appointment ${appointment.code} is ${appointment.status.replace('_', ' ')}`);
      // Billing completes the appointment, so it must not be for a later day.
      if (localDateString(appointment.start_time) > localDateString(soldAt)) {
        throw ApiError.badRequest(`Appointment ${appointment.code} is scheduled for ${localDateString(appointment.start_time)}; bill it on the day of the visit`);
      }
      const billed = await db.queryOne("SELECT invoice_number FROM sales WHERE appointment_id = ? AND status = 'completed'", [appointment.id], conn);
      if (billed) throw ApiError.conflict(`Appointment ${appointment.code} was already billed on ${billed.invoice_number}`);
      if (customer && appointment.customer_id !== customer.id) throw ApiError.validation([{ field: 'customerId', message: 'The customer does not match the appointment' }]);
    }

    // Pricing (server-authoritative)
    const lines = await resolveLines(conn, data.items, ctx.branchId, { requireUsage: true, decimals });
    const discount = data.discount || { type: 'none', value: 0 };
    const pointsToRedeem = customer ? Number(data.loyaltyPoints || 0) : 0;
    let totals;
    try {
      const preview = calculateTotals({ lines, discount, tax, decimals });
      const loyaltyDiscount = pointsToRedeem
        ? loyaltyService.redemptionValue(pointsToRedeem, customer.loyalty_points, preview.subtotal.minus(preview.discountAmount), decimals)
        : D(0);
      totals = calculateTotals({ lines, discount, loyaltyDiscount, tax, decimals });
    } catch (error) {
      if (error instanceof RangeError) throw ApiError.validation([{ field: 'discount', message: error.message }]);
      throw error;
    }

    let paid;
    try {
      paid = applyPayments({ total: totals.total, payments: data.payments || [], decimals });
    } catch (error) {
      if (error instanceof RangeError) throw ApiError.validation([{ field: 'payments', message: error.message }]);
      throw error;
    }
    if (paid.balance.greaterThan(0)) {
      if (!customer) throw ApiError.validation([{ field: 'payments', message: 'Walk-in sales must be paid in full. Select a customer to leave a balance.' }]);
      if (!allowPartial) throw ApiError.validation([{ field: 'payments', message: 'Partial payments are disabled in Settings. Collect the full amount.' }]);
    }

    // Each service's money split, with its own rule.
    costServiceLines(totals.lines, { tax, decimals });
    // Cost of goods: retail products sold plus products used on services.
    const costOfGoods = lines.reduce((sum, l) => sum.plus(l.type === 'service' ? l.usage.total : D(l.unitCost).times(l.quantity)), D(0));
    const numbers = await nextDocumentNumbers(conn);
    // created_at is when the sale was entered (demo history is entered "at the time").
    const enteredAt = options.demo ? soldAt : null;

    // Sale header
    const saleResult = await db.query(
      `INSERT INTO sales (invoice_number, receipt_number, branch_id, customer_id, appointment_id, cashier_id, subtotal, discount_type, discount_value,
                          discount_amount, loyalty_points_redeemed, loyalty_discount, tax_mode, tax_rate, tax_amount, total, amount_tendered,
                          amount_paid, change_due, balance_due, cost_of_goods, status, source, is_backdated, backdate_reason, payment_status, notes,
                          sold_at, original_sold_at, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))`,
      [
        numbers.invoiceNumber, numbers.receiptNumber, ctx.branchId, customer?.id || null, appointment?.id || null, ctx.userId,
        toNumber(totals.subtotal), discount.type || 'none', Number(discount.value || 0), toNumber(totals.discountAmount),
        pointsToRedeem, toNumber(totals.loyaltyDiscount), tax.mode, tax.mode === 'none' ? 0 : tax.rate, toNumber(totals.taxAmount),
        toNumber(totals.total), toNumber(paid.tendered), toNumber(paid.amountPaid), toNumber(paid.change), toNumber(paid.balance),
        toNumber(costOfGoods), timing.source, timing.backdated ? 1 : 0, timing.reason, paid.status, data.notes || null,
        soldAt, soldAt, options.demo ? 1 : 0, enteredAt,
      ],
      conn,
    );
    const saleId = saleResult.insertId;

    // Items + staff shares + commissions + stock. Stock leaves now: for a sale
    // recorded late the movement is dated when it is entered (the stock count
    // is today's), with the sale's date in the reason.
    const stockAt = timing.backdated ? null : soldAt;
    const late = timing.backdated ? ` (sale of ${localDateString(soldAt)}, recorded later)` : '';
    for (const line of totals.lines) {
      await insertLine(conn, { saleId, line, branchId: ctx.branchId, at: soldAt, stockAt, decimals, invoiceNumber: numbers.invoiceNumber, userId: ctx.userId, note: late });
      if (line.type === 'product') {
        await inventoryService.changeStock(conn, {
          productId: line.productId, branchId: ctx.branchId, change: -line.quantity, type: 'sale', unitCost: line.unitCost,
          referenceType: 'sale', referenceId: saleId, reason: `Sold on ${numbers.invoiceNumber}${late}`, userId: ctx.userId, at: stockAt,
        });
      }
    }

    // Payments: received on the business date, entered now.
    for (const payment of paid.payments) {
      await db.query(
        'INSERT INTO payments (sale_id, branch_id, method, type, amount, reference, received_by, paid_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))',
        [saleId, ctx.branchId, payment.method, 'payment', toNumber(payment.amount), payment.reference || null, ctx.userId, soldAt, enteredAt],
        conn,
      );
    }

    // Loyalty: redeem first, then earn on the amount actually charged (pre-tax).
    let pointsEarned = 0;
    if (customer) {
      if (pointsToRedeem) {
        await loyaltyService.applyChange(conn, {
          customerId: customer.id, points: -pointsToRedeem, type: 'redeem', saleId, userId: ctx.userId,
          description: `Redeemed on ${numbers.invoiceNumber}`, affectsLifetime: false, at: soldAt,
        });
      }
      pointsEarned = await loyaltyService.pointsForAmount(totals.taxable, customer.lifetime_points);
      if (pointsEarned > 0) {
        await loyaltyService.applyChange(conn, {
          customerId: customer.id, points: pointsEarned, type: 'earn', saleId, userId: ctx.userId,
          description: `Earned on ${numbers.invoiceNumber}`, affectsLifetime: true, at: soldAt,
        });
        await db.query('UPDATE sales SET loyalty_points_earned = ? WHERE id = ?', [pointsEarned, saleId], conn);
      }
      // A sale recorded late never moves the last visit backwards.
      await db.query(
        'UPDATE customers SET total_spent = total_spent + ?, visit_count = visit_count + 1, last_visit_at = GREATEST(COALESCE(last_visit_at, ?), ?) WHERE id = ?',
        [toNumber(totals.total), soldAt, soldAt, customer.id],
        conn,
      );
    }

    if (appointment && appointment.status !== 'completed') {
      await db.query(
        "UPDATE appointments SET status = 'completed', completed_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ?",
        [soldAt, soldAt, appointment.id],
        conn,
      );
    }

    if (options.silent) return { saleId, productIds: [] };
    const summary = { total: toNumber(totals.total), paid: toNumber(paid.amountPaid), balance: toNumber(paid.balance), items: lines.length };
    if (timing.backdated) {
      await audit.record(ctx, {
        action: 'sale.backdated', entityType: 'sale', entityId: saleId,
        description: `Sale ${numbers.invoiceNumber} recorded for ${localDateString(soldAt)} — total ${summary.total}${customer ? ` for ${customer.full_name}` : ''}: ${timing.reason}`,
        metadata: { ...summary, soldAt: soldAt.toISOString(), reason: timing.reason },
      }, conn);
    } else {
      await audit.record(ctx, {
        action: 'sale.completed', entityType: 'sale', entityId: saleId,
        description: `Sale ${numbers.invoiceNumber} completed — total ${summary.total}${customer ? ` for ${customer.full_name}` : ''}`,
        metadata: summary,
      }, conn);
    }

    // No thank-you message for a sale recorded after the visit.
    if (customer && paid.amountPaid.greaterThan(0) && !timing.backdated) {
      await sendThankYou(customer, { amount: toNumber(paid.amountPaid), invoiceNumber: numbers.invoiceNumber, saleId }, ctx, conn);
    }
    const usedIds = lines.flatMap((l) => (l.usage?.lines || []).map((u) => u.productId));
    return {
      saleId, invoiceNumber: numbers.invoiceNumber,
      productIds: [...new Set([...lines.filter((l) => l.productId).map((l) => l.productId), ...usedIds])],
    };
  });

  await inventoryService.alertLowStock(result.productIds, ctx.branchId).catch((err) => logger.error({ err }, 'Low stock alert failed'));
  if (timing.backdated) {
    await notificationService.notifyByPermission({
      permission: 'sales.edit_history',
      branchId: ctx.branchId,
      type: 'sale.backdated',
      category: 'payment',
      title: 'Sale recorded for a previous date',
      message: `${ctx.user?.fullName || 'A user'} recorded ${result.invoiceNumber} for ${localDateString(soldAt)}: ${timing.reason}`,
      link: `/pos/sales/${result.saleId}`,
    }).catch((err) => logger.error({ err }, 'Backdated sale notification failed'));
  }
  return getById(result.saleId, ctx);
}

/**
 * Price a cart without saving anything (used by the POS screen for a live,
 * server-calculated preview). Returns the same figures createSale() would use.
 */
async function quote(data, ctx) {
  const { decimals, tax, allowPartial } = moneySettings();
  let customer = null;
  if (data.customerId) {
    customer = await db.queryOne('SELECT id, loyalty_points, lifetime_points FROM customers WHERE id = ? AND deleted_at IS NULL', [data.customerId]);
    if (!customer) throw ApiError.validation([{ field: 'customerId', message: 'Customer not found' }]);
  }
  const lines = await resolveLines(null, data.items, ctx.branchId, { lock: false, requireEmployee: false, decimals });
  const discount = data.discount || { type: 'none', value: 0 };
  const points = customer ? Number(data.loyaltyPoints || 0) : 0;
  let totals;
  try {
    const preview = calculateTotals({ lines, discount, tax, decimals });
    const loyaltyDiscount = points ? loyaltyService.redemptionValue(points, customer.loyalty_points, preview.subtotal.minus(preview.discountAmount), decimals) : D(0);
    totals = calculateTotals({ lines, discount, loyaltyDiscount, tax, decimals });
  } catch (error) {
    if (error instanceof RangeError) throw ApiError.validation([{ field: 'discount', message: error.message }]);
    throw error;
  }
  const cfg = loyaltyService.config();
  const maxByPercent = totals.subtotal.minus(totals.discountAmount).times(cfg.maxRedeemPercent).dividedBy(100);
  const maxRedeemable = customer && cfg.enabled && cfg.redeemValuePerPoint > 0
    ? Math.min(customer.loyalty_points, maxByPercent.dividedBy(cfg.redeemValuePerPoint).floor().toNumber())
    : 0;
  // Service lines show the products used and a flag for a zero or negative margin;
  // people who see costs also get the full money split.
  const showCosts = serviceFinance.canSeeCosts(ctx);
  costServiceLines(totals.lines, { tax, decimals });
  return {
    lines: totals.lines.map((l) => {
      const out = {
        type: l.type, serviceId: l.serviceId, productId: l.productId, employeeId: l.employeeId, employeeIds: l.staff.map((m) => m.id), description: l.description,
        quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: toNumber(l.lineTotal), netAmount: toNumber(l.netAmount),
      };
      if (l.type !== 'service') return out;
      const { costing } = l;
      out.priceRange = l.priceRange;
      out.priceOptions = pointPrices(l.rule);
      out.productsIncluded = l.rule ? l.rule.config.productsIncluded !== false : true;
      out.productsUsed = serviceFinance.describeUsage(l.usage).map((u) => (showCosts ? u : { productId: u.productId, name: u.name, unit: u.unit, quantity: u.quantity }));
      out.marginStatus = costing.marginStatus;
      if (showCosts) {
        const m = (v) => toNumber(v, decimals);
        out.split = {
          price: m(costing.price), productCost: m(costing.productCost), amountAfterProducts: m(costing.afterProducts), operations: m(costing.operations),
          distributable: m(costing.distributable), staffPool: m(costing.staffPool), salonProfit: m(costing.salonProfit),
          staffShares: costing.staffShares.map(m), rates: costing.rates, consumptionCost: m(costing.consumptionCost),
          method: costing.method, band: costing.band,
        };
      }
      return out;
    }),
    subtotal: toNumber(totals.subtotal),
    discountAmount: toNumber(totals.discountAmount),
    loyaltyDiscount: toNumber(totals.loyaltyDiscount),
    taxMode: tax.mode,
    taxRate: tax.rate,
    taxAmount: toNumber(totals.taxAmount),
    total: toNumber(totals.total),
    allowPartial,
    loyalty: customer
      ? {
          balance: customer.loyalty_points,
          pointsToEarn: await loyaltyService.pointsForAmount(totals.taxable, customer.lifetime_points),
          minRedeemPoints: cfg.minRedeemPoints,
          redeemValuePerPoint: cfg.redeemValuePerPoint,
          maxRedeemable: maxRedeemable >= cfg.minRedeemPoints ? maxRedeemable : 0,
          enabled: cfg.enabled,
        }
      : null,
  };
}

/**
 * The prices a service can be sold at when its rule only covers single prices
 * (e.g. Steaming: 10,000 / 15,000 / 20,000 / 25,000), else null.
 */
function pointPrices(rule) {
  if (rule?.method !== 'bands' || !rule.config.bands.length) return null;
  if (!rule.config.bands.every((b) => b.min === b.max)) return null;
  return rule.config.bands.map((b) => b.min).sort((a, b) => a - b);
}

// ---- Queries -------------------------------------------------------------------------------

async function getById(id, ctx) {
  const sale = await db.queryOne(
    `SELECT s.*, c.full_name AS customer_name, c.phone AS customer_phone, c.code AS customer_code, c.loyalty_points AS customer_loyalty_points,
            u.full_name AS cashier_name, rb.full_name AS refunded_by_name, vb.full_name AS voided_by_name, ub.full_name AS updated_by_name,
            b.name AS branch_name, b.address AS branch_address, b.phone AS branch_phone, a.code AS appointment_code
     FROM sales s
     LEFT JOIN customers c ON c.id = s.customer_id
     JOIN users u ON u.id = s.cashier_id
     LEFT JOIN users rb ON rb.id = s.refunded_by
     LEFT JOIN users vb ON vb.id = s.voided_by
     LEFT JOIN users ub ON ub.id = s.updated_by
     JOIN branches b ON b.id = s.branch_id
     LEFT JOIN appointments a ON a.id = s.appointment_id
     WHERE s.id = ?`,
    [id],
  );
  if (!sale || sale.branch_id !== ctx.branchId) throw ApiError.notFound('Sale not found');
  const [items, payments] = await Promise.all([
    db.query(
      `SELECT si.id, si.item_type, si.service_id, si.product_id, si.employee_id, e.full_name AS employee_name, si.description, si.quantity,
              si.unit_price, si.line_total, si.net_amount, si.commission_rate, si.commission_amount
       FROM sale_items si LEFT JOIN employees e ON e.id = si.employee_id WHERE si.sale_id = ? ORDER BY si.id`,
      [id],
    ),
    db.query(
      `SELECT p.id, p.method, p.type, p.amount, p.reference, p.paid_at, u.full_name AS received_by_name
       FROM payments p LEFT JOIN users u ON u.id = p.received_by WHERE p.sale_id = ? ORDER BY p.paid_at, p.id`,
      [id],
    ),
  ]);
  // Who performed each line, with their share (several people share a service equally).
  const staffRows = items.length
    ? await db.query(
      `SELECT sis.sale_item_id, sis.employee_id, e.full_name, sis.revenue_share, sis.commission_amount
       FROM sale_item_staff sis JOIN employees e ON e.id = sis.employee_id
       WHERE sis.sale_item_id IN (?) ORDER BY sis.sale_item_id, sis.sort_order`,
      [items.map((i) => i.id)],
    )
    : [];
  const finance = await serviceFinance.forSale(id, items.filter((i) => i.item_type === 'service').map((i) => i.id), ctx);
  const withStaff = camelizeRows(items).map((item) => {
    const staff = staffRows.filter((r) => r.sale_item_id === item.id)
      .map((r) => ({ id: r.employee_id, fullName: r.full_name, revenueShare: Number(r.revenue_share), commissionAmount: Number(r.commission_amount) }));
    return { ...item, ...(finance.get(item.id) || {}), staff, employeeName: staff.length ? staff.map((m) => m.fullName).join(', ') : item.employeeName };
  });
  const result = { ...camelizeRow(sale), items: withStaff, payments: camelizeRows(payments) };
  // Cost figures are only for people who can see financial reports.
  if (!ctx.user?.isSuperAdmin && !ctx.user?.permissions?.has('reports.financial')) {
    delete result.costOfGoods;
  }
  return result;
}

const SORTS = { soldAt: 's.sold_at', total: 's.total', invoice: 's.invoice_number' };

async function list(filters, ctx) {
  const where = ['s.branch_id = ?'];
  const params = [ctx.branchId];
  if (filters.from || filters.to) {
    const range = localDateRange(filters.from || '2000-01-01', filters.to || '2999-12-31');
    where.push('s.sold_at >= ? AND s.sold_at < ?');
    params.push(range.start, range.end);
  }
  if (filters.status) {
    where.push('s.status = ?');
    params.push(filters.status);
  }
  if (filters.source) {
    where.push('s.source = ?');
    params.push(filters.source);
  }
  if (filters.paymentStatus) {
    where.push('s.payment_status = ?');
    params.push(filters.paymentStatus);
  }
  if (filters.cashierId) {
    where.push('s.cashier_id = ?');
    params.push(filters.cashierId);
  }
  if (filters.customerId) {
    where.push('s.customer_id = ?');
    params.push(filters.customerId);
  }
  if (filters.method) {
    where.push('EXISTS (SELECT 1 FROM payments p WHERE p.sale_id = s.id AND p.method = ?)');
    params.push(filters.method);
  }
  if (filters.search) {
    where.push('(s.invoice_number LIKE ? OR s.receipt_number LIKE ? OR c.full_name LIKE ? OR c.phone LIKE ?)');
    params.push(...Array(4).fill(contains(filters.search)));
  }
  const from = `FROM sales s LEFT JOIN customers c ON c.id = s.customer_id JOIN users u ON u.id = s.cashier_id WHERE ${where.join(' AND ')}`;
  const result = await paginate({
    select: `s.id, s.invoice_number, s.receipt_number, s.sold_at, s.subtotal, s.discount_amount, s.tax_amount, s.total, s.amount_paid,
             s.balance_due, s.status, s.payment_status, s.is_imported, s.source, s.is_backdated, s.created_at, s.customer_id, c.full_name AS customer_name, u.full_name AS cashier_name,
             (SELECT GROUP_CONCAT(DISTINCT p.method) FROM payments p WHERE p.sale_id = s.id AND p.type = 'payment') AS methods,
             (SELECT COUNT(*) FROM sale_items si WHERE si.sale_id = s.id) AS item_count`,
    from,
    params,
    orderBy: `${getSort(filters.sortBy, filters.sortOrder, SORTS, 'soldAt')}, s.id DESC`,
    paging: getPaging(filters),
  });
  const summary = await db.queryOne(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.total END), 0) AS total,
            COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.amount_paid END), 0) AS paid,
            COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.balance_due END), 0) AS balance
     ${from}`,
    params,
  );
  return {
    ...result,
    rows: camelizeRows(result.rows),
    summary: { count: Number(summary.count), total: Number(summary.total), paid: Number(summary.paid), balance: Number(summary.balance) },
  };
}

async function listPayments(filters, ctx) {
  const where = ['p.branch_id = ?'];
  const params = [ctx.branchId];
  if (filters.from || filters.to) {
    const range = localDateRange(filters.from || '2000-01-01', filters.to || '2999-12-31');
    where.push('p.paid_at >= ? AND p.paid_at < ?');
    params.push(range.start, range.end);
  }
  if (filters.method) {
    where.push('p.method = ?');
    params.push(filters.method);
  }
  if (filters.type) {
    where.push('p.type = ?');
    params.push(filters.type);
  }
  const from = `FROM payments p JOIN sales s ON s.id = p.sale_id LEFT JOIN customers c ON c.id = s.customer_id LEFT JOIN users u ON u.id = p.received_by WHERE ${where.join(' AND ')}`;
  const result = await paginate({
    select: 'p.id, p.method, p.type, p.amount, p.reference, p.paid_at, s.id AS sale_id, s.invoice_number, c.full_name AS customer_name, u.full_name AS received_by_name',
    from,
    params,
    orderBy: 'p.paid_at DESC, p.id DESC',
    paging: getPaging(filters),
  });
  const byMethod = await db.query(`SELECT p.method, COALESCE(SUM(p.amount), 0) AS total ${from} GROUP BY p.method`, params);
  return { ...result, rows: camelizeRows(result.rows), summary: Object.fromEntries(byMethod.map((m) => [m.method, Number(m.total)])) };
}

// ---- Balance payments ------------------------------------------------------------------------

async function recordPayment(saleId, data, ctx) {
  const { decimals } = moneySettings();
  const result = await db.withTransaction(async (conn) => {
    const sale = await db.queryOne(
      'SELECT id, invoice_number, branch_id, status, total, amount_paid, balance_due, customer_id FROM sales WHERE id = ? FOR UPDATE',
      [saleId],
      conn,
    );
    if (!sale || sale.branch_id !== ctx.branchId) throw ApiError.notFound('Sale not found');
    if (sale.status !== 'completed') throw ApiError.badRequest('Payments can only be added to completed sales');
    if (D(sale.balance_due).lessThanOrEqualTo(0)) throw ApiError.badRequest('This invoice is already fully paid');

    let paid;
    try {
      paid = applyPayments({ total: sale.balance_due, payments: [data], decimals });
    } catch (error) {
      throw ApiError.validation([{ field: 'amount', message: error.message }]);
    }
    const now = new Date();
    for (const payment of paid.payments) {
      await db.query(
        'INSERT INTO payments (sale_id, branch_id, method, type, amount, reference, received_by, paid_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [sale.id, ctx.branchId, payment.method, 'payment', toNumber(payment.amount), payment.reference || null, ctx.userId, now],
        conn,
      );
    }
    const amountPaid = D(sale.amount_paid).plus(paid.amountPaid);
    const balance = D(sale.total).minus(amountPaid);
    await db.query(
      'UPDATE sales SET amount_paid = ?, balance_due = ?, payment_status = ? WHERE id = ?',
      [toNumber(amountPaid), toNumber(balance), balance.lessThanOrEqualTo(0) ? 'paid' : 'partial', sale.id],
      conn,
    );
    await audit.record(ctx, {
      action: 'sale.payment_recorded', entityType: 'sale', entityId: sale.id,
      description: `Received ${toNumber(paid.amountPaid)} (${data.method}) on ${sale.invoice_number}`,
    }, conn);
    // Served now, paid later: the thank-you goes with the first payment.
    if (sale.customer_id && D(sale.amount_paid).lessThanOrEqualTo(0)) {
      const customer = await db.queryOne('SELECT id, full_name, phone, email, preferred_channel FROM customers WHERE id = ? AND deleted_at IS NULL', [sale.customer_id], conn);
      if (customer) await sendThankYou(customer, { amount: toNumber(paid.amountPaid), invoiceNumber: sale.invoice_number, saleId: sale.id }, ctx, conn);
    }
    return { sale, received: toNumber(paid.amountPaid), change: toNumber(paid.change), balance: toNumber(balance) };
  });

  await notificationService.notifyByPermission({
    permission: 'reports.financial',
    branchId: ctx.branchId,
    type: 'payment.received',
    category: 'payment',
    title: 'Payment received',
    message: `${result.received.toLocaleString('en')} received on ${result.sale.invoice_number}${result.balance > 0 ? ` (${result.balance.toLocaleString('en')} still due)` : ' — now fully paid'}.`,
    link: `/pos/sales/${saleId}`,
  });
  return { ...(await getById(saleId, ctx)), changeGiven: result.change };
}

// ---- Refunds, voids and date changes ----------------------------------------------------------

/**
 * Undo a sale's effects, in the caller's transaction. A refund gives the money
 * back today (refund payments) and restocks retail products; a void cancels a
 * sale recorded by mistake as if it never happened: its payments are reversed
 * on the day they were received, and the products used on its services go
 * back into stock too. Both reverse commissions and loyalty points and
 * correct the customer's figures. Imported history never moved stock, so it
 * puts none back.
 */
async function reverseSale(conn, sale, ctx, { kind, at = null }) {
  const label = kind === 'void' ? `void of ${sale.invoice_number}` : `refund of ${sale.invoice_number}`;
  const stockType = kind === 'void' ? 'void' : 'refund';
  if (!sale.is_imported) {
    const items = await db.query("SELECT product_id, quantity, unit_cost FROM sale_items WHERE sale_id = ? AND item_type = 'product'", [sale.id], conn);
    for (const item of items) {
      await inventoryService.changeStock(conn, {
        productId: item.product_id, branchId: sale.branch_id, change: item.quantity, type: stockType, unitCost: item.unit_cost,
        referenceType: 'sale', referenceId: sale.id, reason: `${kind === 'void' ? 'Void' : 'Refund'} of ${sale.invoice_number}`, userId: ctx.userId, at,
      });
    }
    if (kind === 'void') {
      const used = await db.query(
        `SELECT sip.product_id, sip.stock_quantity, sip.unit_cost, sip.product_name FROM sale_item_products sip JOIN sale_items si ON si.id = sip.sale_item_id
         WHERE si.sale_id = ? AND sip.stock_quantity > 0 ORDER BY sip.product_id`,
        [sale.id],
        conn,
      );
      for (const u of used) {
        await inventoryService.changeStock(conn, {
          productId: u.product_id, branchId: sale.branch_id, change: Number(u.stock_quantity), type: 'void', unitCost: u.unit_cost,
          referenceType: 'sale', referenceId: sale.id, reason: `Products used returned — void of ${sale.invoice_number}`, userId: ctx.userId,
        });
      }
    }
  }

  const payouts = await db.query('SELECT DISTINCT salary_record_id AS id FROM commissions WHERE sale_id = ? AND salary_record_id IS NOT NULL', [sale.id], conn);
  await db.query("UPDATE commissions SET status = 'reversed' WHERE sale_id = ?", [sale.id], conn);
  await serviceFinance.refreshPayouts(conn, new Set(payouts.map((p) => p.id)));

  if (kind === 'void') {
    // Each payment is cancelled on the day it was received, so that day's takings exclude it.
    const received = await db.query("SELECT method, amount, reference, paid_at FROM payments WHERE sale_id = ? AND type = 'payment' ORDER BY id", [sale.id], conn);
    for (const row of received) {
      await db.query(
        `INSERT INTO payments (sale_id, branch_id, method, type, amount, reference, received_by, paid_at, created_at)
         VALUES (?, ?, ?, 'void', ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [sale.id, sale.branch_id, row.method, -Number(row.amount), `Void ${sale.invoice_number}`, ctx.userId, row.paid_at],
        conn,
      );
    }
  } else {
    // Money back by the same methods it was received with.
    const received = await db.query('SELECT method, SUM(amount) AS amount FROM payments WHERE sale_id = ? GROUP BY method HAVING SUM(amount) > 0', [sale.id], conn);
    for (const row of received) {
      await db.query(
        `INSERT INTO payments (sale_id, branch_id, method, type, amount, reference, received_by, paid_at, created_at)
         VALUES (?, ?, ?, 'refund', ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()), COALESCE(?, UTC_TIMESTAMP()))`,
        [sale.id, sale.branch_id, row.method, -Number(row.amount), `Refund ${sale.invoice_number}`, ctx.userId, at, at],
        conn,
      );
    }
  }

  if (sale.customer_id) {
    const customer = await db.queryOne('SELECT loyalty_points FROM customers WHERE id = ? FOR UPDATE', [sale.customer_id], conn);
    if (sale.loyalty_points_redeemed) {
      await loyaltyService.applyChange(conn, {
        customerId: sale.customer_id, points: sale.loyalty_points_redeemed, type: 'reverse', saleId: sale.id, userId: ctx.userId,
        description: `Redeemed points returned — ${label}`, affectsLifetime: false, at,
      });
    }
    if (sale.loyalty_points_earned) {
      // If the customer already spent some of these points, remove what is left.
      const available = customer.loyalty_points + (sale.loyalty_points_redeemed || 0);
      const toRemove = Math.min(sale.loyalty_points_earned, available);
      if (toRemove > 0) {
        await loyaltyService.applyChange(conn, {
          customerId: sale.customer_id, points: -toRemove, type: 'reverse', saleId: sale.id, userId: ctx.userId,
          description: `Earned points removed — ${label}`, affectsLifetime: true, at,
        });
      }
    }
    await db.query(
      'UPDATE customers SET total_spent = GREATEST(0, total_spent - ?), visit_count = GREATEST(0, CAST(visit_count AS SIGNED) - 1) WHERE id = ?',
      [sale.total, sale.customer_id],
      conn,
    );
  }
}

/**
 * Full refund, in one transaction: restock products, reverse commissions,
 * reverse earned loyalty points and restore redeemed ones, record refund
 * payments (negative amounts) and update customer statistics.
 */
async function refundSale(saleId, { reason }, ctx, options = {}) {
  const at = options.at || null; // trusted callers only (demo history)
  await db.withTransaction(async (conn) => {
    const sale = await db.queryOne('SELECT * FROM sales WHERE id = ? FOR UPDATE', [saleId], conn);
    if (!sale || sale.branch_id !== ctx.branchId) throw ApiError.notFound('Sale not found');
    if (sale.status === 'refunded') throw ApiError.conflict('This sale has already been refunded');
    if (sale.status === 'voided') throw ApiError.conflict('This sale was voided');

    await reverseSale(conn, sale, ctx, { kind: 'refund', at });
    await db.query(
      "UPDATE sales SET status = 'refunded', refund_reason = ?, refunded_at = COALESCE(?, UTC_TIMESTAMP()), refunded_by = ?, balance_due = 0, updated_by = ? WHERE id = ?",
      [reason, at, ctx.userId, ctx.userId, saleId],
      conn,
    );
    if (options.silent) return;
    await audit.record(ctx, {
      action: 'sale.refunded', entityType: 'sale', entityId: saleId,
      description: `Refunded ${sale.invoice_number} (${sale.total}) — ${reason}`,
      metadata: { total: sale.total, amountPaid: sale.amount_paid },
      before: { status: sale.status },
      after: { status: 'refunded', reason },
    }, conn);
  });

  if (options.silent) return getById(saleId, ctx);
  await notificationService.notifyByPermission({
    permission: 'users.manage',
    branchId: ctx.branchId,
    type: 'sale.refunded',
    category: 'payment',
    title: 'Sale refunded',
    message: `${ctx.user?.fullName || 'A user'} refunded a sale: ${reason}`,
    link: `/pos/sales/${saleId}`,
  });
  return getById(saleId, ctx);
}

/** Commissions of a sale already paid out (or waiting in a payout) cannot move. */
async function assertCommissionsOpen(conn, saleId, action) {
  const row = await db.queryOne(
    `SELECT e.full_name, c.status, r.status AS payout_status FROM commissions c JOIN employees e ON e.id = c.employee_id
     LEFT JOIN salary_records r ON r.id = c.salary_record_id JOIN sales s ON s.id = c.sale_id
     WHERE c.sale_id = ? AND c.status <> 'reversed' AND (c.status = 'paid' OR r.status = 'paid')
       AND NOT (s.is_imported = 1 AND c.salary_record_id IS NULL) LIMIT 1`,
    [saleId],
    conn,
  );
  if (row) {
    throw ApiError.conflict(`${row.full_name}'s commission for this sale was already paid out, so the sale cannot be ${action}. Settle it with a bonus or deduction on the next payout instead.`);
  }
}

/**
 * Void (delete) a sale recorded by mistake. Nothing is erased: the sale stays
 * visible as "voided" with who, when and why, and everything it did is undone
 * (see reverseSale). Refused once a commission from it has been paid out.
 */
async function voidSale(saleId, { reason }, ctx) {
  await db.withTransaction(async (conn) => {
    const sale = await db.queryOne('SELECT * FROM sales WHERE id = ? FOR UPDATE', [saleId], conn);
    if (!sale || sale.branch_id !== ctx.branchId) throw ApiError.notFound('Sale not found');
    if (sale.status === 'voided') throw ApiError.conflict('This sale has already been voided');
    if (sale.status === 'refunded') throw ApiError.conflict('This sale was refunded, so it cannot be voided');
    await assertCommissionsOpen(conn, saleId, 'voided');

    await reverseSale(conn, sale, ctx, { kind: 'void' });
    await db.query(
      "UPDATE sales SET status = 'voided', void_reason = ?, voided_at = UTC_TIMESTAMP(), voided_by = ?, updated_by = ?, balance_due = 0 WHERE id = ?",
      [reason, ctx.userId, ctx.userId, saleId],
      conn,
    );
    await audit.record(ctx, {
      action: 'sale.voided', entityType: 'sale', entityId: saleId,
      description: `Voided ${sale.invoice_number} (${sale.total}) — ${reason}`,
      metadata: { total: Number(sale.total), amountPaid: Number(sale.amount_paid), soldAt: sale.sold_at, source: sale.source },
      before: { status: sale.status },
      after: { status: 'voided', reason },
    }, conn);
  });

  await notificationService.notifyByPermission({
    permission: 'users.manage',
    branchId: ctx.branchId,
    type: 'sale.voided',
    category: 'payment',
    title: 'Sale voided',
    message: `${ctx.user?.fullName || 'A user'} voided a sale: ${reason}`,
    link: `/pos/sales/${saleId}`,
  }).catch((err) => logger.error({ err }, 'Void notification failed'));
  return getById(saleId, ctx);
}

/**
 * Move a sale to its correct business date (e.g. entered on the wrong day).
 * The payments taken with it, its commissions and its service breakdown move
 * with it; the date it was first recorded for and when it was entered are
 * kept. Refused once a commission from it is in a payout.
 */
async function changeSaleDate(saleId, { soldDate, soldTime, reason }, ctx) {
  await db.withTransaction(async (conn) => {
    const sale = await db.queryOne('SELECT * FROM sales WHERE id = ? FOR UPDATE', [saleId], conn);
    if (!sale || sale.branch_id !== ctx.branchId) throw ApiError.notFound('Sale not found');
    if (sale.status !== 'completed') throw ApiError.badRequest(`A ${sale.status} sale cannot be moved to another date`);
    const inPayout = await db.queryOne(
      "SELECT e.full_name FROM commissions c JOIN employees e ON e.id = c.employee_id WHERE c.sale_id = ? AND c.status <> 'reversed' AND c.salary_record_id IS NOT NULL LIMIT 1",
      [saleId],
      conn,
    );
    if (inPayout) throw ApiError.conflict(`${inPayout.full_name}'s commission for this sale is already in a commission payout, so its date cannot change`);

    const current = DateTime.fromJSDate(sale.sold_at).setZone(timezone());
    const time = soldTime || current.toFormat('HH:mm');
    const next = DateTime.fromISO(`${soldDate}T${time}`, { zone: timezone() });
    if (!next.isValid) throw ApiError.validation([{ field: 'soldDate', message: 'Enter a valid date and time' }]);
    if (soldDate > todayLocal() || next.toMillis() > Date.now()) throw ApiError.validation([{ field: 'soldDate', message: 'A sale cannot be moved to the future' }]);
    if (next.toMillis() === current.toMillis()) throw ApiError.badRequest('The sale is already on that date and time');
    const at = next.toJSDate();

    await db.query('UPDATE sales SET sold_at = ?, updated_by = ? WHERE id = ?', [at, ctx.userId, saleId], conn);
    // Payments taken with the sale move with it; later balance payments keep their own dates.
    await db.query("UPDATE payments SET paid_at = ? WHERE sale_id = ? AND type = 'payment' AND paid_at = ?", [at, saleId, sale.sold_at], conn);
    await db.query("UPDATE commissions SET earned_at = ? WHERE sale_id = ? AND status <> 'reversed'", [at, saleId], conn);
    await db.query('UPDATE sale_item_finance SET performed_at = ? WHERE sale_id = ?', [at, saleId], conn);
    await audit.record(ctx, {
      action: 'sale.date_changed', entityType: 'sale', entityId: saleId,
      description: `Moved ${sale.invoice_number} from ${localDateString(sale.sold_at)} to ${soldDate}: ${reason}`,
      metadata: { reason, originalSoldAt: sale.original_sold_at },
      before: { soldAt: sale.sold_at },
      after: { soldAt: at },
    }, conn);
  });
  return getById(saleId, ctx);
}

/** Everything the POS screen needs to price a cart for an appointment. */
async function appointmentCheckout(appointmentId, ctx) {
  const appointment = await db.queryOne(
    `SELECT a.id, a.code, a.branch_id, a.status, a.customer_id, a.employee_id FROM appointments a WHERE a.id = ?`,
    [appointmentId],
  );
  if (!appointment || appointment.branch_id !== ctx.branchId) throw ApiError.notFound('Appointment not found');
  const billed = await db.queryOne("SELECT id, invoice_number FROM sales WHERE appointment_id = ? AND status = 'completed'", [appointmentId]);
  const services = await db.query('SELECT service_id AS serviceId FROM appointment_services WHERE appointment_id = ? ORDER BY sort_order', [appointmentId]);
  // Everyone on the appointment performed its services unless the cashier changes a line.
  const staff = await db.query('SELECT employee_id FROM appointment_staff WHERE appointment_id = ? ORDER BY sort_order', [appointmentId]);
  // Products used per service: what the stylist recorded, else the service's recipe.
  const usage = await serviceFinance.appointmentUsage(appointment, services.map((s) => s.serviceId));
  return {
    id: appointment.id,
    code: appointment.code,
    status: appointment.status,
    customerId: appointment.customer_id,
    employeeId: appointment.employee_id,
    employeeIds: staff.length ? staff.map((r) => r.employee_id) : [appointment.employee_id],
    serviceIds: services.map((s) => s.serviceId),
    usage,
    billedSale: billed ? { id: billed.id, invoiceNumber: billed.invoice_number } : null,
  };
}

module.exports = {
  createSale, quote, getById, list, listPayments, recordPayment, refundSale, voidSale, changeSaleDate, appointmentCheckout, nextDocumentNumbers, insertLine,
  costServiceLines,
};
