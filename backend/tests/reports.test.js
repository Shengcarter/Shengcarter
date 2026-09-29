'use strict';

const { DateTime } = require('luxon');
const { signIn, db } = require('./helpers');
const settings = require('../src/services/settingsService');

describe('reports', () => {
  let admin;
  let today;

  beforeAll(async () => {
    admin = await signIn();
    await settings.load();
    today = DateTime.now().setZone(settings.get('system.timezone')).toISODate();
    // Make sure there is at least one sale and one expense today.
    const service = await db.queryOne("SELECT s.id, es.employee_id FROM services s JOIN employee_services es ON es.service_id = s.id WHERE s.is_active = 1 LIMIT 1");
    await admin.post('/sales', { items: [{ type: 'service', serviceId: service.id, employeeId: service.employee_id }], payments: [{ method: 'cash', amount: 1000000 }] });
    const category = await db.queryOne("SELECT id FROM expense_categories WHERE slug = 'supplies'");
    await admin.post('/expenses', { categoryId: category.id, expenseDate: today, amount: 25000, description: 'Report test supplies', paymentMethod: 'cash' });
  });

  test('sales report totals match the database', async () => {
    const res = await admin.get(`/reports/sales?from=${today}&to=${today}`);
    expect(res.status).toBe(200);
    const s = res.body.data.summary;
    const db1 = await db.queryOne(
      "SELECT COUNT(*) AS n, SUM(total) AS gross, SUM(tax_amount) AS tax FROM sales WHERE status = 'completed' AND sold_at >= ? AND sold_at < ?",
      [new Date(res.body.data.period.start), new Date(res.body.data.period.end)],
    );
    expect(s.count).toBe(Number(db1.n));
    expect(s.gross).toBe(Number(db1.gross));
    expect(s.net).toBe(Number(db1.gross) - Number(db1.tax));
    const seriesTotal = res.body.data.series.reduce((sum, p) => sum + p.gross, 0);
    expect(seriesTotal).toBe(s.gross);
  });

  test('profit = net sales − cost of goods − expenses', async () => {
    const res = await admin.get(`/reports/profit?from=${today}&to=${today}`);
    const s = res.body.data.summary;
    expect(s.netSales).toBe(s.grossSales - s.tax);
    expect(s.grossProfit).toBe(s.netSales - s.cogs);
    expect(s.netProfit).toBe(s.grossProfit - s.expenses);
    expect(s.expenses).toBeGreaterThanOrEqual(25000);
  });

  test('customer, service, staff, inventory, expense and branch reports respond', async () => {
    for (const type of ['customers', 'services', 'staff', 'inventory', 'expenses', 'branches']) {
      const res = await admin.get(`/reports/${type}?from=${today}&to=${today}`);
      expect(res.status).toBe(200);
      expect(res.body.data.summary).toBeTruthy();
    }
  });

  test('exports produce PDF, Excel and CSV files carrying the system name', async () => {
    const pdf = await admin.get(`/reports/sales/export?format=pdf&from=${today}&to=${today}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/application\/pdf/);
    expect(pdf.body.slice(0, 4).toString()).toBe('%PDF');

    const xlsx = await admin.download(`/reports/profit/export?format=xlsx&from=${today}&to=${today}`);
    expect(xlsx.status).toBe(200);
    expect(xlsx.body.slice(0, 2).toString()).toBe('PK'); // zip container

    const csv = await admin.get(`/reports/expenses/export?format=csv&from=${today}&to=${today}`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('ZOLA STYLISH MANAGEMENT SYSTEM');
    expect(csv.text).toContain('Expense report');
  });

  test('invalid periods are rejected', async () => {
    const res = await admin.get('/reports/sales?from=2026-05-10&to=2026-05-01');
    expect(res.status).toBe(422);
  });

  test('insights work without an AI provider', async () => {
    const res = await admin.get('/insights');
    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe('rules');
    expect(Array.isArray(res.body.data.findings)).toBe(true);
    expect(res.body.data.summary).toMatch(/salon/);
  });

  test('dashboard adapts to the role', async () => {
    const res = await admin.get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.data.sales).toBeTruthy();
    expect(res.body.data.finance).toBeTruthy();
  });
});
