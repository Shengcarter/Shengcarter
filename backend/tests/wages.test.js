'use strict';

const { DateTime } = require('luxon');
const { signIn, db } = require('./helpers');
const settings = require('../src/services/settingsService');
const { REPORTS, wagesEarned, runningCostTotal } = require('../src/services/reportService');

/**
 * Wages counted as earned (not on payday): the basis for "profit after wages"
 * and for cost insights that are not thrown off by when salaries are paid.
 * Runs on its own branch so the expected figures are exact.
 */
describe('wages counted as earned', () => {
  let branchId;
  let employeeId;
  let today;
  let twoMonthsAgo;
  let lastMonth;
  let salariesCategory;
  let rentCategory;
  const ctx = () => ({ branchId });
  const monthRange = (m) => ({ from: m.toISODate(), to: m.endOf('month').toISODate() });

  beforeAll(async () => {
    await settings.load();
    today = DateTime.now().setZone(settings.get('system.timezone')).startOf('day');
    twoMonthsAgo = today.minus({ months: 2 }).startOf('month');
    lastMonth = today.minus({ months: 1 }).startOf('month');
    salariesCategory = (await db.queryOne("SELECT id FROM expense_categories WHERE slug = 'salaries'")).id;
    rentCategory = (await db.queryOne("SELECT id FROM expense_categories WHERE slug = 'rent'")).id;

    branchId = (await db.query("INSERT INTO branches (code, name) VALUES ('WAGES', 'Wage test branch')")).insertId;
    // Started on the 10th, two months ago, on TSh 300,000 a month.
    employeeId = (await db.query(
      "INSERT INTO employees (code, branch_id, full_name, job_title, employment_date, salary) VALUES ('EMP-WAGES', ?, 'Wage Tester', 'Stylist', ?, 300000)",
      [branchId, twoMonthsAgo.plus({ days: 9 }).toISODate()],
    )).insertId;

    // Last month: payroll paid on the last day (base 300,000 + bonus 20,000 − deductions 5,000).
    const payday = lastMonth.endOf('month').toISODate();
    const salaryExpense = (await db.query(
      "INSERT INTO expenses (branch_id, category_id, expense_date, amount, description, payment_method) VALUES (?, ?, ?, 315000, 'Salary: Wage Tester', 'bank_transfer')",
      [branchId, salariesCategory, payday],
    )).insertId;
    await db.query(
      `INSERT INTO salary_records (employee_id, branch_id, period_start, period_end, base_salary, bonus, deductions, net_pay, status, paid_at, expense_id)
       VALUES (?, ?, ?, ?, 300000, 20000, 5000, 315000, 'paid', UTC_TIMESTAMP(), ?)`,
      [employeeId, branchId, lastMonth.toISODate(), payday, salaryExpense],
    );
    // Other costs last month: rent, and a cleaner's wage entered by hand under "Salaries".
    await db.query(
      `INSERT INTO expenses (branch_id, category_id, expense_date, amount, description) VALUES
       (?, ?, ?, 100000, 'Rent'), (?, ?, ?, 50000, 'Cleaner (paid by hand)')`,
      [branchId, rentCategory, lastMonth.toISODate(), branchId, salariesCategory, lastMonth.plus({ days: 4 }).toISODate()],
    );
  });

  test('a month without a salary record counts the monthly salary from the start date', async () => {
    const { from, to } = monthRange(twoMonthsAgo);
    const wages = await wagesEarned(branchId, from, to);
    const days = twoMonthsAgo.daysInMonth;
    expect(wages.salaries).toBeCloseTo((300000 * (days - 9)) / days, 1);
    expect(wages.commission).toBe(0);
  });

  test('a salary record replaces the estimate with the real pay, spread over its days', async () => {
    const { from, to } = monthRange(lastMonth);
    expect((await wagesEarned(branchId, from, to)).salaries).toBeCloseTo(315000, 1);
    const firstHalf = await wagesEarned(branchId, from, lastMonth.plus({ days: 14 }).toISODate());
    expect(firstHalf.salaries).toBeCloseTo((315000 * 15) / lastMonth.daysInMonth, 1);
  });

  test('only days up to today count', async () => {
    const wages = await wagesEarned(branchId, today.startOf('month').toISODate(), today.endOf('month').toISODate());
    expect(wages.through).toBe(today.toISODate());
    expect(wages.salaries).toBeCloseTo((300000 * today.day) / today.daysInMonth, 1);
    const future = await wagesEarned(branchId, today.plus({ days: 1 }).toISODate(), today.plus({ days: 5 }).toISODate());
    expect(future.total).toBe(0);
  });

  test('running costs leave out payroll salary payments but keep salaries entered by hand', async () => {
    const { from, to } = monthRange(lastMonth);
    expect(await runningCostTotal(branchId, from, to)).toBe(150000);
  });

  test('profit after wages equals cash profit once the month is paid, and differs before', async () => {
    const paid = (await REPORTS.profit.build(monthRange(lastMonth), ctx())).summary;
    expect(paid.netProfit).toBe(-465000);
    expect(paid.afterWages).toMatchObject({ runningCosts: 150000, commission: 0, profit: -465000 });
    expect(paid.afterWages.salaries).toBeCloseTo(315000, 1);

    // Two months ago nothing was paid: cash profit shows no wages, profit after wages does.
    const unpaid = (await REPORTS.profit.build(monthRange(twoMonthsAgo), ctx())).summary;
    expect(unpaid.netProfit).toBe(0);
    expect(unpaid.afterWages.profit).toBeCloseTo(-unpaid.afterWages.salaries, 1);
    expect(unpaid.afterWages.salaries).toBeGreaterThan(0);
  });

  test('the profit & loss adds up for the main branch too', async () => {
    const admin = await signIn();
    const res = await admin.get('/reports/profit');
    expect(res.status).toBe(200);
    const s = res.body.data.summary;
    const w = s.afterWages;
    expect(w.profit).toBeCloseTo(s.grossProfit - w.runningCosts - w.salaries - w.commission, 1);
    const dashboard = (await admin.get('/dashboard')).body.data.finance;
    expect(dashboard.profitAfterWages).toBeCloseTo(w.profit, 1);
  });

  test('a salary payment falling inside the period does not change the insights', async () => {
    const admin = await signIn();
    // Expense insights need sales in the period to compare against.
    const service = await db.queryOne('SELECT s.id, es.employee_id FROM services s JOIN employee_services es ON es.service_id = s.id WHERE s.is_active = 1 LIMIT 1');
    const sale = await admin.post('/sales', { items: [{ type: 'service', serviceId: service.id, employeeId: service.employee_id }], payments: [{ method: 'cash', amount: 1000000 }] });
    expect(sale.status).toBe(201);
    const before = (await admin.get('/insights')).body.data.findings.map((f) => f.title);
    // An old month's salary paid late, yesterday: a large cash outflow in the period.
    const main = (await db.queryOne('SELECT id FROM branches WHERE is_default = 1')).id;
    const worker = (await db.queryOne('SELECT id FROM employees WHERE branch_id = ? ORDER BY id LIMIT 1', [main])).id;
    const old = today.minus({ years: 1 }).startOf('month');
    const expenseId = (await db.query(
      "INSERT INTO expenses (branch_id, category_id, expense_date, amount, description, payment_method) VALUES (?, ?, ?, 50000000, 'Late salary', 'bank_transfer')",
      [main, salariesCategory, today.minus({ days: 1 }).toISODate()],
    )).insertId;
    const recordId = (await db.query(
      `INSERT INTO salary_records (employee_id, branch_id, period_start, period_end, base_salary, net_pay, status, paid_at, expense_id)
       VALUES (?, ?, ?, ?, 50000000, 50000000, 'paid', UTC_TIMESTAMP(), ?)`,
      [worker, main, old.toISODate(), old.endOf('month').toISODate(), expenseId],
    )).insertId;
    try {
      const after = (await admin.get('/insights')).body.data.findings.map((f) => f.title);
      expect(after).toEqual(before);
      expect(after.some((t) => /^(Expenses|Running costs) rose|^Expenses are/.test(t))).toBe(false);
    } finally {
      await db.query('DELETE FROM salary_records WHERE id = ?', [recordId]);
      await db.query('DELETE FROM expenses WHERE id = ?', [expenseId]);
    }
  });
});
