'use strict';

const { DateTime } = require('luxon');
const db = require('../config/database');
const { hasPermission } = require('../middleware/auth');
const { camelizeRows } = require('../utils/case');
const { timezone, todayLocal, localDateRange } = require('../utils/time');
const { salesTotals, expenseTotal, runningCostTotal, wagesEarned, bucketSql, fillSeries, money, change } = require('./reportService');

/**
 * Dashboard for the signed-in user. Each section is included only when the
 * user's role allows it, so a stylist sees their own day while the owner sees
 * the whole salon.
 */
async function dashboard(ctx) {
  const can = (...codes) => codes.some((code) => hasPermission(ctx.user, code));
  const zone = timezone();
  const today = DateTime.fromISO(todayLocal(), { zone });
  const now = DateTime.now().setZone(zone);
  const branchId = ctx.branchId;
  const todayRange = localDateRange(today.toISODate(), today.toISODate());
  // Salons have a weekly rhythm, so today is compared with the same weekday last week.
  const lastWeek = today.minus({ days: 7 });
  const lastWeekRange = localDateRange(lastWeek.toISODate(), lastWeek.toISODate());
  const monthStart = today.startOf('month');
  const monthRange = localDateRange(monthStart.toISODate(), today.toISODate());
  // Same number of days last month, for a fair month-to-date comparison.
  const lastMonthStart = monthStart.minus({ months: 1 });
  const lastMonthEnd = DateTime.min(lastMonthStart.plus({ days: today.day - 1 }), lastMonthStart.endOf('month').startOf('day'));
  const lastMonthRange = localDateRange(lastMonthStart.toISODate(), lastMonthEnd.toISODate());

  const result = { generatedAt: new Date().toISOString(), date: today.toISODate() };

  if (can('sales.view', 'reports.view')) {
    const [todayTotals, lastWeekTotals, month, lastMonth] = await Promise.all([
      salesTotals(branchId, todayRange.start, todayRange.end),
      salesTotals(branchId, lastWeekRange.start, lastWeekRange.end),
      salesTotals(branchId, monthRange.start, monthRange.end),
      salesTotals(branchId, lastMonthRange.start, lastMonthRange.end),
    ]);
    const trendPeriod = { from: today.minus({ days: 29 }).toISODate(), to: today.toISODate(), groupBy: 'day' };
    const trendRange = localDateRange(trendPeriod.from, trendPeriod.to);
    const trendRows = await db.query(
      `SELECT ${bucketSql('sold_at', 'day')} AS bucket, COUNT(*) AS sales, SUM(total) AS gross
       FROM sales WHERE branch_id = ? AND status = 'completed' AND sold_at >= ? AND sold_at < ? GROUP BY bucket`,
      [branchId, trendRange.start, trendRange.end],
    );
    const methods = await db.query(
      'SELECT method, SUM(amount) AS total FROM payments WHERE branch_id = ? AND paid_at >= ? AND paid_at < ? GROUP BY method ORDER BY total DESC',
      [branchId, monthRange.start, monthRange.end],
    );
    const recent = await db.query(
      `SELECT s.id, s.invoice_number, s.total, s.payment_status, s.status, s.sold_at, c.full_name AS customer_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.branch_id = ? ORDER BY s.sold_at DESC, s.id DESC LIMIT 8`,
      [branchId],
    );
    const outstanding = await db.queryOne(
      "SELECT COUNT(*) AS count, COALESCE(SUM(balance_due), 0) AS total FROM sales WHERE branch_id = ? AND status = 'completed' AND balance_due > 0",
      [branchId],
    );
    const topServices = await db.query(
      `SELECT sv.name, SUM(i.quantity) AS quantity, SUM(i.net_amount) AS revenue
       FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN services sv ON sv.id = i.service_id
       WHERE s.branch_id = ? AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ? AND i.item_type = 'service'
       GROUP BY sv.id, sv.name ORDER BY revenue DESC LIMIT 5`,
      [branchId, monthRange.start, monthRange.end],
    );
    const topStaff = await db.query(
      `SELECT e.full_name AS name, SUM(i.quantity) AS services, SUM(i.net_amount) AS revenue
       FROM sale_items i JOIN sales s ON s.id = i.sale_id JOIN employees e ON e.id = i.employee_id
       WHERE s.branch_id = ? AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ? AND i.item_type = 'service'
       GROUP BY e.id, e.full_name ORDER BY revenue DESC LIMIT 5`,
      [branchId, monthRange.start, monthRange.end],
    );
    result.sales = {
      today: { ...todayTotals, change: change(todayTotals.gross, lastWeekTotals.gross) },
      sameDayLastWeek: lastWeekTotals,
      month: { ...month, change: change(month.gross, lastMonth.gross), countChange: change(month.count, lastMonth.count) },
      lastMonth,
      trend: fillSeries(trendPeriod, trendRows, { sales: 'number', gross: 'money' }),
      paymentMix: methods.map((m) => ({ method: m.method, total: money(m.total) })),
      recent: camelizeRows(recent),
      outstanding: { count: Number(outstanding.count), total: money(outstanding.total) },
      topServices: topServices.map((r) => ({ name: r.name, quantity: Number(r.quantity), revenue: money(r.revenue) })),
      topStaff: topStaff.map((r) => ({ name: r.name, services: Number(r.services), revenue: money(r.revenue) })),
    };
  }

  if (can('reports.financial')) {
    const [from, to, lastFrom, lastTo] = [monthStart.toISODate(), today.toISODate(), lastMonthStart.toISODate(), lastMonthEnd.toISODate()];
    const [exp, lastExp, running, lastRunning, wages, lastWages] = await Promise.all([
      expenseTotal(branchId, from, to),
      expenseTotal(branchId, lastFrom, lastTo),
      runningCostTotal(branchId, from, to),
      runningCostTotal(branchId, lastFrom, lastTo),
      wagesEarned(branchId, from, to),
      wagesEarned(branchId, lastFrom, lastTo),
    ]);
    const month = result.sales?.month || (await salesTotals(branchId, monthRange.start, monthRange.end));
    const lastMonth = result.sales?.lastMonth || (await salesTotals(branchId, lastMonthRange.start, lastMonthRange.end));
    const profit = money(month.grossProfit - exp.total);
    // Profit with wages counted as earned, so it does not jump on payday.
    const afterWages = money(month.grossProfit - running - wages.total);
    result.finance = {
      expenses: exp.total,
      expensesChange: change(exp.total, lastExp.total),
      netProfit: profit,
      profitChange: change(profit, lastMonth.grossProfit - lastExp.total),
      profitAfterWages: afterWages,
      profitAfterWagesChange: change(afterWages, lastMonth.grossProfit - lastRunning - lastWages.total),
      wagesEarned: wages.total,
      runningCosts: running,
    };
  }

  if (can('appointments.view', 'appointments.view_own')) {
    const ownOnly = !can('appointments.view');
    if (!ownOnly || ctx.user.employeeId) {
      const scope = ownOnly ? ' AND a.employee_id = ?' : '';
      const scopeParams = ownOnly ? [ctx.user.employeeId] : [];
      const counts = await db.query(
        `SELECT a.status, COUNT(*) AS n FROM appointments a WHERE a.branch_id = ? AND a.start_time >= ? AND a.start_time < ?${scope} GROUP BY a.status`,
        [branchId, todayRange.start, todayRange.end, ...scopeParams],
      );
      const byStatus = Object.fromEntries(counts.map((c) => [c.status, Number(c.n)]));
      const upcoming = await db.query(
        `SELECT a.id, a.code, a.start_time, a.end_time, a.status, c.full_name AS customer_name, e.full_name AS employee_name, e.calendar_color,
                (SELECT GROUP_CONCAT(x.service_name ORDER BY x.sort_order SEPARATOR ', ') FROM appointment_services x WHERE x.appointment_id = a.id) AS services
         FROM appointments a JOIN customers c ON c.id = a.customer_id JOIN employees e ON e.id = a.employee_id
         WHERE a.branch_id = ? AND a.end_time >= UTC_TIMESTAMP() AND a.status IN ('pending','confirmed','in_progress')${scope}
         ORDER BY a.start_time LIMIT 7`,
        [branchId, ...scopeParams],
      );
      result.appointments = {
        ownOnly,
        today: {
          total: Object.values(byStatus).reduce((s, n) => s + n, 0),
          pending: byStatus.pending || 0,
          confirmed: byStatus.confirmed || 0,
          inProgress: byStatus.in_progress || 0,
          completed: byStatus.completed || 0,
          cancelled: byStatus.cancelled || 0,
          noShow: byStatus.no_show || 0,
        },
        upcoming: camelizeRows(upcoming),
      };
    }
  }

  if (can('customers.view')) {
    const totals = await db.queryOne(
      `SELECT COUNT(*) AS total, SUM(created_at >= ? AND created_at < ?) AS this_month, SUM(created_at >= ? AND created_at < ?) AS last_month
       FROM customers WHERE deleted_at IS NULL`,
      [monthRange.start, monthRange.end, lastMonthRange.start, lastMonthRange.end],
    );
    const days = Array.from({ length: 7 }, (_, i) => today.plus({ days: i }).toFormat('MM-dd'));
    const birthdays = await db.query(
      `SELECT id, code, full_name, phone, date_of_birth FROM customers
       WHERE deleted_at IS NULL AND date_of_birth IS NOT NULL AND DATE_FORMAT(date_of_birth, '%m-%d') IN (?)`,
      [days],
    );
    result.customers = {
      total: Number(totals.total || 0),
      newThisMonth: Number(totals.this_month || 0),
      newChange: change(totals.this_month, totals.last_month),
      birthdays: camelizeRows(birthdays)
        .map((b) => ({ ...b, inDays: days.indexOf(String(b.dateOfBirth).slice(5, 10)) }))
        .sort((a, b) => a.inDays - b.inDays),
    };
  }

  if (can('inventory.view')) {
    const stock = await db.queryOne(
      "SELECT SUM(quantity <= min_stock AND quantity > 0) AS low, SUM(quantity = 0) AS out_of_stock FROM products WHERE branch_id = ? AND status = 'active'",
      [branchId],
    );
    const items = await db.query(
      "SELECT id, name, quantity, min_stock, unit FROM products WHERE branch_id = ? AND status = 'active' AND quantity <= min_stock ORDER BY quantity ASC, name LIMIT 5",
      [branchId],
    );
    result.inventory = { lowStock: Number(stock.low || 0), outOfStock: Number(stock.out_of_stock || 0), items: camelizeRows(items) };
  }

  if (can('attendance.view', 'attendance.manage', 'employees.view')) {
    const rows = await db.query(
      `SELECT e.id, e.full_name, e.job_title, e.calendar_color, a.status, a.clock_in, a.clock_out
       FROM employees e LEFT JOIN attendance a ON a.employee_id = e.id AND a.work_date = ?
       WHERE e.branch_id = ? AND e.status = 'active' ORDER BY a.clock_in IS NULL, a.clock_in, e.full_name`,
      [today.toISODate(), branchId],
    );
    result.staff = camelizeRows(rows);
  }

  if (ctx.user.employeeId) {
    const employeeId = ctx.user.employeeId;
    const mine = await db.queryOne(
      `SELECT SUM(i.quantity) AS services, COALESCE(SUM(i.net_amount), 0) AS revenue
       FROM sale_items i JOIN sales s ON s.id = i.sale_id
       WHERE i.employee_id = ? AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ? AND i.item_type = 'service'`,
      [employeeId, monthRange.start, monthRange.end],
    );
    const commission = await db.queryOne(
      "SELECT COALESCE(SUM(amount), 0) AS earned, COALESCE(SUM(CASE WHEN status = 'earned' THEN amount ELSE 0 END), 0) AS unpaid FROM commissions WHERE employee_id = ? AND status <> 'reversed' AND earned_at >= ? AND earned_at < ?",
      [employeeId, monthRange.start, monthRange.end],
    );
    const attendance = await db.queryOne('SELECT status, clock_in, clock_out FROM attendance WHERE employee_id = ? AND work_date = ?', [employeeId, today.toISODate()]);
    result.me = {
      employeeId,
      servicesThisMonth: Number(mine.services || 0),
      revenueThisMonth: money(mine.revenue),
      commissionThisMonth: money(commission.earned),
      unpaidCommission: money(commission.unpaid),
      attendance: attendance ? { status: attendance.status, clockIn: attendance.clock_in, clockOut: attendance.clock_out } : null,
      canClock: can('attendance.self', 'attendance.manage'),
    };
  }

  result.greetingHour = now.hour;
  return result;
}

module.exports = { dashboard };
