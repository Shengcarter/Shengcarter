'use strict';

const { signIn, db } = require('./helpers');

const stock = async (id) => (await db.queryOne('SELECT quantity FROM products WHERE id = ?', [id])).quantity;

describe('inventory', () => {
  let admin;
  let product;

  beforeAll(async () => {
    admin = await signIn();
    const res = await admin.post('/products', { name: `Test Serum ${Date.now()}`, sku: `TST-${Date.now()}`, purchasePrice: 8000, sellingPrice: 15000, unit: 'bottle', minStock: 3, openingStock: 10, isRetail: true });
    expect(res.status).toBe(201);
    product = res.body.data;
  });

  test('opening stock is recorded in the ledger', async () => {
    expect(await stock(product.id)).toBe(10);
    const row = await db.queryOne("SELECT quantity_change FROM inventory_transactions WHERE product_id = ? AND type = 'opening'", [product.id]);
    expect(row.quantity_change).toBe(10);
  });

  test('receiving a purchase increases stock and updates the cost price', async () => {
    const supplier = await db.queryOne('SELECT id FROM suppliers WHERE is_active = 1 LIMIT 1');
    const res = await admin.post('/purchases', { supplierId: supplier.id, purchaseDate: new Date().toISOString().slice(0, 10), items: [{ productId: product.id, quantity: 6, unitCost: 7500 }], receiveNow: true });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('received');
    expect(await stock(product.id)).toBe(16);
    expect(Number((await db.queryOne('SELECT purchase_price FROM products WHERE id = ?', [product.id])).purchase_price)).toBe(7500);
  });

  test('sales deduct stock and adjustments cannot make it negative', async () => {
    const sale = await admin.post('/sales', { items: [{ type: 'product', productId: product.id, quantity: 4 }], payments: [{ method: 'cash', amount: 100000 }] });
    expect(sale.status).toBe(201);
    expect(await stock(product.id)).toBe(12);

    const damaged = await admin.post('/inventory/adjust', { productId: product.id, type: 'damage', quantity: 2, reason: 'Broken in storage' });
    expect(damaged.status).toBe(200);
    expect(await stock(product.id)).toBe(10);

    const tooMany = await admin.post('/inventory/adjust', { productId: product.id, type: 'stock_out', quantity: 50, reason: 'Test' });
    expect(tooMany.status).toBe(422);
    expect(await stock(product.id)).toBe(10);
  });

  test('stock counts record the difference, and the ledger always matches the stock', async () => {
    const count = await admin.post('/inventory/adjust', { productId: product.id, type: 'adjustment', quantity: 7, reason: 'Monthly count' });
    expect(count.status).toBe(200);
    expect(await stock(product.id)).toBe(7);
    const sum = await db.queryOne('SELECT SUM(quantity_change) AS total FROM inventory_transactions WHERE product_id = ?', [product.id]);
    expect(Number(sum.total)).toBe(7);
  });

  test('products at or below minimum stock raise a low-stock alert', async () => {
    await admin.post('/inventory/adjust', { productId: product.id, type: 'stock_out', quantity: 5, reason: 'Moved to other branch' });
    const sale = await admin.post('/sales', { items: [{ type: 'product', productId: product.id, quantity: 1 }], payments: [{ method: 'cash', amount: 50000 }] });
    expect(sale.status).toBe(201);
    const low = await admin.get('/products?stock=low');
    expect(low.body.data.some((p) => p.id === product.id)).toBe(true);
    const alert = await db.queryOne("SELECT id FROM notifications WHERE type = 'inventory.low_stock' AND link LIKE ?", [`%product=${product.id}%`]);
    expect(alert).toBeTruthy();
  });
});
