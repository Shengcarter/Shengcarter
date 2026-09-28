'use strict';

const { signIn, uniquePhone, db } = require('./helpers');

async function pick() {
  const service = await db.queryOne(
    `SELECT s.id, s.price, es.employee_id, e.commission_rate AS employee_rate, s.commission_rate AS service_rate
     FROM services s JOIN employee_services es ON es.service_id = s.id JOIN employees e ON e.id = es.employee_id
     WHERE s.is_active = 1 AND e.status = 'active' ORDER BY s.id LIMIT 1`,
  );
  const product = await db.queryOne("SELECT id, selling_price, purchase_price, quantity FROM products WHERE is_retail = 1 AND status = 'active' AND quantity >= 5 ORDER BY id LIMIT 1");
  return { service, product };
}

describe('POS transactions', () => {
  let admin;
  let customerId;
  let tax;

  beforeAll(async () => {
    admin = await signIn();
    customerId = (await admin.post('/customers', { fullName: 'POS Customer', phone: uniquePhone() })).body.data.id;
    const settings = await admin.get('/settings');
    tax = { mode: settings.body.data.financial.tax_mode, rate: Number(settings.body.data.financial.tax_rate) };
  });

  test('completes a sale with server-calculated totals, stock, commission and loyalty', async () => {
    const { service, product } = await pick();
    const items = [
      { type: 'service', serviceId: service.id, employeeId: service.employee_id },
      { type: 'product', productId: product.id, quantity: 2 },
    ];
    const quote = await admin.post('/sales/quote', { customerId, items, discount: { type: 'percentage', value: 10 } });
    expect(quote.status).toBe(200);
    const q = quote.body.data;

    const subtotal = Number(service.price) + Number(product.selling_price) * 2;
    expect(q.subtotal).toBe(subtotal);
    expect(q.discountAmount).toBe(Math.round(subtotal * 0.1));
    if (tax.mode === 'exclusive') expect(q.total).toBe(Math.round((subtotal - q.discountAmount) * (1 + tax.rate / 100)));

    const tendered = Math.ceil(q.total / 10000) * 10000 + 10000;
    const res = await admin.post('/sales', { customerId, items, discount: { type: 'percentage', value: 10 }, payments: [{ method: 'cash', amount: tendered }] });
    expect(res.status).toBe(201);
    const sale = res.body.data;
    expect(sale.total).toBe(q.total);
    expect(sale.changeDue).toBe(tendered - q.total);
    expect(sale.paymentStatus).toBe('paid');
    expect(sale.invoiceNumber).toMatch(/^INV-\d{6}$/);

    const after = await db.queryOne('SELECT quantity FROM products WHERE id = ?', [product.id]);
    expect(after.quantity).toBe(product.quantity - 2);
    const ledger = await db.queryOne("SELECT quantity_change FROM inventory_transactions WHERE reference_type = 'sale' AND reference_id = ?", [sale.id]);
    expect(ledger.quantity_change).toBe(-2);

    const commission = await db.queryOne('SELECT amount, base_amount FROM commissions WHERE sale_id = ?', [sale.id]);
    const rate = Number(service.service_rate ?? service.employee_rate);
    expect(Number(commission.amount)).toBe(Math.round((Number(commission.base_amount) * rate) / 100));

    const customer = await db.queryOne('SELECT loyalty_points, visit_count, total_spent FROM customers WHERE id = ?', [customerId]);
    expect(customer.visit_count).toBe(1);
    expect(Number(customer.total_spent)).toBe(sale.total);
    expect(customer.loyalty_points).toBe(sale.loyaltyPointsEarned);
  });

  test('prices sent by the browser are ignored', async () => {
    const { service } = await pick();
    const res = await admin.post('/sales', {
      items: [{ type: 'service', serviceId: service.id, employeeId: service.employee_id, unitPrice: 1, price: 1 }],
      payments: [{ method: 'cash', amount: 99999999 }],
      total: 1,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.subtotal).toBe(Number(service.price));
  });

  test('a failed sale changes nothing (transaction rollback)', async () => {
    const { product } = await pick();
    const before = await db.queryOne('SELECT quantity FROM products WHERE id = ?', [product.id]);
    const seq = await db.queryOne("SELECT current_value FROM sequences WHERE name = 'invoice'");
    const res = await admin.post('/sales', { items: [{ type: 'product', productId: product.id, quantity: before.quantity + 1 }], payments: [{ method: 'cash', amount: 99999999 }] });
    expect(res.status).toBe(422);
    expect((await db.queryOne('SELECT quantity FROM products WHERE id = ?', [product.id])).quantity).toBe(before.quantity);
    expect((await db.queryOne("SELECT current_value FROM sequences WHERE name = 'invoice'")).current_value).toBe(seq.current_value);
  });

  test('payment rules: no change from cards, walk-ins pay in full', async () => {
    const { service } = await pick();
    const items = [{ type: 'service', serviceId: service.id, employeeId: service.employee_id }];
    const card = await admin.post('/sales', { items, payments: [{ method: 'card', amount: Number(service.price) * 3 }] });
    expect(card.status).toBe(422);
    const walkInPartial = await admin.post('/sales', { items, payments: [{ method: 'cash', amount: 1000 }] });
    expect(walkInPartial.status).toBe(422);
  });

  test('partial payment leaves a balance that can be settled later', async () => {
    const { service } = await pick();
    const items = [{ type: 'service', serviceId: service.id, employeeId: service.employee_id }];
    const res = await admin.post('/sales', { customerId, items, payments: [{ method: 'mobile_money', amount: 1000, reference: 'MP-TEST' }] });
    expect(res.status).toBe(201);
    expect(res.body.data.paymentStatus).toBe('partial');
    const balance = res.body.data.balanceDue;
    const settle = await admin.post(`/sales/${res.body.data.id}/payments`, { method: 'cash', amount: balance });
    expect(settle.status).toBe(200);
    expect(settle.body.data.paymentStatus).toBe('paid');
    expect(settle.body.data.balanceDue).toBe(0);
  });

  test('refund restores stock, reverses commission and customer statistics', async () => {
    const { service, product } = await pick();
    const items = [{ type: 'service', serviceId: service.id, employeeId: service.employee_id }, { type: 'product', productId: product.id, quantity: 1 }];
    const q = (await admin.post('/sales/quote', { customerId, items })).body.data;
    const sale = (await admin.post('/sales', { customerId, items, payments: [{ method: 'cash', amount: q.total }] })).body.data;
    const stockBefore = (await db.queryOne('SELECT quantity FROM products WHERE id = ?', [product.id])).quantity;
    const customerBefore = await db.queryOne('SELECT visit_count, total_spent FROM customers WHERE id = ?', [customerId]);

    const refund = await admin.post(`/sales/${sale.id}/refund`, { reason: 'Test refund' });
    expect(refund.status).toBe(200);
    expect(refund.body.data.status).toBe('refunded');
    expect((await db.queryOne('SELECT quantity FROM products WHERE id = ?', [product.id])).quantity).toBe(stockBefore + 1);
    const commission = await db.queryOne('SELECT status FROM commissions WHERE sale_id = ?', [sale.id]);
    expect(commission.status).toBe('reversed');
    const net = await db.queryOne('SELECT SUM(amount) AS net FROM payments WHERE sale_id = ?', [sale.id]);
    expect(Number(net.net)).toBe(0);
    const customerAfter = await db.queryOne('SELECT visit_count, total_spent FROM customers WHERE id = ?', [customerId]);
    expect(customerAfter.visit_count).toBe(customerBefore.visit_count - 1);
    expect(Number(customerAfter.total_spent)).toBe(Number(customerBefore.total_spent) - sale.total);

    const twice = await admin.post(`/sales/${sale.id}/refund`, { reason: 'Again' });
    expect(twice.status).toBe(409);
  });

  test('simultaneous checkouts get unique, consecutive invoice numbers and exact stock', async () => {
    const { product } = await pick();
    const before = (await db.queryOne('SELECT quantity FROM products WHERE id = ?', [product.id])).quantity;
    const results = await Promise.all(
      Array.from({ length: 5 }, () => admin.post('/sales', { items: [{ type: 'product', productId: product.id, quantity: 1 }], payments: [{ method: 'cash', amount: 1000000 }] })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const numbers = results.map((r) => Number(r.body.data.invoiceNumber.slice(4))).sort((a, b) => a - b);
    expect(new Set(numbers).size).toBe(5);
    expect(numbers[4] - numbers[0]).toBe(4);
    expect((await db.queryOne('SELECT quantity FROM products WHERE id = ?', [product.id])).quantity).toBe(before - 5);
  });

  test('receipts and invoices are generated as PDF', async () => {
    const list = await admin.get('/sales?limit=1');
    const id = list.body.data[0].id;
    for (const format of ['a4', 'thermal']) {
      const doc = await admin.get(`/sales/${id}/document?format=${format}`);
      expect(doc.status).toBe(200);
      expect(doc.headers['content-type']).toMatch(/application\/pdf/);
      expect(doc.body.slice(0, 4).toString()).toBe('%PDF');
    }
  });
});
