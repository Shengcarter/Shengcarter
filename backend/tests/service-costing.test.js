'use strict';

const { DateTime } = require('luxon');
const { signIn, getApp, db, request, DEMO, uniquePhone, nextWorkingDay } = require('./helpers');
const settings = require('../src/services/settingsService');
const branchService = require('../src/services/branchService');
const serviceFinance = require('../src/services/serviceFinanceService');

/**
 * Service costing end to end: the products a service actually uses are
 * costed at the recorded purchase cost and taken out of stock, and the money
 * is split price − products → 30% operations → 50% staff / 50% salon, stored
 * in full per service. Runs on its own branch so every figure is exact.
 */
describe('service costing', () => {
  let admin;
  let branchId;
  let stylistA;
  let stylistB;
  let hair; // Synthetic hair: pack, 5,000 each
  let jelly; // Jelly: stocked in 500 ml bottles at 10,000 → 20 per ml
  let braids; // Box Braids: 50,000 up to 80,000; recipe 3 packs + 100 ml
  let cut; // Haircut: 20,000, no recipe
  let customerId;
  let standardSale;
  let today;

  const inBranch = async (method, url, body, token = admin.token) => {
    const req = request(await getApp())[method](`/api${url}`).set('Authorization', `Bearer ${token}`).set('X-Branch-Id', String(branchId));
    return body === undefined ? req : req.send(body);
  };
  const stock = async (id) => Number((await db.queryOne('SELECT quantity FROM products WHERE id = ?', [id])).quantity);
  const finance = (saleItemId) => db.queryOne('SELECT * FROM sale_item_finance WHERE sale_item_id = ?', [saleItemId]);
  const money = (row) => ({
    price: Number(row.price), productCost: Number(row.product_cost), afterProducts: Number(row.amount_after_products),
    operations: Number(row.operations_amount), distributable: Number(row.distributable_amount), staffPool: Number(row.staff_pool), salonProfit: Number(row.salon_profit),
  });
  const sell = (items, extra = {}) => inBranch('post', '/sales', { customerId, items, payments: [{ method: 'cash', amount: 200000 }], ...extra });
  const braidsLine = (consumption, extra = {}) => ({ type: 'service', serviceId: braids, employeeIds: [stylistA], consumption, ...extra });

  beforeAll(async () => {
    admin = await signIn();
    await settings.load();
    today = DateTime.now().setZone(settings.get('system.timezone')).toISODate();
    branchId = (await db.query("INSERT INTO branches (code, name) VALUES ('COSTING', 'Costing test branch')")).insertId;
    branchService.clearCache();
    const employee = async (code, name) => (await db.query(
      "INSERT INTO employees (code, branch_id, full_name, job_title, commission_rate) VALUES (?, ?, ?, 'Stylist', 40)", [code, branchId, name],
    )).insertId;
    stylistA = await employee('EMP-COST1', 'Salma Costing');
    stylistB = await employee('EMP-COST2', 'Mwajuma Costing');

    const product = async (body) => (await inBranch('post', '/products', { sellingPrice: 0, isRetail: false, ...body })).body.data;
    hair = await product({ name: 'Synthetic Hair Type A', sku: 'CST-HAIR', unit: 'pack', purchasePrice: 5000, openingStock: 40 });
    jelly = await product({ name: 'Braiding Jelly', sku: 'CST-JELLY', unit: 'bottle', usageUnit: 'ml', usagePerUnit: 500, purchasePrice: 10000, openingStock: 3 });
    expect(hair.id).toBeTruthy();
    expect(jelly).toMatchObject({ usageUnit: 'ml', usagePerUnit: 500 });

    const category = (await db.queryOne('SELECT id FROM service_categories ORDER BY id LIMIT 1')).id;
    const created = await inBranch('post', '/services', {
      categoryId: category, name: 'Costing Box Braids', price: 50000, maxPrice: 80000, durationMinutes: 240,
      recipe: [{ productId: hair.id, quantity: 3 }, { productId: jelly.id, quantity: 100 }],
    });
    expect(created.status).toBe(201);
    braids = created.body.data.id;
    cut = (await inBranch('post', '/services', { categoryId: category, name: 'Costing Haircut', price: 20000, durationMinutes: 30 })).body.data.id;
    customerId = (await admin.post('/customers', { fullName: 'Costing Customer', phone: uniquePhone() })).body.data.id;
  });

  test('a service keeps its recipe: expected products, units and cost per unit', async () => {
    const service = (await inBranch('get', `/services/${braids}`)).body.data;
    expect(service.maxPrice).toBe(80000);
    expect(service.recipe).toEqual([
      expect.objectContaining({ productId: jelly.id, name: 'Braiding Jelly', unit: 'ml', quantity: 100, unitCost: 20, cost: 2000 }),
      expect.objectContaining({ productId: hair.id, unit: 'pack', quantity: 3, unitCost: 5000, cost: 15000 }),
    ]);
    expect(service.expectedProductCost).toBe(17000);
    const usable = (await inBranch('get', '/products/usable')).body.data;
    expect(usable.find((p) => p.id === jelly.id)).toMatchObject({ unit: 'ml', stockUnit: 'bottle', perStockUnit: 500, inStock: 1500, unitCost: 20 });
  });

  test('a service with a recipe cannot be billed until the products used are confirmed', async () => {
    const res = await sell([{ type: 'service', serviceId: braids, employeeIds: [stylistA] }]);
    expect(res.status).toBe(422);
    expect(res.body.errors[0]).toMatchObject({ field: 'items.0.consumption', message: expect.stringMatching(/Confirm the products used for Costing Box Braids/) });
    // A service without a recipe needs nothing extra.
    expect((await sell([{ type: 'service', serviceId: cut, employeeIds: [stylistA] }])).status).toBe(201);
  });

  test('Box Braids 50,000 with 2 packs and 100 ml: 12,000 products, 11,400 operations, 13,300 stylist, 13,300 salon', async () => {
    const [hairBefore, jellyBefore] = [await stock(hair.id), await stock(jelly.id)];
    const res = await sell([braidsLine([{ productId: hair.id, quantity: 2 }, { productId: jelly.id, quantity: 100 }])]);
    expect(res.status).toBe(201);
    standardSale = res.body.data;
    const [line] = standardSale.items;

    const row = await finance(line.id);
    expect(money(row)).toEqual({ price: 50000, productCost: 12000, afterProducts: 38000, operations: 11400, distributable: 26600, staffPool: 13300, salonProfit: 13300 });
    expect(row).toMatchObject({ operations_rate: 30, staff_rate: 50, profit_rate: 50, staff_count: 1, split_rule: 'equal', margin_status: 'positive', review_status: 'not_needed', service_id: braids, sale_id: standardSale.id, branch_id: branchId });
    // 12,000 + 11,400 + 13,300 + 13,300 = 50,000
    expect(12000 + 11400 + 13300 + 13300).toBe(50000);

    // Each product used, at the cost when it was used.
    const used = await db.query('SELECT product_id, unit, quantity, stock_quantity, unit_cost, total_cost FROM sale_item_products WHERE sale_item_id = ? ORDER BY product_id', [line.id]);
    expect(used.map((u) => [u.product_id, u.unit, Number(u.quantity), Number(u.stock_quantity), Number(u.unit_cost), Number(u.total_cost)])).toEqual([
      [hair.id, 'pack', 2, 2, 5000, 10000],
      [jelly.id, 'ml', 100, 0.2, 20, 2000],
    ]);

    // Stock: 2 packs and 0.2 of a bottle (100 ml of 500 ml) out, in the ledger.
    expect(await stock(hair.id)).toBe(hairBefore - 2);
    expect(await stock(jelly.id)).toBeCloseTo(jellyBefore - 0.2, 3);
    const ledger = await db.query("SELECT product_id, quantity_change FROM inventory_transactions WHERE type = 'service_use' AND reference_id = ? ORDER BY product_id", [standardSale.id]);
    expect(ledger.map((l) => [l.product_id, Number(l.quantity_change)])).toEqual([[hair.id, -2], [jelly.id, -0.2]]);

    // The stylist's commission is the staff pool; cost of goods includes the products used.
    const commission = await db.queryOne('SELECT employee_id, amount, rate FROM commissions WHERE sale_item_id = ?', [line.id]);
    expect([commission.employee_id, Number(commission.amount), Number(commission.rate)]).toEqual([stylistA, 13300, 50]);
    expect(Number((await db.queryOne('SELECT cost_of_goods FROM sales WHERE id = ?', [standardSale.id])).cost_of_goods)).toBe(12000);

    // The sale shows the breakdown to people who see costs.
    expect(line.costing).toMatchObject({ price: 50000, productCost: 12000, operations: 11400, staffPool: 13300, salonProfit: 13300, marginStatus: 'positive' });
    expect(line.productsUsed).toEqual([
      expect.objectContaining({ name: 'Synthetic Hair Type A', unit: 'pack', quantity: 2, unitCost: 5000, cost: 10000 }),
      expect.objectContaining({ name: 'Braiding Jelly', unit: 'ml', quantity: 100, unitCost: 20, cost: 2000 }),
    ]);
  });

  test('two stylists share the 13,300 pool: 6,650 each; salon profit stays 13,300', async () => {
    const res = await sell([braidsLine([{ productId: hair.id, quantity: 2 }, { productId: jelly.id, quantity: 100 }], { employeeIds: [stylistA, stylistB] })]);
    expect(res.status).toBe(201);
    const [line] = res.body.data.items;
    expect(money(await finance(line.id))).toMatchObject({ staffPool: 13300, salonProfit: 13300 });
    expect(line.staff.map((s) => [s.id, s.commissionAmount])).toEqual([[stylistA, 6650], [stylistB, 6650]]);
    const commissions = await db.query('SELECT employee_id, amount FROM commissions WHERE sale_item_id = ? ORDER BY employee_id', [line.id]);
    expect(commissions.map((c) => Number(c.amount))).toEqual([6650, 6650]);
  });

  test('a price chosen within the range: 80,000 with 20,000 of products', async () => {
    const res = await sell([braidsLine([{ productId: hair.id, quantity: 4 }], { price: 80000 })]);
    expect(res.status).toBe(201);
    expect(money(await finance(res.body.data.items[0].id))).toEqual({
      price: 80000, productCost: 20000, afterProducts: 60000, operations: 18000, distributable: 42000, staffPool: 21000, salonProfit: 21000,
    });
    const outside = await sell([braidsLine([], { price: 90000 })]);
    expect(outside.status).toBe(422);
    expect(outside.body.errors[0].message).toMatch(/between 50,000 and 80,000/);
  });

  test('no products used: 15,000 operations, 17,500 stylist, 17,500 salon', async () => {
    const res = await sell([braidsLine([])]);
    expect(money(await finance(res.body.data.items[0].id))).toMatchObject({ productCost: 0, operations: 15000, staffPool: 17500, salonProfit: 17500 });
  });

  test('the quote previews the split for managers; others only see products and a margin warning', async () => {
    const items = [braidsLine([{ productId: hair.id, quantity: 2 }, { productId: jelly.id, quantity: 100 }])];
    const q = (await inBranch('post', '/sales/quote', { items })).body.data.lines[0];
    expect(q.split).toMatchObject({ price: 50000, productCost: 12000, operations: 11400, staffPool: 13300, salonProfit: 13300, staffShares: [13300] });
    expect(q.marginStatus).toBe('positive');
    expect(q.priceRange).toEqual({ min: 50000, max: 80000 });

    const reception = await signIn(DEMO.receptionist);
    const main = await db.queryOne("SELECT id FROM products WHERE sku = 'TA-CMB-001'"); // a 1,500 comb
    const service = await db.queryOne("SELECT id FROM services WHERE name = 'Haircut'");
    const employee = await db.queryOne("SELECT id FROM employees WHERE code = 'EMP-0001'");
    const r = (await reception.post('/sales/quote', { items: [{ type: 'service', serviceId: service.id, employeeIds: [employee.id], consumption: [{ productId: main.id, quantity: 1 }] }] })).body.data.lines[0];
    expect(r.split).toBeUndefined();
    expect(r.productsUsed[0]).not.toHaveProperty('cost');
    expect(r.marginStatus).toBe('positive');
  });

  test('products costing as much as the price: all zero, flagged zero-margin for review', async () => {
    const res = await sell([braidsLine([{ productId: hair.id, quantity: 10 }])]);
    const [line] = res.body.data.items;
    expect(money(await finance(line.id))).toEqual({ price: 50000, productCost: 50000, afterProducts: 0, operations: 0, distributable: 0, staffPool: 0, salonProfit: 0 });
    expect(await finance(line.id)).toMatchObject({ margin_status: 'zero', review_status: 'pending' });
    expect(await db.query('SELECT id FROM commissions WHERE sale_item_id = ?', [line.id])).toHaveLength(0);
  });

  let negativeSale;
  test('products costing more than the price: flagged negative, no negative pay, the loss shown and reviewed', async () => {
    const res = await sell([braidsLine([{ productId: hair.id, quantity: 11 }], { employeeIds: [stylistA, stylistB] })]);
    negativeSale = res.body.data;
    const [line] = negativeSale.items;
    expect(money(await finance(line.id))).toEqual({ price: 50000, productCost: 55000, afterProducts: -5000, operations: 0, distributable: 0, staffPool: 0, salonProfit: -5000 });
    expect(await finance(line.id)).toMatchObject({ margin_status: 'negative', review_status: 'pending' });
    expect(line.staff.map((s) => s.commissionAmount)).toEqual([0, 0]);
    expect(await db.query('SELECT id FROM commissions WHERE sale_item_id = ?', [line.id])).toHaveLength(0);

    // Only people allowed to correct sales review it, with a note.
    const reception = await signIn(DEMO.receptionist);
    expect((await reception.post(`/sales/${negativeSale.id}/items/${line.id}/costing/review`, { note: 'ok' })).status).toBe(403);
    expect((await inBranch('post', `/sales/${negativeSale.id}/items/${line.id}/costing/review`, { note: '' })).status).toBe(422);
    const reviewed = await inBranch('post', `/sales/${negativeSale.id}/items/${line.id}/costing/review`, { note: 'Extra-long braids; price agreed with the owner' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.data.items[0].costing).toMatchObject({ reviewStatus: 'reviewed', reviewNote: 'Extra-long braids; price agreed with the owner', reviewedBy: expect.any(String) });
    expect((await inBranch('post', `/sales/${negativeSale.id}/items/${line.id}/costing/review`, { note: 'again' })).status).toBe(400);
  });

  test('not enough stock: the sale is refused and nothing changes', async () => {
    const [salesBefore, jellyBefore] = [(await db.queryOne('SELECT COUNT(*) AS n FROM sales WHERE branch_id = ?', [branchId])).n, await stock(jelly.id)];
    const res = await sell([braidsLine([{ productId: jelly.id, quantity: 5000 }])]); // 10 bottles
    expect(res.status).toBe(422);
    expect(res.body.errors[0].message).toMatch(/Not enough Braiding Jelly in stock/);
    expect((await db.queryOne('SELECT COUNT(*) AS n FROM sales WHERE branch_id = ?', [branchId])).n).toBe(salesBefore);
    expect(await stock(jelly.id)).toBe(jellyBefore);
  });

  test('a failure half-way through saving rolls the whole sale back: no stock moved, no breakdown, no commission', async () => {
    const [salesBefore, hairBefore, rowsBefore] = [
      (await db.queryOne('SELECT COUNT(*) AS n FROM sales WHERE branch_id = ?', [branchId])).n,
      await stock(hair.id),
      (await db.queryOne('SELECT COUNT(*) AS n FROM sale_item_finance WHERE branch_id = ?', [branchId])).n,
    ];
    const original = serviceFinance.recordLine;
    let calls = 0;
    const spy = jest.spyOn(serviceFinance, 'recordLine').mockImplementation(async (...args) => {
      calls += 1;
      if (calls === 2) throw new Error('Simulated failure while saving the second service');
      return original(...args);
    });
    try {
      const res = await sell([braidsLine([{ productId: hair.id, quantity: 2 }]), braidsLine([{ productId: hair.id, quantity: 3 }])]);
      expect(res.status).toBe(500);
    } finally {
      spy.mockRestore();
    }
    expect(calls).toBe(2);
    expect((await db.queryOne('SELECT COUNT(*) AS n FROM sales WHERE branch_id = ?', [branchId])).n).toBe(salesBefore);
    expect(await stock(hair.id)).toBe(hairBefore);
    expect((await db.queryOne('SELECT COUNT(*) AS n FROM sale_item_finance WHERE branch_id = ?', [branchId])).n).toBe(rowsBefore);
  });

  test('negative quantities, unknown products and bad prices are refused', async () => {
    expect((await sell([braidsLine([{ productId: hair.id, quantity: -1 }])])).status).toBe(422);
    expect((await sell([braidsLine([{ productId: hair.id, quantity: 0 }])])).status).toBe(422);
    const otherBranchProduct = await db.queryOne('SELECT id FROM products WHERE branch_id <> ? ORDER BY id LIMIT 1', [branchId]);
    const res = await sell([braidsLine([{ productId: otherBranchProduct.id, quantity: 1 }])]);
    expect(res.status).toBe(422);
    expect(res.body.errors[0].message).toBe('Product not found in this branch');
    expect((await inBranch('post', '/services', { categoryId: 1, name: 'Bad Range', price: 50000, maxPrice: 40000, durationMinutes: 30 })).status).toBe(422);
  });

  test('the rules come from settings: changes apply to new services only, and must add up', async () => {
    const stylist = await signIn(DEMO.stylist);
    expect((await stylist.put('/settings/financial', { operations_percentage: 10 })).status).toBe(403);
    const bad = await admin.put('/settings/financial', { staff_pool_percentage: 60 });
    expect(bad.status).toBe(422);
    expect(bad.body.errors[0].message).toMatch(/add up to 100%/);

    expect((await admin.put('/settings/financial', { operations_percentage: 25, staff_pool_percentage: 40, salon_profit_percentage: 60 })).status).toBe(200);
    try {
      const res = await sell([braidsLine([{ productId: hair.id, quantity: 2 }, { productId: jelly.id, quantity: 100 }])]);
      const row = await finance(res.body.data.items[0].id);
      expect(money(row)).toMatchObject({ operations: 9500, staffPool: 11400, salonProfit: 17100 });
      expect(row).toMatchObject({ operations_rate: 25, staff_rate: 40, profit_rate: 60 });
      // The earlier sale keeps the figures and percentages it was sold with.
      expect(money(await finance(standardSale.items[0].id))).toMatchObject({ operations: 11400, staffPool: 13300, salonProfit: 13300 });
    } finally {
      await admin.put('/settings/financial', { operations_percentage: 30, staff_pool_percentage: 50, salon_profit_percentage: 50 });
    }
  });

  test('correcting the products used recalculates, moves stock and keeps the before and after', async () => {
    const line = standardSale.items[0];
    const hairBefore = await stock(hair.id);
    const reception = await signIn(DEMO.receptionist);
    expect((await reception.patch(`/sales/${standardSale.id}/items/${line.id}/costing`, { consumption: [], reason: 'x' })).status).toBe(403);
    expect((await inBranch('patch', `/sales/${standardSale.id}/items/${line.id}/costing`, { consumption: [{ productId: hair.id, quantity: 3 }] })).status).toBe(422);

    const res = await inBranch('patch', `/sales/${standardSale.id}/items/${line.id}/costing`, {
      consumption: [{ productId: hair.id, quantity: 3 }, { productId: jelly.id, quantity: 100 }],
      reason: 'Stylist used a third pack',
    });
    expect(res.status).toBe(200);
    // 50,000 − 17,000 = 33,000 → 9,900 operations → 23,100 → 11,550 / 11,550
    expect(money(await finance(line.id))).toEqual({ price: 50000, productCost: 17000, afterProducts: 33000, operations: 9900, distributable: 23100, staffPool: 11550, salonProfit: 11550 });
    expect(await stock(hair.id)).toBe(hairBefore - 1);
    expect(Number((await db.queryOne('SELECT amount FROM commissions WHERE sale_item_id = ?', [line.id])).amount)).toBe(11550);
    expect(Number((await db.queryOne('SELECT cost_of_goods FROM sales WHERE id = ?', [standardSale.id])).cost_of_goods)).toBe(17000);

    const costing = res.body.data.items[0].costing;
    expect(costing.revision).toBe(1);
    expect(costing.revisions[0]).toMatchObject({
      revision: 1, reason: 'Stylist used a third pack', changedBy: expect.any(String),
      before: expect.objectContaining({ productCost: 12000, staffPool: 13300 }),
      after: expect.objectContaining({ productCost: 17000, staffPool: 11550 }),
    });
    const log = await db.queryOne("SELECT description FROM activity_logs WHERE action = 'sale.service_corrected' AND entity_id = ? ORDER BY id DESC LIMIT 1", [standardSale.id]);
    expect(log.description).toMatch(/Stylist used a third pack/);

    // A corrected unit cost is used as given.
    await inBranch('patch', `/sales/${standardSale.id}/items/${line.id}/costing`, {
      consumption: [{ productId: hair.id, quantity: 3, unitCost: 4000 }, { productId: jelly.id, quantity: 100 }], reason: 'Supplier invoice was 4,000 a pack',
    });
    expect(money(await finance(line.id)).productCost).toBe(14000);
    expect(await stock(hair.id)).toBe(hairBefore - 1);
  });

  test('correcting the staff moves the commission; correcting the price re-totals the sale', async () => {
    const res = await inBranch('post', '/sales', {
      customerId, items: [braidsLine([{ productId: hair.id, quantity: 2 }, { productId: jelly.id, quantity: 100 }])], payments: [{ method: 'cash', amount: 20000 }],
    });
    expect(res.status).toBe(201);
    const sale = res.body.data;
    const line = sale.items[0];
    expect(sale.balanceDue).toBe(30000);

    const staff = await inBranch('patch', `/sales/${sale.id}/items/${line.id}/costing`, { employeeIds: [stylistB], reason: 'Mwajuma did it' });
    expect(staff.status).toBe(200);
    expect((await db.query('SELECT employee_id, amount FROM commissions WHERE sale_item_id = ?', [line.id])).map((c) => [c.employee_id, Number(c.amount)])).toEqual([[stylistB, 13300]]);

    const lower = await inBranch('patch', `/sales/${sale.id}/items/${line.id}/costing`, { price: 10000, reason: 'Too low' });
    expect(lower.status).toBe(400);
    expect(lower.body.message).toMatch(/already paid/);

    const priced = await inBranch('patch', `/sales/${sale.id}/items/${line.id}/costing`, { price: 60000, reason: 'Longer braids than booked' });
    expect(priced.status).toBe(200);
    expect(priced.body.data).toMatchObject({ total: 60000, balanceDue: 40000, paymentStatus: 'partial' });
    expect(money(await finance(line.id))).toMatchObject({ price: 60000, productCost: 12000, operations: 14400, staffPool: 16800, salonProfit: 16800 });
  });

  test('once a commission is paid out, the service can no longer be corrected', async () => {
    const res = await sell([braidsLine([{ productId: hair.id, quantity: 1 }], { employeeIds: [stylistA] })]);
    const sale = res.body.data;
    const generated = await inBranch('post', '/payroll/payouts/generate', { periodStart: today, periodEnd: today, employeeIds: [stylistA] });
    expect(generated.status).toBe(200);
    const payout = await db.queryOne("SELECT id FROM salary_records WHERE employee_id = ? AND status = 'pending'", [stylistA]);

    // While the payout is pending, a correction updates it.
    const before = Number((await db.queryOne('SELECT commission_amount FROM salary_records WHERE id = ?', [payout.id])).commission_amount);
    await inBranch('patch', `/sales/${sale.id}/items/${sale.items[0].id}/costing`, { consumption: [{ productId: hair.id, quantity: 2 }], reason: 'Two packs' });
    // 45,000 → 40,000 after products: the pool drops from 15,750 to 14,000.
    expect(Number((await db.queryOne('SELECT commission_amount FROM salary_records WHERE id = ?', [payout.id])).commission_amount)).toBe(before - 1750);

    expect((await inBranch('post', `/payroll/payouts/${payout.id}/pay`, { paymentMethod: 'cash', paidDate: today })).status).toBe(200);
    const blocked = await inBranch('patch', `/sales/${sale.id}/items/${sale.items[0].id}/costing`, { consumption: [], reason: 'None used' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/already paid out/);
  });

  test('a refund reverses the staff pay; products used stay used', async () => {
    const res = await sell([braidsLine([{ productId: hair.id, quantity: 2 }])]);
    const hairAfterSale = await stock(hair.id);
    expect((await inBranch('post', `/sales/${res.body.data.id}/refund`, { reason: 'Customer unhappy' })).status).toBe(200);
    expect(await stock(hair.id)).toBe(hairAfterSale);
    const rows = await db.query('SELECT status FROM commissions WHERE sale_id = ?', [res.body.data.id]);
    expect(rows.every((r) => r.status === 'reversed')).toBe(true);
    expect((await inBranch('patch', `/sales/${res.body.data.id}/items/${res.body.data.items[0].id}/costing`, { consumption: [], reason: 'x' })).status).toBe(400);
  });

  test('stylists record the products they used on their appointment; checkout starts from it', async () => {
    // The demo stylist's own appointment in the main branch.
    const stylist = await signIn(DEMO.stylist);
    const neema = await db.queryOne("SELECT id, branch_id FROM employees WHERE code = 'EMP-0001'");
    const service = await db.queryOne("SELECT s.id FROM services s JOIN employee_services es ON es.service_id = s.id WHERE es.employee_id = ? AND s.name = 'Braiding'", [neema.id]);
    const product = await db.queryOne("SELECT id, name FROM products WHERE branch_id = ? AND sku = 'HX-BRD-001'", [neema.branch_id]);
    // Far enough ahead to be clear of other tests' bookings; the first free slot that day.
    const day = await nextWorkingDay(neema.id, 30);
    const slots = (await admin.get(`/appointments/availability?date=${day.date}&employeeId=${neema.id}&serviceIds=${service.id}`)).body.data;
    const slot = slots.slots.find((x) => x.available);
    const startTime = DateTime.fromISO(slot.start).setZone(settings.get('system.timezone')).toFormat("yyyy-MM-dd'T'HH:mm");
    const booked = await admin.post('/appointments', { customerId, employeeIds: [neema.id], serviceIds: [service.id], startTime });
    expect(booked.status).toBe(201);
    const appointment = booked.body.data;

    const saved = await stylist.put(`/appointments/${appointment.id}/products`, { services: [{ serviceId: service.id, products: [{ productId: product.id, quantity: 4 }] }] });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual([expect.objectContaining({ serviceId: service.id, source: 'recorded', products: [expect.objectContaining({ productId: product.id, quantity: 4, unit: 'pack' })] })]);
    const checkout = (await admin.get(`/sales/appointment/${appointment.id}`)).body.data;
    expect(checkout.usage[0]).toMatchObject({ source: 'recorded', recordedBy: 'Neema Mwakyusa', products: [expect.objectContaining({ productId: product.id, quantity: 4 })] });

    // Stock only moves when the service is billed.
    expect(Number((await db.queryOne('SELECT COUNT(*) AS n FROM inventory_transactions WHERE product_id = ? AND type = ?', [product.id, 'service_use'])).n)).toBe(0);

    // Not on someone else's appointment, and a service not on the appointment is refused.
    const other = await db.queryOne("SELECT a.id FROM appointments a WHERE a.branch_id = ? AND NOT EXISTS (SELECT 1 FROM appointment_staff s WHERE s.appointment_id = a.id AND s.employee_id = ?) AND a.status IN ('pending','confirmed') LIMIT 1", [neema.branch_id, neema.id]);
    if (other) expect((await stylist.put(`/appointments/${other.id}/products`, { services: [{ serviceId: service.id, products: [] }] })).status).toBe(404);
    const wrongService = await db.queryOne('SELECT id FROM services WHERE id <> ? ORDER BY id LIMIT 1', [service.id]);
    expect((await stylist.put(`/appointments/${appointment.id}/products`, { services: [{ serviceId: wrongService.id, products: [] }] })).status).toBe(422);
    // Stylists cannot correct completed sales.
    expect((await stylist.patch(`/sales/${standardSale.id}/items/${standardSale.items[0].id}/costing`, { consumption: [], reason: 'x' })).status).toBe(403);
  });
  test('reports: by day, stylist, service and product, the flagged list, the dashboard and exports', async () => {
    const rows = await db.query(
      `SELECT f.* FROM sale_item_finance f JOIN sales s ON s.id = f.sale_id WHERE f.branch_id = ? AND s.status = 'completed'`, [branchId],
    );
    const total = (key) => rows.reduce((sum, r) => sum + Number(r[key]), 0);
    const report = await inBranch('get', `/reports/costing?from=${today}&to=${today}&groupBy=day`);
    expect(report.status).toBe(200);
    const r = report.body.data;
    expect(r.summary).toMatchObject({
      services: rows.length, sales: total('price'), productCost: total('product_cost'), operations: total('operations_amount'),
      staffEarnings: total('staff_pool'), salonProfit: total('salon_profit'),
    });
    // Every shilling is accounted for.
    expect(r.summary.productCost + r.summary.operations + r.summary.staffEarnings + r.summary.salonProfit).toBe(r.summary.sales);
    expect(r.series).toHaveLength(1);
    expect(r.series[0]).toMatchObject({ period: today, services: rows.length, sales: total('price') });

    const box = r.services.find((x) => x.id === braids);
    expect(box.count).toBe(rows.filter((x) => x.service_id === braids).length);
    const salma = r.staff.find((x) => x.id === stylistA);
    const salmaPay = await db.queryOne(
      `SELECT SUM(sis.commission_amount) AS pay FROM sale_item_staff sis JOIN sale_item_finance f ON f.sale_item_id = sis.sale_item_id JOIN sales s ON s.id = f.sale_id
       WHERE sis.employee_id = ? AND s.status = 'completed'`, [stylistA],
    );
    expect(salma.earnings).toBe(Number(salmaPay.pay));
    expect(salma.averageEarnings).toBeCloseTo(salma.earnings / salma.services, 2);
    const hairRow = r.products.find((x) => x.id === hair.id);
    expect(hairRow).toMatchObject({ unit: 'pack', services: 'Costing Box Braids' });
    expect(r.products.find((x) => x.id === jelly.id)).toMatchObject({ unit: 'ml' });
    expect(r.flagged.map((f) => f.marginStatus).sort()).toEqual(['negative', 'zero']);
    expect(r.summary.flagged).toEqual({ zero: 1, negative: 1, pending: 1 });

    // Weekly and monthly grouping give the same totals.
    for (const groupBy of ['week', 'month']) {
      const g = (await inBranch('get', `/reports/costing?from=${today}&to=${today}&groupBy=${groupBy}`)).body.data;
      expect(g.series.reduce((sum, p) => sum + p.salonProfit, 0)).toBe(r.summary.salonProfit);
    }

    const dash = (await inBranch('get', '/dashboard')).body.data.serviceCosting;
    expect(dash).toMatchObject({ services: rows.length, salonProfit: total('salon_profit') });
    expect(dash.topServices[0].name).toBe('Costing Box Braids');
    expect(dash.topStaff.length).toBeGreaterThan(0);
    expect(dash.topProducts[0].name).toBe('Synthetic Hair Type A');

    // Staff reports stay available to managers only.
    const stylist = await signIn(DEMO.stylist);
    expect((await stylist.get('/reports/costing')).status).toBe(403);
    expect((await signIn(DEMO.stylist).then((c) => c.get('/dashboard'))).body.data.serviceCosting).toBeUndefined();

    for (const format of ['pdf', 'xlsx', 'csv']) {
      const file = await request(await getApp()).get(`/api/reports/costing/export?from=${today}&to=${today}&format=${format}`)
        .set('Authorization', `Bearer ${admin.token}`).set('X-Branch-Id', String(branchId));
      expect(file.status).toBe(200);
    }
  });
});
