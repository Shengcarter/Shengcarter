'use strict';

const { DateTime } = require('luxon');
const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { toNumber } = require('../utils/money');
const { timezone, localDateRange, sqlOffset, todayLocal } = require('../utils/time');
const inventoryService = require('./inventoryService');

/**
 * Reports for ZOLA STYLISH MANAGEMENT SYSTEM.
 *
 * Conventions used by every report:
 *   • Dates are business-local (settings → time zone); the database stores UTC.
 *   • Sales count when completed (sold_at). Refunded sales are excluded from
 *     revenue and listed separately.
 *   • Gross sales include tax; net sales = gross − tax (tax is owed to the
 *     revenue authority, not income). COGS is the recorded cost of products
 *     sold. Net profit = net sales − COGS − recorded expenses (cash basis:
 *     staff commission counts when paid out; unpaid commission is a note).
 *     Profit after commission counts commission when it is earned instead.
 *   • Every report is scoped to the current branch unless stated otherwise.
 */

const MAX_SPAN_DAYS = 366 * 3;
const GROUPS = ['day', 'week', 'month', 'year'];

// ---- Period helpers -----------------------------------------------------------------------------

function resolvePeriod({ from, to, groupBy } = {}) {
  const zone = timezone();
  const today = DateTime.fromISO(todayLocal(), { zone });
  const start = from ? DateTime.fromISO(from, { zone }) : today.startOf('month');
  const end = to ? DateTime.fromISO(to, { zone }) : today;
  if (!start.isValid || !end.isValid) throw ApiError.validation([{ field: 'from', message: 'Invalid date' }]);
  if (end < start) throw ApiError.validation([{ field: 'to', message: 'The end date must be on or after the start date' }]);
  const days = Math.round(end.diff(start, 'days').days) + 1;
  if (days > MAX_SPAN_DAYS) throw ApiError.validation([{ field: 'from', message: 'Choose a period of at most 3 years' }]);
  const group = GROUPS.includes(groupBy) ? groupBy : days <= 45 ? 'day' : days <= 190 ? 'week' : days <= 1100 ? 'month' : 'year';
  const range = localDateRange(start.toISODate(), end.toISODate());
  const prevEnd = start.minus({ days: 1 });
  const prevStart = prevEnd.minus({ days: days - 1 });
  return {
    from: start.toISODate(),
    to: end.toISODate(),
    days,
    groupBy: group,
    start: range.start,
    end: range.end,
    previous: { from: prevStart.toISODate(), to: prevEnd.toISODate(), ...localDateRange(prevStart.toISODate(), prevEnd.toISODate()) },
  };
}

/** SQL expression converting a UTC column to business-local time. */
function local(column) {
  const offset = sqlOffset();
  if (!/^[+-]\d{2}:\d{2}$/.test(offset)) throw new Error('Invalid time zone offset');
  return `CONVERT_TZ(${column}, '+00:00', '${offset}')`;
}

function bucketSql(column, groupBy) {
  const l = local(column);
  switch (groupBy) {
    case 'week':
      return `DATE_FORMAT(DATE_SUB(DATE(${l}), INTERVAL WEEKDAY(${l}) DAY), '%Y-%m-%d')`;
    case 'month':
      return `DATE_FORMAT(${l}, '%Y-%m-01')`;
    case 'year':
      return `DATE_FORMAT(${l}, '%Y-01-01')`;
    default:
      return `DATE_FORMAT(${l}, '%Y-%m-%d')`;
  }
}

/** Same bucketing for DATE columns (expense_date, work_date). */
function dateBucketSql(column, groupBy) {
  switch (groupBy) {
    case 'week':
      return `DATE_FORMAT(DATE_SUB(${column}, INTERVAL WEEKDAY(${column}) DAY), '%Y-%m-%d')`;
    case 'month':
      return `DATE_FORMAT(${column}, '%Y-%m-01')`;
    case 'year':
      return `DATE_FORMAT(${column}, '%Y-01-01')`;
    default:
      return `DATE_FORMAT(${column}, '%Y-%m-%d')`;
  }
}

/** Every bucket key between from and to, so charts show empty periods as zero. */
function bucketKeys(period) {
  const zone = timezone();
  const unit = { day: 'day', week: 'week', month: 'month', year: 'year' }[period.groupBy];
  const keys = [];
  let cursor = DateTime.fromISO(period.from, { zone }).startOf(unit);
  const last = DateTime.fromISO(period.to, { zone });
  while (cursor <= last && keys.length < 2000) {
    keys.push(cursor.toISODate());
    cursor = cursor.plus({ [`${unit}s`]: 1 });
  }
  return keys;
}

function fillSeries(period, rows, fields) {
  const byKey = new Map(rows.map((r) => [r.bucket, r]));
  const unit = period.groupBy;
  const zone = timezone();
  const today = todayLocal();
  return bucketKeys(period).map((key) => {
    const row = byKey.get(key) || {};
    // A bucket is partial when the period (or today) cuts it short, e.g. the current week.
    const bucketEnd = DateTime.fromISO(key, { zone }).endOf(unit).toISODate();
    const point = { period: key, partial: key < period.from || bucketEnd > period.to || bucketEnd > today };
    for (const [name, kind] of Object.entries(fields)) point[name] = kind === 'money' ? toNumber(row[name] || 0) : Number(row[name] || 0);
    return point;
  });
}

const money = (v) => toNumber(v || 0);
const pct = (part, whole) => (Number(whole) ? Math.round((Number(part) / Number(whole)) * 1000) / 10 : 0);
const change = (current, previous) => (Number(previous) ? Math.round(((Number(current) - Number(previous)) / Math.abs(Number(previous))) * 1000) / 10 : null);

// ---- Shared queries -----------------------------------------------------------------------------

async function salesTotals(branchId, start, end) {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS gross, COALESCE(SUM(tax_amount), 0) AS tax,
            COALESCE(SUM(discount_amount + loyalty_discount), 0) AS discounts, COALESCE(SUM(cost_of_goods), 0) AS cogs,
            COALESCE(SUM(balance_due), 0) AS outstanding, COUNT(DISTINCT customer_id) AS customers,
            COALESCE(SUM(customer_id IS NULL), 0) AS walk_ins
     FROM sales WHERE branch_id = ? AND status = 'completed' AND sold_at >= ? AND sold_at < ?`,
    [branchId, start, end],
  );
  const gross = money(row.gross);
  const tax = money(row.tax);
  const count = Number(row.count);
  return {
    count,
    gross,
    tax,
    net: money(gross - tax),
    discounts: money(row.discounts),
    cogs: money(row.cogs),
    grossProfit: money(gross - tax - Number(row.cogs)),
    outstanding: money(row.outstanding),
    customers: Number(row.customers),
    walkIns: Number(row.walk_ins),
    averageSale: count ? money(gross / count) : 0,
  };
}

async function expenseTotal(branchId, from, to) {
  const row = await db.queryOne(
    'SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE branch_id = ? AND expense_date BETWEEN ? AND ?',
    [branchId, from, to],
  );
  return { total: money(row.total), count: Number(row.count) };
}

/**
 * Running costs: every expense except commission payouts made through
 * Employees → Commission payouts. Those follow the payday, so comparing
 * periods with them swings wildly; commission is counted as earned instead
 * (commissionEarned). Staff pay a salon records by hand as an ordinary expense
 * stays in, so nothing is lost or counted twice.
 */
async function runningCostTotal(branchId, from, to) {
  const row = await db.queryOne(
    `SELECT COALESCE(SUM(e.amount), 0) AS total FROM expenses e
     WHERE e.branch_id = ? AND e.expense_date BETWEEN ? AND ?
       AND NOT EXISTS (SELECT 1 FROM salary_records r WHERE r.expense_id = e.id)`,
    [branchId, from, to],
  );
  return money(row.total);
}

/**
 * Staff pay earned in a date range, whenever it is paid out: commission
 * earned (refunded sales excluded) plus payout bonuses minus deductions,
 * spread over the days of each payout's period (older records may also carry
 * a base salary). Only days up to today count.
 */
async function commissionEarned(branchId, from, to) {
  const through = to < todayLocal() ? to : todayLocal();
  if (through < from) return { commission: 0, bonuses: 0, total: 0, through };
  const zone = timezone();
  const range = localDateRange(from, through);

  const [records, commission] = await Promise.all([
    db.query(
      `SELECT period_start, period_end, base_salary + bonus - deductions AS extra
       FROM salary_records WHERE branch_id = ? AND period_start <= ? AND period_end >= ? AND (base_salary + bonus - deductions) <> 0`,
      [branchId, through, from],
    ),
    db.queryOne(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM commissions WHERE branch_id = ? AND status <> 'reversed' AND earned_at >= ? AND earned_at < ?",
      [branchId, range.start, range.end],
    ),
  ]);

  const day = (iso) => DateTime.fromISO(iso, { zone });
  const overlapDays = (a1, a2, b1, b2) => {
    const start = a1 > b1 ? a1 : b1;
    const end = a2 < b2 ? a2 : b2;
    return end < start ? 0 : Math.round(day(end).diff(day(start), 'days').days) + 1;
  };
  let bonuses = 0;
  for (const r of records) {
    const recordDays = Math.round(day(r.period_end).diff(day(r.period_start), 'days').days) + 1;
    bonuses += (Number(r.extra) * overlapDays(r.period_start, r.period_end, from, through)) / recordDays;
  }
  return { commission: money(commission.total), bonuses: money(bonuses), total: money(bonuses + Number(commission.total)), through };
}

async function lineTotals(branchId, start, end, itemType, groupColumn) {
  return db.query(
    `SELECT ${groupColumn} AS id, SUM(i.quantity) AS quantity, COUNT(DISTINCT i.sale_id) AS sales, SUM(i.net_amount) AS revenue,
            SUM(i.unit_cost * i.quantity) AS cost, SUM(i.commission_amount) AS commission
     FROM sale_items i JOIN sales s ON s.id = i.sale_id
     WHERE s.branch_id = ? AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ? AND i.item_type = ?
     GROUP BY ${groupColumn}`,
    [branchId, start, end, itemType],
  );
}

// ---- Sales --------------------------------------------------------------------------------------

async function sales(params, ctx) {
  const period = resolvePeriod(params);
  const branchId = ctx.branchId;
  const [current, previous] = await Promise.all([
    salesTotals(branchId, period.start, period.end),
    salesTotals(branchId, period.previous.start, period.previous.end),
  ]);
  const refunds = await db.queryOne(
    "SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount FROM sales WHERE branch_id = ? AND status = 'refunded' AND refunded_at >= ? AND refunded_at < ?",
    [branchId, period.start, period.end],
  );

  const seriesRows = await db.query(
    `SELECT ${bucketSql('sold_at', period.groupBy)} AS bucket, COUNT(*) AS sales, SUM(total) AS gross, SUM(total - tax_amount) AS net
     FROM sales WHERE branch_id = ? AND status = 'completed' AND sold_at >= ? AND sold_at < ?
     GROUP BY bucket ORDER BY bucket`,
    [branchId, period.start, period.end],
  );

  const methods = await db.query(
    `SELECT method, SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END) AS received,
            SUM(CASE WHEN type = 'refund' THEN -amount ELSE 0 END) AS refunded, COUNT(*) AS count
     FROM payments WHERE branch_id = ? AND paid_at >= ? AND paid_at < ? GROUP BY method ORDER BY received DESC`,
    [branchId, period.start, period.end],
  );

  // A service done by several people counts for each, with their equal share of its value.
  const staff = await db.query(
    `SELECT e.id, e.full_name AS name, SUM(i.quantity) AS services, SUM(sis.revenue_share) AS revenue, SUM(sis.commission_amount) AS commission
     FROM sale_item_staff sis JOIN sale_items i ON i.id = sis.sale_item_id JOIN sales s ON s.id = i.sale_id JOIN employees e ON e.id = sis.employee_id
     WHERE s.branch_id = ? AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ? AND i.item_type = 'service'
     GROUP BY e.id, e.full_name ORDER BY revenue DESC`,
    [branchId, period.start, period.end],
  );

  const services = await db.query(
    `SELECT sv.id, sv.name, COALESCE(c.name, 'Other') AS category, SUM(i.quantity) AS quantity, SUM(i.net_amount) AS revenue
     FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN services sv ON sv.id = i.service_id
     LEFT JOIN service_categories c ON c.id = sv.category_id
     WHERE s.branch_id = ? AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ? AND i.item_type = 'service'
     GROUP BY sv.id, sv.name, c.name ORDER BY revenue DESC`,
    [branchId, period.start, period.end],
  );

  const products = await db.query(
    `SELECT p.id, p.name, SUM(i.quantity) AS quantity, SUM(i.net_amount) AS revenue, SUM(i.unit_cost * i.quantity) AS cost
     FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN products p ON p.id = i.product_id
     WHERE s.branch_id = ? AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ? AND i.item_type = 'product'
     GROUP BY p.id, p.name ORDER BY revenue DESC`,
    [branchId, period.start, period.end],
  );

  const timing = await db.query(
    `SELECT WEEKDAY(${local('sold_at')}) AS weekday, HOUR(${local('sold_at')}) AS hour, COUNT(*) AS sales, SUM(total) AS gross
     FROM sales WHERE branch_id = ? AND status = 'completed' AND sold_at >= ? AND sold_at < ?
     GROUP BY weekday, hour`,
    [branchId, period.start, period.end],
  );
  const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const byWeekday = weekdayNames.map((day, index) => {
    const rows = timing.filter((t) => Number(t.weekday) === index);
    return { day, sales: rows.reduce((s, r) => s + Number(r.sales), 0), gross: money(rows.reduce((s, r) => s + Number(r.gross), 0)) };
  });
  const hours = timing.map((t) => Number(t.hour));
  const byHour = [];
  if (hours.length) {
    for (let h = Math.min(...hours); h <= Math.max(...hours); h += 1) {
      const rows = timing.filter((t) => Number(t.hour) === h);
      byHour.push({ hour: `${String(h).padStart(2, '0')}:00`, sales: rows.reduce((s, r) => s + Number(r.sales), 0), gross: money(rows.reduce((s, r) => s + Number(r.gross), 0)) });
    }
  }

  const serviceRevenue = services.reduce((s, r) => s + Number(r.revenue), 0);
  const productRevenue = products.reduce((s, r) => s + Number(r.revenue), 0);
  const categories = [...services.reduce((map, r) => map.set(r.category, (map.get(r.category) || 0) + Number(r.revenue)), new Map())]
    .map(([category, revenue]) => ({ category, revenue: money(revenue), share: pct(revenue, serviceRevenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    period,
    summary: {
      ...current,
      refunds: { count: Number(refunds.count), amount: money(refunds.amount) },
      serviceRevenue: money(serviceRevenue),
      productRevenue: money(productRevenue),
      change: { gross: change(current.gross, previous.gross), count: change(current.count, previous.count), averageSale: change(current.averageSale, previous.averageSale) },
      previous,
    },
    series: fillSeries(period, seriesRows, { sales: 'number', gross: 'money', net: 'money' }),
    paymentMethods: methods.map((m) => ({ method: m.method, received: money(m.received), refunded: money(m.refunded), net: money(m.received - m.refunded), count: Number(m.count) })),
    staff: staff.map((r) => ({ id: r.id, name: r.name, services: Number(r.services), revenue: money(r.revenue), commission: money(r.commission) })),
    services: services.map((r) => ({ id: r.id, name: r.name, category: r.category, quantity: Number(r.quantity), revenue: money(r.revenue), share: pct(r.revenue, serviceRevenue) })),
    categories,
    products: products.map((r) => ({ id: r.id, name: r.name, quantity: Number(r.quantity), revenue: money(r.revenue), cost: money(r.cost), profit: money(r.revenue - r.cost), margin: pct(r.revenue - r.cost, r.revenue) })),
    byWeekday,
    byHour,
  };
}

// ---- Customers ----------------------------------------------------------------------------------

async function activeCustomers(branchId, start, end) {
  const rows = await db.query(
    "SELECT DISTINCT customer_id AS id FROM sales WHERE branch_id = ? AND status = 'completed' AND customer_id IS NOT NULL AND sold_at >= ? AND sold_at < ?",
    [branchId, start, end],
  );
  return new Set(rows.map((r) => r.id));
}

async function tierOf() {
  const tiers = await db.query('SELECT id, name, min_points, color FROM loyalty_tiers ORDER BY min_points DESC');
  return (points) => tiers.find((t) => Number(points) >= Number(t.min_points)) || null;
}

async function customers(params, ctx) {
  const period = resolvePeriod(params);
  const branchId = ctx.branchId;
  const [active, previousActive] = await Promise.all([
    activeCustomers(branchId, period.start, period.end),
    activeCustomers(branchId, period.previous.start, period.previous.end),
  ]);

  let firstTime = 0;
  if (active.size) {
    const firsts = await db.query(
      "SELECT customer_id AS id, MIN(sold_at) AS first_sale FROM sales WHERE status = 'completed' AND customer_id IN (?) GROUP BY customer_id",
      [[...active]],
    );
    firstTime = firsts.filter((f) => new Date(f.first_sale) >= period.start).length;
  }
  const retained = [...previousActive].filter((id) => active.has(id)).length;

  const registered = await db.query(
    `SELECT ${bucketSql('created_at', period.groupBy)} AS bucket, COUNT(*) AS customers
     FROM customers WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL) AND created_at >= ? AND created_at < ?
     GROUP BY bucket ORDER BY bucket`,
    [branchId, period.start, period.end],
  );
  const newCount = registered.reduce((s, r) => s + Number(r.customers), 0);
  const prevNew = await db.queryOne(
    'SELECT COUNT(*) AS n FROM customers WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL) AND created_at >= ? AND created_at < ?',
    [branchId, period.previous.start, period.previous.end],
  );
  const totals = await db.queryOne('SELECT COUNT(*) AS n FROM customers WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)', [branchId]);
  const salesSummary = await salesTotals(branchId, period.start, period.end);

  const tier = await tierOf();
  const top = await db.query(
    `SELECT c.id, c.code, c.full_name AS name, c.phone, c.lifetime_points, c.last_visit_at, COUNT(*) AS visits, SUM(s.total) AS spent
     FROM sales s JOIN customers c ON c.id = s.customer_id
     WHERE s.branch_id = ? AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ?
     GROUP BY c.id, c.code, c.full_name, c.phone, c.lifetime_points, c.last_visit_at ORDER BY spent DESC LIMIT 15`,
    [branchId, period.start, period.end],
  );
  const atRisk = await db.query(
    `SELECT id, code, full_name AS name, phone, visit_count, total_spent, last_visit_at
     FROM customers WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL) AND visit_count >= 3 AND last_visit_at < ?
     ORDER BY total_spent DESC LIMIT 15`,
    [branchId, DateTime.now().minus({ days: 60 }).toJSDate()],
  );
  const atRiskCount = await db.queryOne(
    'SELECT COUNT(*) AS n FROM customers WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL) AND visit_count >= 3 AND last_visit_at < ?',
    [branchId, DateTime.now().minus({ days: 60 }).toJSDate()],
  );
  const pointsRows = await db.query('SELECT lifetime_points FROM customers WHERE deleted_at IS NULL AND (branch_id = ? OR branch_id IS NULL)', [branchId]);
  const tierCounts = new Map();
  for (const r of pointsRows) {
    const t = tier(r.lifetime_points);
    const name = t?.name || 'No tier';
    tierCounts.set(name, (tierCounts.get(name) || 0) + 1);
  }
  const visits = await db.queryOne(
    "SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS spent FROM sales WHERE branch_id = ? AND status = 'completed' AND customer_id IS NOT NULL AND sold_at >= ? AND sold_at < ?",
    [branchId, period.start, period.end],
  );

  return {
    period,
    summary: {
      totalCustomers: Number(totals.n),
      newCustomers: newCount,
      newChange: change(newCount, prevNew.n),
      activeCustomers: active.size,
      firstTimeCustomers: firstTime,
      returningCustomers: active.size - firstTime,
      retentionRate: pct(retained, previousActive.size),
      retainedCustomers: retained,
      previousActive: previousActive.size,
      walkInSales: salesSummary.walkIns,
      walkInShare: pct(salesSummary.walkIns, salesSummary.count),
      averageSpend: active.size ? money(Number(visits.spent) / active.size) : 0,
      visitsPerCustomer: active.size ? Math.round((Number(visits.n) / active.size) * 10) / 10 : 0,
      atRisk: Number(atRiskCount.n),
    },
    series: fillSeries(period, registered, { customers: 'number' }),
    topCustomers: top.map((r) => ({
      id: r.id, code: r.code, name: r.name, phone: r.phone, visits: Number(r.visits), spent: money(r.spent),
      lastVisit: r.last_visit_at, tier: tier(r.lifetime_points)?.name || null,
    })),
    atRisk: atRisk.map((r) => ({ id: r.id, code: r.code, name: r.name, phone: r.phone, visits: Number(r.visit_count), spent: money(r.total_spent), lastVisit: r.last_visit_at })),
    tiers: [...tierCounts].map(([name, count]) => ({ tier: name, customers: count })).sort((a, b) => b.customers - a.customers),
  };
}

// ---- Services -----------------------------------------------------------------------------------

async function services(params, ctx) {
  const period = resolvePeriod(params);
  const branchId = ctx.branchId;
  const all = await db.query(
    `SELECT sv.id, sv.name, sv.price, sv.duration_minutes, sv.is_active, COALESCE(c.name, 'Other') AS category
     FROM services sv LEFT JOIN service_categories c ON c.id = sv.category_id ORDER BY sv.name`,
  );
  const sold = new Map((await lineTotals(branchId, period.start, period.end, 'service', 'i.service_id')).map((r) => [r.id, r]));
  const booked = new Map(
    (
      await db.query(
        `SELECT x.service_id AS id, COUNT(*) AS booked, SUM(a.status = 'completed') AS completed,
                SUM(a.status = 'cancelled') AS cancelled, SUM(a.status = 'no_show') AS no_show
         FROM appointment_services x JOIN appointments a ON a.id = x.appointment_id
         WHERE a.branch_id = ? AND a.start_time >= ? AND a.start_time < ?
         GROUP BY x.service_id`,
        [branchId, period.start, period.end],
      )
    ).map((r) => [r.id, r]),
  );

  const rows = all
    .map((s) => {
      const sale = sold.get(s.id) || {};
      const book = booked.get(s.id) || {};
      const quantity = Number(sale.quantity || 0);
      const bookings = Number(book.booked || 0);
      return {
        id: s.id,
        name: s.name,
        category: s.category,
        active: Boolean(s.is_active),
        price: money(s.price),
        sold: quantity,
        revenue: money(sale.revenue),
        averagePrice: quantity ? money(Number(sale.revenue) / quantity) : 0,
        bookings,
        cancelled: Number(book.cancelled || 0),
        noShows: Number(book.no_show || 0),
        cancellationRate: pct(Number(book.cancelled || 0) + Number(book.no_show || 0), bookings),
      };
    })
    .filter((r) => r.active || r.sold || r.bookings)
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  for (const r of rows) r.share = pct(r.revenue, totalRevenue);
  const categories = [...rows.reduce((map, r) => {
    const c = map.get(r.category) || { category: r.category, sold: 0, revenue: 0, bookings: 0 };
    c.sold += r.sold;
    c.revenue += r.revenue;
    c.bookings += r.bookings;
    return map.set(r.category, c);
  }, new Map()).values()]
    .map((c) => ({ ...c, revenue: money(c.revenue), share: pct(c.revenue, totalRevenue) }))
    .sort((a, b) => b.revenue - a.revenue);

  const bookingsTotal = rows.reduce((s, r) => s + r.bookings, 0);
  const lost = rows.reduce((s, r) => s + r.cancelled + r.noShows, 0);
  return {
    period,
    summary: {
      servicesSold: rows.reduce((s, r) => s + r.sold, 0),
      revenue: money(totalRevenue),
      bookings: bookingsTotal,
      cancellationRate: pct(lost, bookingsTotal),
      topService: rows[0]?.revenue ? rows[0].name : null,
      activeServices: rows.filter((r) => r.active).length,
    },
    services: rows,
    categories,
  };
}

// ---- Staff --------------------------------------------------------------------------------------

async function staff(params, ctx) {
  const period = resolvePeriod(params);
  const branchId = ctx.branchId;
  const employees = await db.query(
    "SELECT id, code, full_name, job_title, is_bookable, status FROM employees WHERE branch_id = ? AND status <> 'terminated' ORDER BY full_name",
    [branchId],
  );
  if (!employees.length) return { period, summary: { employees: 0 }, staff: [] };
  const ids = employees.map((e) => e.id);

  const [lines, commissions, appointments, attendance, schedules, leave] = await Promise.all([
    // Each person's share of the services they performed (shared services are split equally).
    db.query(
      `SELECT sis.employee_id AS id, SUM(i.quantity) AS quantity, COUNT(DISTINCT i.sale_id) AS sales, SUM(sis.revenue_share) AS revenue,
              0 AS cost, SUM(sis.commission_amount) AS commission
       FROM sale_item_staff sis JOIN sale_items i ON i.id = sis.sale_item_id JOIN sales s ON s.id = i.sale_id
       WHERE s.branch_id = ? AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ? AND i.item_type = 'service'
       GROUP BY sis.employee_id`,
      [branchId, period.start, period.end],
    ),
    db.query(
      "SELECT employee_id AS id, SUM(amount) AS total, SUM(status = 'paid') AS paid_count FROM commissions WHERE branch_id = ? AND status <> 'reversed' AND earned_at >= ? AND earned_at < ? GROUP BY employee_id",
      [branchId, period.start, period.end],
    ),
    db.query(
      `SELECT ast.employee_id AS id, COUNT(*) AS total, SUM(a.status = 'completed') AS completed, SUM(a.status = 'cancelled') AS cancelled,
              SUM(a.status = 'no_show') AS no_show, SUM(CASE WHEN a.status IN ('cancelled','no_show') THEN 0 ELSE a.total_duration END) AS minutes
       FROM appointment_staff ast JOIN appointments a ON a.id = ast.appointment_id
       WHERE a.branch_id = ? AND a.start_time >= ? AND a.start_time < ? GROUP BY ast.employee_id`,
      [branchId, period.start, period.end],
    ),
    db.query(
      `SELECT employee_id AS id, SUM(status = 'present') AS present, SUM(status = 'late') AS late, SUM(status = 'absent') AS absent,
              SUM(status = 'on_leave') AS on_leave, SUM(status = 'half_day') AS half_day
       FROM attendance WHERE employee_id IN (?) AND work_date BETWEEN ? AND ? GROUP BY employee_id`,
      [ids, period.from, period.to],
    ),
    db.query('SELECT employee_id, day_of_week, start_time, end_time, is_working FROM employee_schedules WHERE employee_id IN (?)', [ids]),
    db.query("SELECT employee_id, start_date, end_date FROM leave_records WHERE status = 'approved' AND employee_id IN (?) AND end_date >= ? AND start_date <= ?", [ids, period.from, period.to]),
  ]);
  const map = (rows) => new Map(rows.map((r) => [r.id, r]));
  const L = map(lines);
  const C = map(commissions);
  const A = map(appointments);
  const T = map(attendance);

  // Scheduled minutes in the period (weekly schedule minus approved leave; never beyond today).
  const zone = timezone();
  const lastDay = DateTime.min(DateTime.fromISO(period.to, { zone }), DateTime.fromISO(todayLocal(), { zone }));
  const scheduled = new Map();
  for (const e of employees) {
    const week = schedules.filter((s) => s.employee_id === e.id && s.is_working);
    let minutes = 0;
    for (let d = DateTime.fromISO(period.from, { zone }); d <= lastDay; d = d.plus({ days: 1 })) {
      const iso = d.toISODate();
      if (leave.some((l) => l.employee_id === e.id && iso >= l.start_date && iso <= l.end_date)) continue;
      const day = week.find((s) => s.day_of_week === d.weekday % 7);
      if (day) minutes += DateTime.fromISO(`${iso}T${day.end_time}`).diff(DateTime.fromISO(`${iso}T${day.start_time}`), 'minutes').minutes;
    }
    scheduled.set(e.id, minutes);
  }

  const rows = employees
    .map((e) => {
      const line = L.get(e.id) || {};
      const appt = A.get(e.id) || {};
      const att = T.get(e.id) || {};
      const revenue = money(line.revenue);
      const servicesCount = Number(line.quantity || 0);
      const bookedMinutes = Number(appt.minutes || 0);
      const scheduledMinutes = scheduled.get(e.id) || 0;
      return {
        id: e.id,
        code: e.code,
        name: e.full_name,
        jobTitle: e.job_title,
        bookable: Boolean(e.is_bookable),
        services: servicesCount,
        revenue,
        averageService: servicesCount ? money(revenue / servicesCount) : 0,
        commission: money(C.get(e.id)?.total),
        appointments: Number(appt.total || 0),
        completed: Number(appt.completed || 0),
        cancelled: Number(appt.cancelled || 0),
        noShows: Number(appt.no_show || 0),
        bookedHours: Math.round(bookedMinutes / 6) / 10,
        utilization: e.is_bookable ? pct(bookedMinutes, scheduledMinutes) : null,
        present: Number(att.present || 0),
        late: Number(att.late || 0),
        absent: Number(att.absent || 0),
        onLeave: Number(att.on_leave || 0),
        punctuality: pct(Number(att.present || 0), Number(att.present || 0) + Number(att.late || 0)),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const bookable = rows.filter((r) => r.bookable);
  return {
    period,
    summary: {
      employees: rows.length,
      serviceRevenue: money(rows.reduce((s, r) => s + r.revenue, 0)),
      commission: money(rows.reduce((s, r) => s + r.commission, 0)),
      servicesPerformed: rows.reduce((s, r) => s + r.services, 0),
      averageUtilization: bookable.length ? Math.round(bookable.reduce((s, r) => s + (r.utilization || 0), 0) / bookable.length * 10) / 10 : 0,
      lateArrivals: rows.reduce((s, r) => s + r.late, 0),
      absences: rows.reduce((s, r) => s + r.absent, 0),
      topPerformer: rows[0]?.revenue ? rows[0].name : null,
    },
    staff: rows,
  };
}

// ---- Inventory ----------------------------------------------------------------------------------

async function inventory(params, ctx) {
  const period = resolvePeriod(params);
  const branchId = ctx.branchId;
  const valuation = await inventoryService.valuation(ctx);
  const movements = await db.query(
    `SELECT type, COUNT(*) AS entries, SUM(quantity_change) AS quantity, SUM(ABS(quantity_change) * unit_cost) AS value
     FROM inventory_transactions WHERE branch_id = ? AND created_at >= ? AND created_at < ? GROUP BY type ORDER BY type`,
    [branchId, period.start, period.end],
  );
  const sold = await lineTotals(branchId, period.start, period.end, 'product', 'i.product_id');
  const products = await db.query(
    `SELECT p.id, p.name, p.sku, p.unit, p.quantity, p.min_stock, p.purchase_price, p.selling_price, p.is_retail, p.status,
            (SELECT MAX(s.sold_at) FROM sale_items i JOIN sales s ON s.id = i.sale_id WHERE i.product_id = p.id AND s.status = 'completed') AS last_sold
     FROM products p WHERE p.branch_id = ? AND p.status = 'active' ORDER BY p.name`,
    [branchId],
  );
  const soldMap = new Map(sold.map((r) => [r.id, r]));
  const days = Math.max(1, Math.min(period.days, Math.round(DateTime.now().diff(DateTime.fromJSDate(period.start), 'days').days) || 1));

  const top = products
    .filter((p) => soldMap.has(p.id))
    .map((p) => {
      const r = soldMap.get(p.id);
      const quantity = Number(r.quantity);
      const perDay = quantity / days;
      return {
        id: p.id, name: p.name, sku: p.sku, quantity, revenue: money(r.revenue), cost: money(r.cost),
        profit: money(r.revenue - r.cost), margin: pct(r.revenue - r.cost, r.revenue), inStock: p.quantity,
        daysOfCover: perDay > 0 ? Math.floor(p.quantity / perDay) : null,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const slow = products
    .filter((p) => p.is_retail && p.quantity > 0 && !soldMap.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, inStock: p.quantity, stockValue: money(p.quantity * p.purchase_price), lastSold: p.last_sold }))
    .sort((a, b) => b.stockValue - a.stockValue);

  const low = products
    .filter((p) => p.quantity <= p.min_stock)
    .map((p) => ({ id: p.id, name: p.name, sku: p.sku, inStock: p.quantity, minStock: p.min_stock, unit: p.unit }))
    .sort((a, b) => a.inStock - b.inStock);

  const purchases = await db.queryOne(
    "SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS total FROM purchases WHERE branch_id = ? AND status <> 'cancelled' AND purchase_date BETWEEN ? AND ?",
    [branchId, period.from, period.to],
  );

  return {
    period,
    summary: {
      ...valuation.totals,
      unitsSold: top.reduce((s, r) => s + r.quantity, 0),
      productRevenue: money(top.reduce((s, r) => s + r.revenue, 0)),
      productProfit: money(top.reduce((s, r) => s + r.profit, 0)),
      purchases: Number(purchases.count),
      purchasesTotal: money(purchases.total),
      slowMovers: slow.length,
    },
    valuation: valuation.categories,
    movements: movements.map((m) => ({ type: m.type, entries: Number(m.entries), quantity: Number(m.quantity), value: money(m.value) })),
    topProducts: top,
    slowMovers: slow,
    lowStock: low,
  };
}

// ---- Expenses -----------------------------------------------------------------------------------

async function expenses(params, ctx) {
  const period = resolvePeriod(params);
  const branchId = ctx.branchId;
  const [current, previous] = await Promise.all([expenseTotal(branchId, period.from, period.to), expenseTotal(branchId, period.previous.from, period.previous.to)]);
  const categories = await db.query(
    `SELECT c.name AS category, COUNT(*) AS count, SUM(e.amount) AS total FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     WHERE e.branch_id = ? AND e.expense_date BETWEEN ? AND ? GROUP BY c.name ORDER BY total DESC`,
    [branchId, period.from, period.to],
  );
  const series = await db.query(
    `SELECT ${dateBucketSql('expense_date', period.groupBy)} AS bucket, SUM(amount) AS total FROM expenses
     WHERE branch_id = ? AND expense_date BETWEEN ? AND ? GROUP BY bucket ORDER BY bucket`,
    [branchId, period.from, period.to],
  );
  const vendors = await db.query(
    `SELECT COALESCE(NULLIF(vendor, ''), 'Not specified') AS vendor, COUNT(*) AS count, SUM(amount) AS total FROM expenses
     WHERE branch_id = ? AND expense_date BETWEEN ? AND ? GROUP BY vendor ORDER BY total DESC LIMIT 10`,
    [branchId, period.from, period.to],
  );
  const methods = await db.query(
    'SELECT payment_method AS method, SUM(amount) AS total FROM expenses WHERE branch_id = ? AND expense_date BETWEEN ? AND ? GROUP BY payment_method ORDER BY total DESC',
    [branchId, period.from, period.to],
  );
  const [salesSummary, running, prevRunning, staffPay, runningTop] = await Promise.all([
    salesTotals(branchId, period.start, period.end),
    runningCostTotal(branchId, period.from, period.to),
    runningCostTotal(branchId, period.previous.from, period.previous.to),
    commissionEarned(branchId, period.from, period.to),
    db.queryOne(
      `SELECT c.name AS category FROM expenses e JOIN expense_categories c ON c.id = e.category_id
       WHERE e.branch_id = ? AND e.expense_date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM salary_records r WHERE r.expense_id = e.id)
       GROUP BY c.name ORDER BY SUM(e.amount) DESC LIMIT 1`,
      [branchId, period.from, period.to],
    ),
  ]);
  return {
    period,
    summary: {
      total: current.total,
      count: current.count,
      change: change(current.total, previous.total),
      previousTotal: previous.total,
      averagePerDay: money(current.total / period.days),
      shareOfSales: pct(current.total, salesSummary.net),
      largestCategory: categories[0]?.category || null,
      // Like-for-like figures that do not depend on when payday falls.
      runningCosts: running,
      previousRunningCosts: prevRunning,
      runningCostsChange: change(running, prevRunning),
      largestRunningCategory: runningTop?.category || null,
      commissionEarned: staffPay.total,
      costShareOfSales: pct(running + staffPay.total, salesSummary.net),
    },
    series: fillSeries(period, series, { total: 'money' }),
    categories: categories.map((c) => ({ category: c.category, count: Number(c.count), total: money(c.total), share: pct(c.total, current.total) })),
    vendors: vendors.map((v) => ({ vendor: v.vendor, count: Number(v.count), total: money(v.total) })),
    paymentMethods: methods.map((m) => ({ method: m.method, total: money(m.total) })),
  };
}

// ---- Profit & loss ------------------------------------------------------------------------------

async function profit(params, ctx) {
  const period = resolvePeriod(params);
  const branchId = ctx.branchId;
  const [current, previous, exp, prevExp] = await Promise.all([
    salesTotals(branchId, period.start, period.end),
    salesTotals(branchId, period.previous.start, period.previous.end),
    expenseTotal(branchId, period.from, period.to),
    expenseTotal(branchId, period.previous.from, period.previous.to),
  ]);
  const categories = await db.query(
    `SELECT c.name AS category, SUM(e.amount) AS total FROM expenses e JOIN expense_categories c ON c.id = e.category_id
     WHERE e.branch_id = ? AND e.expense_date BETWEEN ? AND ? GROUP BY c.name ORDER BY total DESC`,
    [branchId, period.from, period.to],
  );
  const salesSeries = await db.query(
    `SELECT ${bucketSql('sold_at', period.groupBy)} AS bucket, SUM(total - tax_amount) AS net, SUM(cost_of_goods) AS cogs
     FROM sales WHERE branch_id = ? AND status = 'completed' AND sold_at >= ? AND sold_at < ? GROUP BY bucket`,
    [branchId, period.start, period.end],
  );
  const expenseSeries = await db.query(
    `SELECT ${dateBucketSql('expense_date', period.groupBy)} AS bucket, SUM(amount) AS expenses FROM expenses
     WHERE branch_id = ? AND expense_date BETWEEN ? AND ? GROUP BY bucket`,
    [branchId, period.from, period.to],
  );
  const e = new Map(expenseSeries.map((r) => [r.bucket, r]));
  const merged = salesSeries.map((r) => ({ ...r, expenses: e.get(r.bucket)?.expenses || 0 }));
  for (const r of expenseSeries) if (!merged.some((m) => m.bucket === r.bucket)) merged.push({ bucket: r.bucket, net: 0, cogs: 0, expenses: r.expenses });
  const series = fillSeries(period, merged, { net: 'money', cogs: 'money', expenses: 'money' }).map((p) => ({ ...p, profit: money(p.net - p.cogs - p.expenses) }));

  const unpaidCommission = await db.queryOne(
    "SELECT COALESCE(SUM(amount), 0) AS total FROM commissions WHERE branch_id = ? AND status = 'earned' AND earned_at >= ? AND earned_at < ?",
    [branchId, period.start, period.end],
  );
  const netProfit = money(current.grossProfit - exp.total);
  const prevProfit = money(previous.grossProfit - prevExp.total);
  // Cash profit swings with the payday; this view counts commission as earned.
  const [running, prevRunning, staffPay, prevStaffPay] = await Promise.all([
    runningCostTotal(branchId, period.from, period.to),
    runningCostTotal(branchId, period.previous.from, period.previous.to),
    commissionEarned(branchId, period.from, period.to),
    commissionEarned(branchId, period.previous.from, period.previous.to),
  ]);
  const profitAfterCommission = money(current.grossProfit - running - staffPay.total);
  const prevProfitAfterCommission = money(previous.grossProfit - prevRunning - prevStaffPay.total);
  return {
    period,
    summary: {
      grossSales: current.gross,
      tax: current.tax,
      netSales: current.net,
      discounts: current.discounts,
      cogs: current.cogs,
      grossProfit: current.grossProfit,
      grossMargin: pct(current.grossProfit, current.net),
      expenses: exp.total,
      netProfit,
      netMargin: pct(netProfit, current.net),
      change: { netSales: change(current.net, previous.net), expenses: change(exp.total, prevExp.total), netProfit: change(netProfit, prevProfit) },
      unpaidCommission: money(unpaidCommission.total),
      outstanding: current.outstanding,
      afterCommission: {
        runningCosts: running,
        commission: staffPay.commission,
        bonuses: staffPay.bonuses,
        through: staffPay.through,
        profit: profitAfterCommission,
        margin: pct(profitAfterCommission, current.net),
        change: change(profitAfterCommission, prevProfitAfterCommission),
      },
    },
    series,
    expenses: categories.map((c) => ({ category: c.category, total: money(c.total), share: pct(c.total, exp.total) })),
  };
}

// ---- Service costing -----------------------------------------------------------------------------

/** Totals of the money split of services sold (refunded sales excluded). */
async function costingTotals(branchId, start, end) {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS services, COALESCE(SUM(f.price), 0) AS sales, COALESCE(SUM(f.product_cost), 0) AS product_cost,
            COALESCE(SUM(f.operations_amount), 0) AS operations, COALESCE(SUM(f.staff_pool), 0) AS staff, COALESCE(SUM(f.salon_profit), 0) AS profit,
            COALESCE(SUM(f.margin_status = 'zero'), 0) AS zero, COALESCE(SUM(f.margin_status = 'negative'), 0) AS negative,
            COALESCE(SUM(f.review_status = 'pending'), 0) AS pending
     FROM sale_item_finance f JOIN sales s ON s.id = f.sale_id
     WHERE f.branch_id = ? AND s.status = 'completed' AND f.performed_at >= ? AND f.performed_at < ?`,
    [branchId, start, end],
  );
  const services = Number(row.services);
  return {
    services,
    sales: money(row.sales),
    productCost: money(row.product_cost),
    operations: money(row.operations),
    staffEarnings: money(row.staff),
    salonProfit: money(row.profit),
    averageServiceValue: services ? money(row.sales / services) : 0,
    averageProfit: services ? money(row.profit / services) : 0,
    flagged: { zero: Number(row.zero), negative: Number(row.negative), pending: Number(row.pending) },
  };
}

/**
 * Service costing: for every service sold, price − products used → operations
 * → staff pool / salon profit. By period (day, week or month), stylist,
 * service and product, with the services that need a manager's review.
 */
async function costing(params, ctx) {
  const period = resolvePeriod(params);
  const branchId = ctx.branchId;
  const scope = `FROM sale_item_finance f JOIN sales s ON s.id = f.sale_id
                 WHERE f.branch_id = ? AND s.status = 'completed' AND f.performed_at >= ? AND f.performed_at < ?`;
  const args = [branchId, period.start, period.end];

  const [current, previous, running, seriesRows, staffRows, serviceRows, productRows, flaggedRows, sourceRows, methodRows, lateRows] = await Promise.all([
    costingTotals(branchId, period.start, period.end),
    costingTotals(branchId, period.previous.start, period.previous.end),
    runningCostTotal(branchId, period.from, period.to),
    db.query(
      `SELECT ${bucketSql('f.performed_at', period.groupBy)} AS bucket, COUNT(*) AS services, SUM(f.price) AS sales, SUM(f.product_cost) AS productCost,
              SUM(f.operations_amount) AS operations, SUM(f.staff_pool) AS staffEarnings, SUM(f.salon_profit) AS salonProfit
       ${scope} GROUP BY bucket`,
      args,
    ),
    // Each person's part of a shared service: their revenue share, an equal share of its products, their pay.
    db.query(
      `SELECT e.id, e.full_name AS name, COUNT(*) AS services, SUM(f.staff_count > 1) AS shared, SUM(sis.revenue_share) AS revenue,
              SUM(f.product_cost / f.staff_count) AS productCost, SUM(sis.commission_amount) AS earnings
       FROM sale_item_staff sis JOIN employees e ON e.id = sis.employee_id JOIN sale_item_finance f ON f.sale_item_id = sis.sale_item_id
       JOIN sales s ON s.id = f.sale_id
       WHERE f.branch_id = ? AND s.status = 'completed' AND f.performed_at >= ? AND f.performed_at < ?
       GROUP BY e.id, e.full_name ORDER BY earnings DESC, name`,
      args,
    ),
    db.query(
      `SELECT f.service_id AS id, f.service_name AS name, COUNT(*) AS count, SUM(f.price) AS revenue, SUM(f.product_cost) AS productCost,
              SUM(f.operations_amount) AS operations, SUM(f.staff_pool) AS staffEarnings, SUM(f.salon_profit) AS salonProfit
       ${scope} GROUP BY f.service_id, f.service_name ORDER BY salonProfit DESC, name`,
      args,
    ),
    db.query(
      `SELECT u.product_id AS id, MAX(u.product_name) AS name, u.unit, SUM(u.quantity) AS quantity, SUM(u.total_cost) AS cost,
              COUNT(DISTINCT u.sale_item_id) AS timesUsed, GROUP_CONCAT(DISTINCT f.service_name ORDER BY f.service_name SEPARATOR ', ') AS services
       FROM sale_item_products u JOIN sale_item_finance f ON f.sale_item_id = u.sale_item_id JOIN sales s ON s.id = f.sale_id
       WHERE f.branch_id = ? AND s.status = 'completed' AND f.performed_at >= ? AND f.performed_at < ?
       GROUP BY u.product_id, u.unit ORDER BY cost DESC, name`,
      args,
    ),
    db.query(
      `SELECT f.sale_item_id AS itemId, s.id AS saleId, s.invoice_number AS invoiceNumber, f.service_name AS service, f.price, f.product_cost AS productCost,
              f.salon_profit AS salonProfit, f.margin_status AS marginStatus, f.review_status AS reviewStatus, f.review_note AS reviewNote, f.performed_at AS performedAt
       ${scope} AND f.margin_status <> 'positive' ORDER BY f.review_status = 'pending' DESC, f.performed_at DESC LIMIT 200`,
      args,
    ),
    // How the services were entered: at the till, recorded later, imported.
    db.query(
      `SELECT s.source, COUNT(*) AS services, COUNT(DISTINCT s.id) AS sales, SUM(f.price) AS revenue, SUM(f.product_cost) AS productCost,
              SUM(f.consumption_cost) AS consumptionCost, SUM(f.operations_amount) AS operations, SUM(f.staff_pool) AS staffEarnings, SUM(f.salon_profit) AS salonProfit
       ${scope} GROUP BY s.source`,
      args,
    ),
    // Which calculation: general formula, a service's fixed amounts, or its band using the general formula.
    db.query(
      `SELECT f.calculation_method AS method, COUNT(*) AS services, SUM(f.price) AS revenue, SUM(f.operations_amount) AS operations,
              SUM(f.staff_pool) AS staffEarnings, SUM(f.salon_profit) AS salonProfit
       ${scope} GROUP BY f.calculation_method`,
      args,
    ),
    // Sales recorded for an earlier date, moved to another date, or voided in the period (for control).
    db.query(
      `SELECT s.id, s.invoice_number AS invoiceNumber, s.status, s.source, s.total, s.sold_at AS soldAt, s.original_sold_at AS originalSoldAt,
              s.created_at AS createdAt, s.backdate_reason AS backdateReason, s.void_reason AS voidReason, s.voided_at AS voidedAt,
              u.full_name AS enteredBy, vb.full_name AS voidedBy
       FROM sales s JOIN users u ON u.id = s.cashier_id LEFT JOIN users vb ON vb.id = s.voided_by
       WHERE s.branch_id = ? AND s.sold_at >= ? AND s.sold_at < ?
         AND (s.is_backdated = 1 OR s.status = 'voided' OR s.original_sold_at <> s.sold_at)
       ORDER BY s.sold_at DESC LIMIT 200`,
      args,
    ),
  ]);

  const series = fillSeries(period, seriesRows, {
    services: 'number', sales: 'money', productCost: 'money', operations: 'money', staffEarnings: 'money', salonProfit: 'money',
  });
  return {
    period,
    summary: {
      ...current,
      staffShare: pct(current.staffEarnings, current.sales),
      profitMargin: pct(current.salonProfit, current.sales),
      // The operations allocation is meant to cover the running costs actually recorded.
      runningCosts: running,
      operationsCoverage: money(current.operations - running),
      change: {
        sales: change(current.sales, previous.sales),
        staffEarnings: change(current.staffEarnings, previous.staffEarnings),
        salonProfit: change(current.salonProfit, previous.salonProfit),
      },
    },
    series,
    staff: staffRows.map((r) => ({
      id: r.id, name: r.name, services: Number(r.services), shared: Number(r.shared), revenue: money(r.revenue), productCost: money(r.productCost),
      earnings: money(r.earnings), averageEarnings: Number(r.services) ? money(r.earnings / r.services) : 0,
    })),
    services: serviceRows.map((r) => ({
      id: r.id, name: r.name, count: Number(r.count), revenue: money(r.revenue), productCost: money(r.productCost), operations: money(r.operations),
      staffEarnings: money(r.staffEarnings), salonProfit: money(r.salonProfit), averageProfit: money(r.salonProfit / r.count), margin: pct(r.salonProfit, r.revenue),
    })),
    products: productRows.map((r) => ({
      id: r.id, name: r.name, unit: r.unit, quantity: toNumber(r.quantity, 3), cost: money(r.cost), timesUsed: Number(r.timesUsed), services: r.services || '',
    })),
    flagged: flaggedRows.map((r) => ({ ...r, price: money(r.price), productCost: money(r.productCost), salonProfit: money(r.salonProfit) })),
    bySource: ['pos', 'backdated', 'import'].map((source) => {
      const r = sourceRows.find((x) => x.source === source) || {};
      return {
        source, sales: Number(r.sales || 0), services: Number(r.services || 0), revenue: money(r.revenue || 0), productCost: money(r.productCost || 0),
        consumptionCost: money(r.consumptionCost || 0), operations: money(r.operations || 0), staffEarnings: money(r.staffEarnings || 0), salonProfit: money(r.salonProfit || 0),
      };
    }),
    byMethod: methodRows.map((r) => ({
      method: r.method, services: Number(r.services), revenue: money(r.revenue), operations: money(r.operations), staffEarnings: money(r.staffEarnings), salonProfit: money(r.salonProfit),
    })),
    corrections: lateRows.map((r) => ({
      ...r, total: money(r.total), moved: Boolean(r.originalSoldAt && new Date(r.originalSoldAt).getTime() !== new Date(r.soldAt).getTime()),
    })),
  };
}

// ---- Branch comparison --------------------------------------------------------------------------

async function branches(params) {
  const period = resolvePeriod(params);
  const list = await db.query('SELECT id, code, name, is_active FROM branches ORDER BY is_default DESC, name');
  const rows = [];
  for (const b of list) {
    const [s, e, appts] = await Promise.all([
      salesTotals(b.id, period.start, period.end),
      expenseTotal(b.id, period.from, period.to),
      db.queryOne(
        "SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed FROM appointments WHERE branch_id = ? AND start_time >= ? AND start_time < ?",
        [b.id, period.start, period.end],
      ),
    ]);
    if (!b.is_active && !s.count && !e.count) continue;
    rows.push({
      id: b.id, code: b.code, name: b.name, active: Boolean(b.is_active),
      sales: s.count, grossSales: s.gross, netSales: s.net, averageSale: s.averageSale, cogs: s.cogs,
      expenses: e.total, netProfit: money(s.grossProfit - e.total), customers: s.customers,
      appointments: Number(appts.total || 0), completedAppointments: Number(appts.completed || 0),
    });
  }
  const total = (key) => money(rows.reduce((sum, r) => sum + r[key], 0));
  for (const r of rows) r.share = pct(r.grossSales, total('grossSales'));
  return {
    period,
    summary: { branches: rows.length, grossSales: total('grossSales'), netSales: total('netSales'), expenses: total('expenses'), netProfit: total('netProfit') },
    branches: rows.sort((a, b) => b.grossSales - a.grossSales),
  };
}

/** Report registry: permission required, builder, and document title. */
const REPORTS = {
  sales: { permission: 'reports.view', build: sales, title: 'Sales report' },
  customers: { permission: 'reports.view', build: customers, title: 'Customer report' },
  services: { permission: 'reports.view', build: services, title: 'Service performance report' },
  staff: { permission: 'reports.view', build: staff, title: 'Staff performance report' },
  inventory: { permission: 'reports.view', build: inventory, title: 'Inventory report' },
  expenses: { permission: 'reports.financial', build: expenses, title: 'Expense report' },
  profit: { permission: 'reports.financial', build: profit, title: 'Profit & loss statement' },
  costing: { permission: 'reports.financial', build: costing, title: 'Service costing report' },
  branches: { permission: ['reports.financial', 'branches.manage'], all: true, build: branches, title: 'Branch comparison' },
};

module.exports = { REPORTS, resolvePeriod, salesTotals, expenseTotal, runningCostTotal, commissionEarned, costingTotals, bucketSql, local, fillSeries, money, pct, change };
