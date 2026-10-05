'use strict';

const ExcelJS = require('exceljs');
const { DateTime } = require('luxon');
const { signIn, getApp, db, request, DEMO } = require('./helpers');
const settings = require('../src/services/settingsService');
const branchService = require('../src/services/branchService');
const permissionService = require('../src/services/permissionService');

/**
 * Per-service financial rules end to end: the confirmed rules for Kufumua,
 * Steaming and Relaxer at the till, rule configuration (versioned and
 * audited), sales recorded for a previous date, voided and re-dated sales,
 * and Excel imports through the same engine. Runs on its own branch so every
 * figure is exact.
 */

let admin;
let branchId;
let A;
let B;
let C;
let zone;
const svc = {};

const inBranch = async (method, url, body, token = admin.token) => {
  const req = request(await getApp())[method](`/api${url}`).set('Authorization', `Bearer ${token}`).set('X-Branch-Id', String(branchId));
  return body === undefined ? req : req.send(body);
};
const sell = (items, extra = {}) => inBranch('post', '/sales', { items, payments: [{ method: 'cash', amount: 500000 }], ...extra });
const line = (name, price, staff = [A], extra = {}) => ({ type: 'service', serviceId: svc[name], price, employeeIds: staff, consumption: [], ...extra });
const financeOf = (saleId) => db.query('SELECT * FROM sale_item_finance WHERE sale_id = ? ORDER BY sale_item_id', [saleId]);
const split = (f) => [Number(f.operations_amount), Number(f.staff_pool), Number(f.salon_profit)];
const shares = async (saleItemId) => (await db.query('SELECT commission_amount FROM sale_item_staff WHERE sale_item_id = ? ORDER BY sort_order', [saleItemId]))
  .map((r) => Number(r.commission_amount));
const stock = async (id) => Number((await db.queryOne('SELECT quantity FROM products WHERE id = ?', [id])).quantity);
const recent = (date) => Math.abs(new Date(date).getTime() - Date.now()) < 5 * 60 * 1000;

beforeAll(async () => {
  admin = await signIn();
  await settings.load();
  zone = settings.get('system.timezone');
  branchId = (await db.query("INSERT INTO branches (code, name) VALUES ('RULES', 'Service rules test branch')")).insertId;
  branchService.clearCache();
  const employee = async (code, name) => (await db.query(
    "INSERT INTO employees (code, branch_id, full_name, job_title, commission_rate) VALUES (?, ?, ?, 'Stylist', 40)", [code, branchId, name],
  )).insertId;
  A = await employee('EMP-RULE1', 'Amina Rules');
  B = await employee('EMP-RULE2', 'Bahati Rules');
  C = await employee('EMP-RULE3', 'Cheusi Rules');
  for (const name of ['Kufumua', 'Steaming', 'Relaxer', 'Kubana Nyuele']) {
    svc[name] = (await db.queryOne('SELECT id FROM services WHERE name = ?', [name])).id;
  }
});

describe('the confirmed service rules at the till', () => {
  test('setup created the four services with their rules (Kubana Nyuele inactive and not configured)', async () => {
    const rows = await db.query(
      `SELECT s.name, s.price, s.max_price, s.is_active, r.method, r.version FROM services s JOIN service_financial_rules r ON r.id = s.financial_rule_id
       WHERE s.name IN ('Kufumua', 'Steaming', 'Relaxer', 'Kubana Nyuele') ORDER BY s.name`,
    );
    expect(rows.map((r) => [r.name, Number(r.price), r.max_price === null ? null : Number(r.max_price), r.is_active, r.method])).toEqual([
      ['Kubana Nyuele', 0, null, 0, 'unconfigured'],
      ['Kufumua', 2000, 20000, 1, 'bands'],
      ['Relaxer', 10000, 15000, 1, 'bands'],
      ['Steaming', 10000, 25000, 1, 'bands'],
    ]);
    // Every other service keeps the general formula, explicitly.
    const missing = await db.queryOne('SELECT COUNT(*) AS n FROM services WHERE financial_rule_id IS NULL');
    expect(missing.n).toBe(0);
  });

  test('Kufumua: fixed operations below 11,000 (no salon profit), the general formula from 11,000', async () => {
    const cases = [
      // price, staff, [operations, staff pool, salon profit], individual shares
      [2000, [A], [1000, 1000, 0], [1000]],
      [3000, [A], [1000, 2000, 0], [2000]],
      [4000, [A, B], [1000, 3000, 0], [1500, 1500]],
      [5000, [A], [1000, 4000, 0], [4000]],
      [6000, [A], [2000, 4000, 0], [4000]],
      [8000, [A, B], [2000, 6000, 0], [3000, 3000]],
      [10000, [A, B, C], [2000, 8000, 0], [2667, 2667, 2666]],
      [11000, [A], [3300, 3850, 3850], [3850]],
      [20000, [A, B, C], [6000, 7000, 7000], [2334, 2333, 2333]],
    ];
    const res = await sell(cases.map(([price, staff]) => line('Kufumua', price, staff)));
    expect(res.status).toBe(201);
    const rows = await financeOf(res.body.data.id);
    expect(rows).toHaveLength(cases.length);
    for (const [i, [price, , expected, expectedShares]] of cases.entries()) {
      const f = rows[i];
      expect(Number(f.price)).toBe(price);
      expect(Number(f.product_cost)).toBe(0);
      expect(split(f)).toEqual(expected);
      expect(Number(f.product_cost) + Number(f.operations_amount) + Number(f.staff_pool) + Number(f.salon_profit)).toBe(price);
      expect(f.calculation_method).toBe(price >= 11000 ? 'band_general' : 'band');
      expect(f.rule_version).toBeGreaterThanOrEqual(1);
      expect(await shares(f.sale_item_id)).toEqual(expectedShares);
    }
    // Commissions follow the individual shares.
    const total = await db.queryOne("SELECT SUM(amount) AS t FROM commissions WHERE sale_id = ? AND status = 'earned'", [res.body.data.id]);
    expect(Number(total.t)).toBe(cases.reduce((sum, c) => sum + c[2][1], 0));
  });

  test('Kufumua has no rule between the confirmed bands, so such a price is refused, not guessed', async () => {
    const res = await sell([line('Kufumua', 5500)]);
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ field: 'items.0.price' });
    expect(res.body.errors[0].message).toMatch(/no financial rule for 5,500/);
  });

  test('Steaming: exactly the confirmed amounts at 10,000, 15,000, 20,000 and 25,000', async () => {
    const cases = [
      [10000, [A], [4000, 3000, 3000], [3000]],
      [15000, [A, B], [6000, 3000, 6000], [1500, 1500]],
      [20000, [A, B, C], [9000, 3000, 8000], [1000, 1000, 1000]],
      [25000, [A], [10000, 4000, 11000], [4000]],
    ];
    const res = await sell(cases.map(([price, staff]) => line('Steaming', price, staff)));
    expect(res.status).toBe(201);
    const rows = await financeOf(res.body.data.id);
    for (const [i, [price, , expected, expectedShares]] of cases.entries()) {
      expect(Number(rows[i].price)).toBe(price);
      expect(split(rows[i])).toEqual(expected);
      expect(rows[i].operations_rate).toBeNull(); // fixed amounts, no percentages
      expect(await shares(rows[i].sale_item_id)).toEqual(expectedShares);
    }
  });

  test('Steaming at a price between the confirmed points, or twice on one line, is refused', async () => {
    const between = await sell([line('Steaming', 12000)]);
    expect(between.status).toBe(422);
    expect(between.body.errors[0].message).toBe('Steaming has no financial rule for 12,000. Configured prices: 10,000, 15,000, 20,000, 25,000.');
    const twice = await sell([line('Steaming', 10000, [A], { quantity: 2 })]);
    expect(twice.status).toBe(422);
    expect(twice.body.errors[0]).toMatchObject({ field: 'items.0.quantity' });
  });

  test('Relaxer: 10,000 and 15,000', async () => {
    const res = await sell([line('Relaxer', 10000), line('Relaxer', 15000, [A, B])]);
    expect(res.status).toBe(201);
    const rows = await financeOf(res.body.data.id);
    expect(rows.map(split)).toEqual([[4000, 3000, 3000], [6000, 3000, 6000]]);
  });

  test('a discount that takes a fixed-price service off its confirmed prices is refused with the reason', async () => {
    const res = await sell([line('Steaming', 10000)], { discount: { type: 'amount', value: 1000 } });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].message).toMatch(/no financial rule for 9,000.*after the discount/);
  });

  test('Kubana Nyuele cannot be sold until an administrator configures it', async () => {
    const inactive = await sell([line('Kubana Nyuele', undefined)]);
    expect(inactive.status).toBe(422);
    expect(inactive.body.errors[0].message).toBe('Service is not available');
    // Even if someone switches it on, there is no rule to split its price with.
    await db.query('UPDATE services SET is_active = 1, price = 30000 WHERE id = ?', [svc['Kubana Nyuele']]);
    try {
      const res = await sell([line('Kubana Nyuele', undefined)]);
      expect(res.status).toBe(422);
      expect(res.body.errors[0].message).toMatch(/Kubana Nyuele has no financial rule yet/);
    } finally {
      await db.query('UPDATE services SET is_active = 0, price = 0 WHERE id = ?', [svc['Kubana Nyuele']]);
    }
  });

  test('the cart preview offers the confirmed prices and shows the split', async () => {
    const res = await inBranch('post', '/sales/quote', { items: [{ type: 'service', serviceId: svc.Steaming, price: 20000, employeeIds: [A] }] });
    expect(res.status).toBe(200);
    const [l] = res.body.data.lines;
    expect(l.priceOptions).toEqual([10000, 15000, 20000, 25000]);
    expect(l.split).toMatchObject({ price: 20000, productCost: 0, operations: 9000, staffPool: 3000, salonProfit: 8000, method: 'band' });
  });

  test('products used on Kufumua are recorded and taken from stock at their cost, but not deducted from its price', async () => {
    const product = (await inBranch('post', '/products', {
      name: 'Rules Detangler', sku: 'RUL-DET', unit: 'bottle', purchasePrice: 5000, sellingPrice: 0, isRetail: false, openingStock: 10,
    })).body.data;
    const res = await sell([line('Kufumua', 4000, [A], { consumption: [{ productId: product.id, quantity: 1 }] })]);
    expect(res.status).toBe(201);
    const [f] = await financeOf(res.body.data.id);
    expect(Number(f.product_cost)).toBe(0);
    expect(Number(f.consumption_cost)).toBe(5000);
    expect(split(f)).toEqual([1000, 3000, 0]);
    expect(await stock(product.id)).toBe(9);
    // The cost is kept as it was on the day: a later price change does not rewrite it.
    await inBranch('patch', `/products/${product.id}`, { purchasePrice: 8000 });
    const used = await db.queryOne('SELECT unit_cost, total_cost FROM sale_item_products WHERE sale_item_id = ?', [f.sale_item_id]);
    expect([Number(used.unit_cost), Number(used.total_cost)]).toEqual([5000, 5000]);
  });

  test('the catalog shows how each service is priced; only people who see costs get the amounts', async () => {
    const steaming = (await admin.get(`/services/${svc.Steaming}`)).body.data;
    expect(steaming.financialRule).toMatchObject({ method: 'bands', configured: true, priceOptions: [10000, 15000, 20000, 25000], productCostDeducted: false });
    expect(steaming.financialRule.bands[0]).toMatchObject({ min: 10000, operations: { type: 'fixed', value: 4000 } });
    const receptionist = await signIn(DEMO.receptionist);
    const seen = (await receptionist.get(`/services/${svc.Steaming}`)).body.data.financialRule;
    expect(seen.priceOptions).toEqual([10000, 15000, 20000, 25000]);
    expect(seen.bands[0].operations).toBeUndefined();
  });
});

describe('configuring a service financial rule', () => {
  let wash;
  let earlierSale;
  const pointRule = (price, operations, staff, profit) => ({
    method: 'bands', productCost: 'none', productsIncluded: true,
    bands: [{ min: price, max: price, operations: { type: 'fixed', value: operations }, staff: { type: 'fixed', value: staff }, profit: { type: 'fixed', value: profit } }],
  });

  beforeAll(async () => {
    const category = (await db.queryOne('SELECT id FROM service_categories ORDER BY id LIMIT 1')).id;
    wash = (await admin.post('/services', { categoryId: category, name: 'Rules Wash', price: 8000, durationMinutes: 30 })).body.data;
  });

  test('a new service starts on the general formula', async () => {
    expect(wash.financialRule).toMatchObject({ method: 'general', version: 1 });
    const res = await sell([line('Rules Wash', undefined, [A])].map((l) => ({ ...l, serviceId: wash.id })));
    expect(res.status).toBe(201);
    earlierSale = res.body.data;
    const [f] = await financeOf(earlierSale.id);
    expect(split(f)).toEqual([2400, 2800, 2800]);
    expect(f).toMatchObject({ calculation_method: 'general', rule_version: 1 });
  });

  test('only people allowed to configure rules may change them; financial staff may read them', async () => {
    const receptionist = await signIn(DEMO.receptionist);
    expect((await receptionist.get(`/services/${wash.id}/financial-rule`)).status).toBe(403);
    expect((await receptionist.put(`/services/${wash.id}/financial-rule`, { rule: pointRule(8000, 2000, 3000, 3000) })).status).toBe(403);
    const accountant = await signIn(DEMO.accountant);
    expect((await accountant.get(`/services/${wash.id}/financial-rule`)).status).toBe(200);
    expect((await accountant.put(`/services/${wash.id}/financial-rule`, { rule: pointRule(8000, 2000, 3000, 3000) })).status).toBe(403);
    expect((await receptionist.post('/services/financial-rule/preview', { rule: pointRule(8000, 2000, 3000, 3000), price: 8000 })).status).toBe(403);
  });

  test('a rule whose parts do not add up, or whose bands overlap, is refused with the reason', async () => {
    const unbalanced = await admin.put(`/services/${wash.id}/financial-rule`, { rule: pointRule(8000, 2000, 3000, 2000) });
    expect(unbalanced.status).toBe(422);
    expect(unbalanced.body.errors[0].message).toMatch(/add up to 7,000, not 8,000/);
    const overlap = await admin.put(`/services/${wash.id}/financial-rule`, {
      rule: {
        method: 'bands', productCost: 'none',
        bands: [
          { min: 1000, max: 5000, operations: { type: 'fixed', value: 500 }, staff: { type: 'remainder' }, profit: { type: 'none' } },
          { min: 4000, max: 9000, general: true },
        ],
      },
    });
    expect(overlap.status).toBe(422);
    expect(overlap.body.errors[0].message).toMatch(/overlaps/);
  });

  test('saving a rule adds a version, is audited with the old and new rule, and leaves past sales alone', async () => {
    const res = await admin.put(`/services/${wash.id}/financial-rule`, { rule: pointRule(8000, 2000, 3000, 3000), notes: 'Confirmed by the owner' });
    expect(res.status).toBe(200);
    expect(res.body.data.current).toMatchObject({ version: 2, method: 'bands', notes: 'Confirmed by the owner' });
    expect(res.body.data.history.map((h) => h.version)).toEqual([2, 1]);
    expect(res.body.data.warnings[0]).toMatch(/Only these prices can be charged: 8,000/);

    const log = await db.queryOne("SELECT old_values, new_values, ip_address FROM activity_logs WHERE action = 'service.financial_rule_changed' AND entity_id = ? ORDER BY id DESC LIMIT 1", [wash.id]);
    expect(log.old_values).toMatchObject({ method: 'general' });
    expect(log.new_values).toMatchObject({ method: 'bands', bands: [{ min: 8000, max: 8000 }] });

    // New sales use version 2…
    const sale = await sell([{ type: 'service', serviceId: wash.id, employeeIds: [A], consumption: [] }]);
    const [f] = await financeOf(sale.body.data.id);
    expect(split(f)).toEqual([2000, 3000, 3000]);
    expect(f).toMatchObject({ calculation_method: 'band', rule_version: 2 });
    // …the earlier sale keeps version 1, even when corrected later.
    const [before] = await financeOf(earlierSale.id);
    expect(split(before)).toEqual([2400, 2800, 2800]);
    const correction = await inBranch('patch', `/sales/${earlierSale.id}/items/${before.sale_item_id}/costing`, { employeeIds: [A, B], reason: 'Two people did it' });
    expect(correction.status).toBe(200);
    const [after] = await financeOf(earlierSale.id);
    expect(split(after)).toEqual([2400, 2800, 2800]);
    expect(after).toMatchObject({ calculation_method: 'general', rule_version: 1 });
    expect(await shares(after.sale_item_id)).toEqual([1400, 1400]);
  });

  test('the preview tries a rule on a price without saving anything', async () => {
    const steaming = (await admin.get(`/services/${svc.Steaming}/financial-rule`)).body.data;
    const ok = await admin.post('/services/financial-rule/preview', { rule: steaming.rule, price: 20000, staffCount: 2 });
    expect(ok.body.data).toMatchObject({ ok: true, operations: 9000, staffPool: 3000, staffShares: [1500, 1500], salonProfit: 8000, totalAllocated: 20000, unallocated: 0 });
    const outside = await admin.post('/services/financial-rule/preview', { rule: steaming.rule, price: 17000 });
    expect(outside.body.data).toMatchObject({ ok: false });
    expect(outside.body.data.error).toMatch(/no financial rule for 17,000/);
  });

  test('the Kufumua rule lists the prices it does not cover', async () => {
    const kufumua = (await admin.get(`/services/${svc.Kufumua}/financial-rule`)).body.data;
    expect(kufumua.warnings[0]).toBe('No rule for 5,001–5,999, 10,001–10,999: these prices cannot be charged.');
  });
});

describe('recording a sale for a previous date', () => {
  const threeDaysAgo = () => DateTime.now().setZone(zone).minus({ days: 3 }).toISODate();

  test('needs its own permission and a reason, and cannot be in the future', async () => {
    const receptionist = await signIn(DEMO.receptionist);
    const service = await db.queryOne('SELECT s.id, es.employee_id FROM services s JOIN employee_services es ON es.service_id = s.id JOIN employees e ON e.id = es.employee_id WHERE s.is_active = 1 AND s.is_demo = 1 LIMIT 1');
    const body = { items: [{ type: 'service', serviceId: service.id, employeeIds: [service.employee_id], consumption: [] }], payments: [{ method: 'cash', amount: 500000 }] };
    const denied = await receptionist.post('/sales', { ...body, soldDate: threeDaysAgo(), backdateReason: 'Power cut' });
    expect(denied.status).toBe(403);
    expect((await sell([line('Kufumua', 4000)], { soldDate: threeDaysAgo() })).status).toBe(422);
    const future = await sell([line('Kufumua', 4000)], { soldDate: DateTime.now().setZone(zone).plus({ days: 1 }).toISODate(), backdateReason: 'Test' });
    expect(future.status).toBe(422);
    expect(future.body.errors[0].message).toMatch(/future/);
  });

  test('keeps the business date apart from when it was entered, and dates payments and commission on the business date', async () => {
    const product = (await inBranch('post', '/products', {
      name: 'Rules Shampoo', sku: 'RUL-SHA', unit: 'bottle', purchasePrice: 4000, sellingPrice: 9000, isRetail: true, openingStock: 5,
    })).body.data;
    const date = threeDaysAgo();
    const res = await sell([line('Steaming', 15000), { type: 'product', productId: product.id, quantity: 1 }], {
      soldDate: date, soldTime: '14:30', backdateReason: 'Recorded in the paper book during a power cut',
    });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatch(/previous date/);
    const sale = await db.queryOne('SELECT * FROM sales WHERE id = ?', [res.body.data.id]);
    expect(DateTime.fromJSDate(sale.sold_at).setZone(zone).toFormat('yyyy-MM-dd HH:mm')).toBe(`${date} 14:30`);
    expect(recent(sale.created_at)).toBe(true);
    expect(sale).toMatchObject({ source: 'backdated', is_backdated: 1, backdate_reason: 'Recorded in the paper book during a power cut' });
    expect(sale.original_sold_at.getTime()).toBe(sale.sold_at.getTime());

    const payment = await db.queryOne('SELECT paid_at, created_at FROM payments WHERE sale_id = ?', [sale.id]);
    expect(payment.paid_at.getTime()).toBe(sale.sold_at.getTime());
    expect(recent(payment.created_at)).toBe(true);
    const commission = await db.queryOne('SELECT earned_at, created_at, amount FROM commissions WHERE sale_id = ?', [sale.id]);
    expect(commission.earned_at.getTime()).toBe(sale.sold_at.getTime());
    expect(recent(commission.created_at)).toBe(true);
    expect(Number(commission.amount)).toBe(3000);
    const [f] = await financeOf(sale.id);
    expect(f.performed_at.getTime()).toBe(sale.sold_at.getTime());
    expect(split(f)).toEqual([6000, 3000, 6000]);
    // Stock leaves now (the count is today's), with the sale's date in the reason.
    const move = await db.queryOne("SELECT created_at, reason FROM inventory_transactions WHERE reference_type = 'sale' AND reference_id = ? AND type = 'sale'", [sale.id]);
    expect(recent(move.created_at)).toBe(true);
    expect(move.reason).toMatch(new RegExp(`sale of ${date}, recorded later`));
    expect(await stock(product.id)).toBe(4);

    const log = await db.queryOne("SELECT user_id, metadata FROM activity_logs WHERE action = 'sale.backdated' AND entity_id = ?", [sale.id]);
    expect(log.metadata).toMatchObject({ reason: 'Recorded in the paper book during a power cut' });
    // Listed and filterable as a sale recorded later.
    const list = (await inBranch('get', '/sales?source=backdated')).body.data;
    expect(list.map((s) => s.id)).toContain(sale.id);
  });

  test('the accountant may record previous sales by default', async () => {
    const accountant = await signIn(DEMO.accountant);
    const employee = await db.queryOne("SELECT e.id FROM employees e JOIN users u ON u.branch_id = e.branch_id WHERE u.email = ? AND e.status = 'active' LIMIT 1", [DEMO.accountant.email]);
    const res = await accountant.post('/sales', {
      items: [{ type: 'service', serviceId: svc.Kufumua, price: 3000, employeeIds: [employee.id], consumption: [] }],
      payments: [{ method: 'cash', amount: 3000 }], soldDate: threeDaysAgo(), backdateReason: 'Late entry',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ source: 'backdated', isBackdated: true });
  });
});

describe('voiding and re-dating sales', () => {
  let retail;
  let detangler;

  beforeAll(async () => {
    retail = (await inBranch('post', '/products', {
      name: 'Rules Oil', sku: 'RUL-OIL', unit: 'bottle', purchasePrice: 3000, sellingPrice: 7000, isRetail: true, openingStock: 10,
    })).body.data;
    detangler = await db.queryOne("SELECT id FROM products WHERE sku = 'RUL-DET'");
  });

  test('voiding a sale recorded by mistake undoes everything it did and keeps the record', async () => {
    const oilBefore = await stock(retail.id);
    const detanglerBefore = await stock(detangler.id);
    const res = await sell([
      line('Kufumua', 4000, [A, B], { consumption: [{ productId: detangler.id, quantity: 1 }] }),
      { type: 'product', productId: retail.id, quantity: 2 },
    ]);
    expect(res.status).toBe(201);
    const saleId = res.body.data.id;
    expect(await stock(retail.id)).toBe(oilBefore - 2);
    expect(await stock(detangler.id)).toBe(detanglerBefore - 1);
    const paidAt = (await db.queryOne('SELECT paid_at FROM payments WHERE sale_id = ?', [saleId])).paid_at;

    const receptionist = await signIn(DEMO.receptionist);
    expect((await receptionist.post(`/sales/${saleId}/void`, { reason: 'Entered twice' })).status).toBe(403);

    const voided = await inBranch('post', `/sales/${saleId}/void`, { reason: 'Entered twice' });
    expect(voided.status).toBe(200);
    expect(voided.body.data).toMatchObject({ status: 'voided', voidReason: 'Entered twice', voidedByName: 'Test Administrator' });
    expect(await stock(retail.id)).toBe(oilBefore);
    expect(await stock(detangler.id)).toBe(detanglerBefore);
    const commissions = await db.query('SELECT status FROM commissions WHERE sale_id = ?', [saleId]);
    expect(commissions.map((c) => c.status)).toEqual(['reversed', 'reversed']);
    // The payment is cancelled on the day it was received, so that day's takings are right.
    const reversal = await db.queryOne("SELECT amount, paid_at FROM payments WHERE sale_id = ? AND type = 'void'", [saleId]);
    expect(Number(reversal.amount)).toBe(-(4000 + 14000));
    expect(reversal.paid_at.getTime()).toBe(paidAt.getTime());
    const net = await db.queryOne('SELECT SUM(amount) AS total FROM payments WHERE sale_id = ?', [saleId]);
    expect(Number(net.total)).toBe(0);

    const log = await db.queryOne("SELECT old_values, new_values FROM activity_logs WHERE action = 'sale.voided' AND entity_id = ?", [saleId]);
    expect(log.old_values).toMatchObject({ status: 'completed' });
    expect(log.new_values).toMatchObject({ status: 'voided', reason: 'Entered twice' });

    expect((await inBranch('post', `/sales/${saleId}/void`, { reason: 'Again' })).status).toBe(409);
    expect((await inBranch('post', `/sales/${saleId}/refund`, { reason: 'Refund a voided sale' })).status).toBe(409);
  });

  test('a sale whose commission was already paid out cannot be voided', async () => {
    const res = await sell([line('Relaxer', 10000)]);
    await db.query("UPDATE commissions SET status = 'paid' WHERE sale_id = ?", [res.body.data.id]);
    const voided = await inBranch('post', `/sales/${res.body.data.id}/void`, { reason: 'Mistake' });
    expect(voided.status).toBe(409);
    expect(voided.body.message).toMatch(/already paid out/);
  });

  test('moving a sale to its correct date moves its payments, commission and breakdown with it', async () => {
    const res = await sell([line('Steaming', 10000)]);
    const saleId = res.body.data.id;
    const yesterday = DateTime.now().setZone(zone).minus({ days: 1 }).toISODate();

    const receptionist = await signIn(DEMO.receptionist);
    expect((await receptionist.patch(`/sales/${saleId}/date`, { soldDate: yesterday, reason: 'Wrong day' })).status).toBe(403);
    const future = await inBranch('patch', `/sales/${saleId}/date`, { soldDate: DateTime.now().setZone(zone).plus({ days: 2 }).toISODate(), reason: 'Wrong day' });
    expect(future.status).toBe(422);

    const before = await db.queryOne('SELECT sold_at, created_at FROM sales WHERE id = ?', [saleId]);
    const moved = await inBranch('patch', `/sales/${saleId}/date`, { soldDate: yesterday, soldTime: '09:15', reason: 'Entered on the wrong day' });
    expect(moved.status).toBe(200);
    const sale = await db.queryOne('SELECT sold_at, original_sold_at, created_at, updated_by FROM sales WHERE id = ?', [saleId]);
    expect(DateTime.fromJSDate(sale.sold_at).setZone(zone).toFormat('yyyy-MM-dd HH:mm')).toBe(`${yesterday} 09:15`);
    expect(sale.original_sold_at.getTime()).toBe(before.sold_at.getTime());
    expect(sale.created_at.getTime()).toBe(before.created_at.getTime());
    expect(sale.updated_by).toBeTruthy();
    expect((await db.queryOne('SELECT paid_at FROM payments WHERE sale_id = ?', [saleId])).paid_at.getTime()).toBe(sale.sold_at.getTime());
    expect((await db.queryOne('SELECT earned_at FROM commissions WHERE sale_id = ?', [saleId])).earned_at.getTime()).toBe(sale.sold_at.getTime());
    expect((await financeOf(saleId))[0].performed_at.getTime()).toBe(sale.sold_at.getTime());
    const log = await db.queryOne("SELECT old_values, new_values FROM activity_logs WHERE action = 'sale.date_changed' AND entity_id = ?", [saleId]);
    expect(new Date(log.old_values.soldAt).getTime()).toBe(before.sold_at.getTime());
    expect(new Date(log.new_values.soldAt).getTime()).toBe(sale.sold_at.getTime());
  });

  test('correcting a sale from a previous day needs the "change past sales" permission', async () => {
    const accountantRole = await db.queryOne("SELECT id FROM roles WHERE slug = 'accountant'");
    const correct = await db.queryOne("SELECT id FROM permissions WHERE code = 'sales.correct'");
    await db.query('INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [accountantRole.id, correct.id]);
    permissionService.clearCache();
    try {
      const accountant = await signIn(DEMO.accountant);
      const employee = await db.queryOne("SELECT e.id FROM employees e JOIN users u ON u.branch_id = e.branch_id WHERE u.email = ? AND e.status = 'active' LIMIT 1", [DEMO.accountant.email]);
      const body = (extra = {}) => ({
        items: [{ type: 'service', serviceId: svc.Kufumua, price: 4000, employeeIds: [employee.id], consumption: [] }], payments: [{ method: 'cash', amount: 4000 }], ...extra,
      });
      const old = (await accountant.post('/sales', body({ soldDate: DateTime.now().setZone(zone).minus({ days: 2 }).toISODate(), backdateReason: 'Late entry' }))).body.data;
      const denied = await accountant.patch(`/sales/${old.id}/items/${old.items[0].id}/costing`, { price: 5000, reason: 'Wrong price' });
      expect(denied.status).toBe(403);
      expect(denied.body.message).toMatch(/previous day/);
      const fresh = (await accountant.post('/sales', body())).body.data;
      const allowed = await accountant.patch(`/sales/${fresh.id}/items/${fresh.items[0].id}/costing`, { price: 5000, reason: 'Wrong price' });
      expect(allowed.status).toBe(200);
      const [f] = await financeOf(fresh.id);
      expect(split(f)).toEqual([1000, 4000, 0]);
    } finally {
      await db.query('DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?', [accountantRole.id, correct.id]);
      permissionService.clearCache();
    }
  });
});

describe('importing past sales through the same rules', () => {
  const header = ['Date', 'Time', 'Receipt no', 'Customer phone', 'Customer name', 'Type', 'Item', 'Staff', 'Quantity', 'Amount', 'Payment method', 'Notes'];
  const workbook = async (rows) => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Sales').addRows([header, ...rows]);
    return Buffer.from(await wb.xlsx.writeBuffer());
  };
  const upload = async (url, buffer, fields = {}) => {
    const req = request(await getApp()).post(`/api${url}`).set('Authorization', `Bearer ${admin.token}`).set('X-Branch-Id', String(branchId));
    for (const [k, v] of Object.entries(fields)) req.field(k, v);
    return req.attach('file', buffer, 'rules.xlsx');
  };

  test('each service is split with its own rule; rows the rules cannot settle are flagged, never booked as profit', async () => {
    const day = DateTime.now().setZone(zone).minus({ days: 20 }).toISODate();
    const file = await workbook([
      [day, '10:00', 'RUL-1', '', '', 'Service', 'Steaming', 'Amina Rules', 1, 15000, 'cash', ''],
      [day, '11:00', 'RUL-2', '', '', 'Service', 'Kufumua', 'Amina Rules & Bahati Rules', 1, 4000, 'cash', ''],
      [day, '12:00', 'RUL-3', '', '', 'Service', 'Steaming', 'Amina Rules', 1, 12000, 'cash', ''],
      [day, '13:00', 'RUL-4', '', '', 'Service', 'Kubana Nyuele', 'Amina Rules', 1, 30000, 'cash', ''],
      [day, '14:00', 'RUL-5', '', '', 'Service', 'Steaming', 'Amina Rules', 2, 20000, 'cash', ''],
    ]);
    const preview = await upload('/imports/sales/preview', file);
    expect(preview.status).toBe(200);
    const rows = Object.fromEntries(preview.body.data.rows.map((r) => [r.display.receipt, r]));
    expect(rows['RUL-1']).toMatchObject({ status: 'ready', display: { split: { method: 'band', operations: 6000, staffPool: 3000, salonProfit: 6000 } } });
    expect(rows['RUL-2'].display.split).toMatchObject({ operations: 1000, staffPool: 3000, salonProfit: 0 });
    expect(rows['RUL-3'].status).toBe('error');
    expect(rows['RUL-3'].messages[0]).toMatch(/^Financial rule: Steaming has no financial rule for 12,000/);
    expect(rows['RUL-4'].status).toBe('error');
    expect(rows['RUL-4'].messages[0]).toMatch(/Kubana Nyuele has no financial rule yet/);
    expect(rows['RUL-5'].messages[0]).toMatch(/own row/);
    expect(preview.body.data.summary).toMatchObject({ ready: 2, errors: 3, ruleProblems: 3 });

    const run = await upload('/imports/sales', file, { skipInvalid: 'true' });
    expect(run.status).toBe(201);
    const steaming = await db.queryOne("SELECT id, source, created_at FROM sales WHERE import_reference = 'RUL-1' AND branch_id = ?", [branchId]);
    expect(steaming.source).toBe('import');
    expect(recent(steaming.created_at)).toBe(true);
    const [f1] = await financeOf(steaming.id);
    expect(split(f1)).toEqual([6000, 3000, 6000]);
    expect(f1.calculation_method).toBe('band');
    const kufumua = await db.queryOne("SELECT id FROM sales WHERE import_reference = 'RUL-2' AND branch_id = ?", [branchId]);
    const [f2] = await financeOf(kufumua.id);
    expect(await shares(f2.sale_item_id)).toEqual([1500, 1500]);
    const commissions = await db.query('SELECT status FROM commissions WHERE sale_id = ?', [kufumua.id]);
    expect(commissions.map((c) => c.status)).toEqual(['paid', 'paid']);
    // Nothing was imported for the flagged rows.
    expect(await db.queryOne("SELECT id FROM sales WHERE import_reference IN ('RUL-3', 'RUL-4', 'RUL-5') AND branch_id = ?", [branchId])).toBeNull();

    // An imported sale entered by mistake can still be voided (its commission was settled outside the system).
    const voided = await inBranch('post', `/sales/${steaming.id}/void`, { reason: 'Imported twice' });
    expect(voided.status).toBe(200);
  });
});
