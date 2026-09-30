'use strict';

const crypto = require('crypto');
const { DateTime } = require('luxon');
const { signIn, getApp, db, request } = require('./helpers');
const settings = require('../src/services/settingsService');
const branchService = require('../src/services/branchService');
const { REPORTS, commissionEarned, runningCostTotal } = require('../src/services/reportService');

/**
 * Staff are paid by commission only: payouts gather unpaid commission for a
 * period, may add a bonus or deductions, and are recorded as a "Staff
 * commissions" expense. "Profit after commission" counts commission when it
 * is earned. Runs on its own branch so the expected figures are exact.
 */
describe('commission-only pay', () => {
  let admin;
  let branchId;
  let employeeId;
  let otherEmployeeId;
  let today;
  let twoMonthsAgo;
  let lastMonth;
  let commissionCategory;
  let rentCategory;
  const ctx = () => ({ branchId });
  const monthRange = (m) => ({ from: m.toISODate(), to: m.endOf('month').toISODate() });

  /** Calls in the test branch (Super Admin picks the branch with X-Branch-Id). */
  const inBranch = async (method, url, body) => {
    const req = request(await getApp())[method](`/api${url}`).set('Authorization', `Bearer ${admin.token}`).set('X-Branch-Id', String(branchId));
    return body === undefined ? req : req.send(body);
  };

  /** A completed sale with one service line whose commission belongs to `employee`. */
  async function soldWithCommission(employee, at, value, commission, status = 'earned') {
    const ref = crypto.randomBytes(5).toString('hex').toUpperCase();
    const cashier = (await db.queryOne("SELECT id FROM users WHERE email = 'admin@test.local'")).id;
    const saleId = (await db.query(
      `INSERT INTO sales (invoice_number, receipt_number, branch_id, cashier_id, subtotal, total, amount_paid, tax_mode, status, sold_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'none', ?, ?)`,
      [`T-${ref}`, `TR-${ref}`, branchId, cashier, value, value, value, status === 'reversed' ? 'refunded' : 'completed', at],
    )).insertId;
    const itemId = (await db.query(
      `INSERT INTO sale_items (sale_id, item_type, employee_id, description, quantity, unit_price, line_total, net_amount, commission_rate, commission_amount)
       VALUES (?, 'service', ?, 'Test service', 1, ?, ?, ?, 40, ?)`,
      [saleId, employee, value, value, value, commission],
    )).insertId;
    await db.query('INSERT INTO sale_item_staff (sale_item_id, employee_id, revenue_share, commission_amount) VALUES (?, ?, ?, ?)', [itemId, employee, value, commission]);
    await db.query(
      `INSERT INTO commissions (employee_id, branch_id, sale_id, sale_item_id, base_amount, rate, amount, status, earned_at)
       VALUES (?, ?, ?, ?, ?, 40, ?, ?, ?)`,
      [employee, branchId, saleId, itemId, value, commission, status, at],
    );
  }

  beforeAll(async () => {
    admin = await signIn();
    await settings.load();
    today = DateTime.now().setZone(settings.get('system.timezone')).startOf('day');
    twoMonthsAgo = today.minus({ months: 2 }).startOf('month');
    lastMonth = today.minus({ months: 1 }).startOf('month');
    commissionCategory = (await db.queryOne("SELECT id FROM expense_categories WHERE slug = 'staff_commissions'"))?.id;
    rentCategory = (await db.queryOne("SELECT id FROM expense_categories WHERE slug = 'rent'")).id;

    branchId = (await db.query("INSERT INTO branches (code, name) VALUES ('COMMPAY', 'Commission test branch')")).insertId;
    branchService.clearCache();
    employeeId = (await db.query(
      "INSERT INTO employees (code, branch_id, full_name, job_title, commission_rate) VALUES ('EMP-CPAY1', ?, 'Commission Tester', 'Stylist', 40)",
      [branchId],
    )).insertId;
    otherEmployeeId = (await db.query(
      "INSERT INTO employees (code, branch_id, full_name, job_title, commission_rate) VALUES ('EMP-CPAY2', ?, 'Nothing Owed', 'Stylist', 40)",
      [branchId],
    )).insertId;

    // Two months ago: 20,000 of commission earned. Last month: 30,000 (plus 5,000 refunded).
    const at = (d, hour = 12) => d.set({ hour }).toUTC().toJSDate();
    await soldWithCommission(employeeId, at(twoMonthsAgo.plus({ days: 4 })), 50000, 20000);
    await soldWithCommission(employeeId, at(lastMonth.plus({ days: 2 })), 45000, 18000);
    await soldWithCommission(employeeId, at(lastMonth.plus({ days: 20 })), 30000, 12000);
    await soldWithCommission(employeeId, at(lastMonth.plus({ days: 21 })), 12500, 5000, 'reversed');
    // Rent last month, and a helper's pay entered by hand as an ordinary expense.
    await db.query(
      `INSERT INTO expenses (branch_id, category_id, expense_date, amount, description) VALUES
       (?, ?, ?, 100000, 'Rent'), (?, ?, ?, 50000, 'Helper paid by hand')`,
      [branchId, rentCategory, lastMonth.toISODate(), branchId, commissionCategory, lastMonth.plus({ days: 4 }).toISODate()],
    );
  });

  test('the payroll expense category is "Staff commissions" and employees have no salary', async () => {
    expect(commissionCategory).toBeTruthy();
    expect(await db.queryOne("SELECT id FROM expense_categories WHERE slug = 'salaries'")).toBeNull();
    const created = await inBranch('post', '/employees', { fullName: 'No Salary Person', jobTitle: 'Stylist', commissionRate: 35, salary: 900000 });
    expect(created.status).toBe(201);
    expect(created.body.data.salary).toBeUndefined();
    expect(created.body.data.commissionRate).toBe(35);
    expect(Number((await db.queryOne('SELECT salary FROM employees WHERE id = ?', [created.body.data.id])).salary)).toBe(0);
  });

  test('commission earned counts commission when it is earned, refunds excluded', async () => {
    expect(await commissionEarned(branchId, monthRange(twoMonthsAgo).from, monthRange(twoMonthsAgo).to)).toMatchObject({ commission: 20000, bonuses: 0, total: 20000 });
    expect(await commissionEarned(branchId, monthRange(lastMonth).from, monthRange(lastMonth).to)).toMatchObject({ commission: 30000, total: 30000 });
    const future = await commissionEarned(branchId, today.plus({ days: 1 }).toISODate(), today.plus({ days: 5 }).toISODate());
    expect(future.total).toBe(0);
  });

  test('preparing payouts gathers each person\'s unpaid commission; nobody gets a payout for nothing', async () => {
    const res = await inBranch('post', '/payroll/payouts/generate', { periodStart: lastMonth.toISODate(), periodEnd: lastMonth.endOf('month').toISODate() });
    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(1);
    expect(res.body.data.nothingOwed).toContain('Nothing Owed');
    expect(res.body.message).toBe('1 payout prepared');

    const again = await inBranch('post', '/payroll/payouts/generate', { periodStart: lastMonth.toISODate(), periodEnd: lastMonth.endOf('month').toISODate() });
    expect(again.body.data.created).toBe(0);
    expect(again.body.data.skipped).toEqual(['Commission Tester']);

    const list = await inBranch('get', '/payroll/payouts');
    const [payout] = list.body.data;
    expect(payout).toMatchObject({ employeeName: 'Commission Tester', commissionAmount: 30000, bonus: 0, deductions: 0, netPay: 30000, status: 'pending', commissionCount: 2 });
    expect(payout.baseSalary).toBeUndefined();
  });

  test('a bonus and deductions adjust the payout; deductions cannot exceed what is owed', async () => {
    const [payout] = (await inBranch('get', '/payroll/payouts')).body.data;
    const tooMuch = await inBranch('patch', `/payroll/payouts/${payout.id}`, { deductions: 50000 });
    expect(tooMuch.status).toBe(422);
    const res = await inBranch('patch', `/payroll/payouts/${payout.id}`, { bonus: 10000, deductions: 4000, baseSalary: 999999 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ commissionAmount: 30000, bonus: 10000, deductions: 4000, netPay: 36000 });
  });

  test('paying records a "Staff commissions" expense and marks the commission paid', async () => {
    const [payout] = (await inBranch('get', '/payroll/payouts')).body.data;
    const payday = lastMonth.endOf('month').toISODate();
    const res = await inBranch('post', `/payroll/payouts/${payout.id}/pay`, { paymentMethod: 'mobile_money', paidDate: payday });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Commission paid and recorded as an expense');
    const expense = await db.queryOne('SELECT e.amount, e.description, c.slug FROM expenses e JOIN expense_categories c ON c.id = e.category_id WHERE e.id = ?', [res.body.data.expenseId]);
    expect(expense).toMatchObject({ slug: 'staff_commissions', description: `Commission: Commission Tester (${lastMonth.toISODate()} to ${payday})` });
    expect(Number(expense.amount)).toBe(36000);
    const statuses = await db.query('SELECT status, COUNT(*) AS n FROM commissions WHERE employee_id = ? GROUP BY status ORDER BY status', [employeeId]);
    expect(statuses.map((r) => [r.status, Number(r.n)])).toEqual([['earned', 1], ['paid', 2], ['reversed', 1]]);

    // The payout's expense cannot be edited or deleted from Expenses.
    const edit = await inBranch('patch', `/expenses/${res.body.data.expenseId}`, { amount: 1 });
    expect(edit.status).toBe(400);
    expect(edit.body.message).toMatch(/commission payout/);
  });

  test('running costs leave out payouts but keep pay entered by hand', async () => {
    const { from, to } = monthRange(lastMonth);
    expect(await runningCostTotal(branchId, from, to)).toBe(150000);
    // The bonus minus deductions (6,000) counts over the payout's days.
    expect((await commissionEarned(branchId, from, to)).total).toBeCloseTo(36000, 1);
  });

  test('profit after commission equals cash profit once the month is paid out, and differs before', async () => {
    const paid = (await REPORTS.profit.build(monthRange(lastMonth), ctx())).summary;
    // Net sales 75,000 (the refunded sale is left out); expenses 100,000 rent + 50,000 by hand + 36,000 payout.
    expect(paid.netSales).toBe(75000);
    expect(paid.netProfit).toBe(75000 - 186000);
    expect(paid.afterCommission).toMatchObject({ runningCosts: 150000, commission: 30000 });
    expect(paid.afterCommission.bonuses).toBeCloseTo(6000, 1);
    expect(paid.afterCommission.profit).toBeCloseTo(paid.netProfit, 1);

    // Two months ago nothing was paid out: cash profit ignores the 20,000 owed, profit after commission does not.
    const unpaid = (await REPORTS.profit.build(monthRange(twoMonthsAgo), ctx())).summary;
    expect(unpaid.afterCommission.commission).toBe(20000);
    expect(unpaid.afterCommission.profit).toBeCloseTo(unpaid.netProfit - 20000, 1);
  });

  test('the main branch profit & loss and dashboard use commission, not wages', async () => {
    const res = await admin.get('/reports/profit');
    expect(res.status).toBe(200);
    const s = res.body.data.summary;
    expect(s.afterWages).toBeUndefined();
    const c = s.afterCommission;
    expect(c.profit).toBeCloseTo(s.grossProfit - c.runningCosts - c.commission - c.bonuses, 1);
    const dashboard = (await admin.get('/dashboard')).body.data.finance;
    expect(dashboard.profitAfterCommission).toBeCloseTo(c.profit, 1);
    expect(dashboard.wagesEarned).toBeUndefined();
  });

  test('old salary endpoints are gone', async () => {
    expect((await inBranch('get', '/payroll/salaries')).status).toBe(404);
  });
});
