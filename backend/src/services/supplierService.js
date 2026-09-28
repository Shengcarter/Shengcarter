'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { camelizeRow, camelizeRows } = require('../utils/case');
const { getPaging, getSort, paginate } = require('../utils/pagination');
const { contains } = require('../utils/sql');
const { D, toNumber } = require('../utils/money');
const { nextCode } = require('../utils/sequence');
const { normalizePhone } = require('../utils/phone');
const inventoryService = require('./inventoryService');
const audit = require('./auditService');

// ---- Suppliers --------------------------------------------------------------------------

const BALANCE_SQL = `(SELECT COALESCE(SUM(pu.total - pu.amount_paid), 0) FROM purchases pu WHERE pu.supplier_id = s.id AND pu.status <> 'cancelled')`;

async function list(filters) {
  const where = ['1=1'];
  const params = [];
  if (filters.search) {
    where.push('(s.name LIKE ? OR s.contact_person LIKE ? OR s.phone LIKE ? OR s.email LIKE ?)');
    params.push(...Array(4).fill(contains(filters.search)));
  }
  if (filters.status === 'active') where.push('s.is_active = 1');
  if (filters.status === 'inactive') where.push('s.is_active = 0');
  if (filters.withBalance) where.push(`${BALANCE_SQL} > 0`);
  const result = await paginate({
    select: `s.id, s.name, s.contact_person, s.phone, s.email, s.address, s.tax_number, s.is_active, s.is_demo,
             ${BALANCE_SQL} AS outstanding_balance,
             (SELECT COUNT(*) FROM purchases pu WHERE pu.supplier_id = s.id AND pu.status <> 'cancelled') AS purchase_count,
             (SELECT MAX(pu.purchase_date) FROM purchases pu WHERE pu.supplier_id = s.id) AS last_purchase_date`,
    from: `FROM suppliers s WHERE ${where.join(' AND ')}`,
    params,
    orderBy: getSort(filters.sortBy, filters.sortOrder || 'asc', { name: 's.name', balance: 'outstanding_balance' }, 'name'),
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows) };
}

async function getById(id) {
  const row = await db.queryOne(`SELECT s.*, ${BALANCE_SQL} AS outstanding_balance FROM suppliers s WHERE s.id = ?`, [id]);
  if (!row) throw ApiError.notFound('Supplier not found');
  return camelizeRow(row);
}

async function getDetail(id) {
  const supplier = await getById(id);
  const [totals, payments] = await Promise.all([
    db.queryOne(
      `SELECT COUNT(*) AS purchases, COALESCE(SUM(total), 0) AS total_purchased, COALESCE(SUM(amount_paid), 0) AS total_paid
       FROM purchases WHERE supplier_id = ? AND status <> 'cancelled'`,
      [id],
    ),
    db.query(
      `SELECT sp.id, sp.amount, sp.payment_method, sp.payment_date, sp.reference, sp.notes, sp.created_at,
              pu.code AS purchase_code, u.full_name AS created_by_name
       FROM supplier_payments sp JOIN purchases pu ON pu.id = sp.purchase_id LEFT JOIN users u ON u.id = sp.created_by
       WHERE sp.supplier_id = ? ORDER BY sp.payment_date DESC, sp.id DESC LIMIT 50`,
      [id],
    ),
  ]);
  return {
    ...supplier,
    totals: { purchases: Number(totals.purchases), totalPurchased: Number(totals.total_purchased), totalPaid: Number(totals.total_paid) },
    payments: camelizeRows(payments),
  };
}

async function save(id, data, ctx) {
  const dup = data.name && (await db.queryOne('SELECT id FROM suppliers WHERE name = ? AND id <> ?', [data.name, id || 0]));
  if (dup) throw ApiError.validation([{ field: 'name', message: 'A supplier with this name already exists' }]);
  const values = {
    name: data.name,
    contact_person: data.contactPerson,
    phone: data.phone ? normalizePhone(data.phone) : data.phone,
    email: data.email,
    address: data.address,
    tax_number: data.taxNumber,
    notes: data.notes,
    is_active: data.isActive === undefined ? undefined : Number(data.isActive),
  };
  const entries = Object.entries(values).filter(([, v]) => v !== undefined);
  let targetId = id;
  if (id) {
    await getById(id);
    if (entries.length) await db.query(`UPDATE suppliers SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, [...entries.map(([, v]) => v), id]);
  } else {
    const result = await db.query(`INSERT INTO suppliers (${entries.map(([k]) => k).join(', ')}) VALUES (${entries.map(() => '?').join(', ')})`, entries.map(([, v]) => v));
    targetId = result.insertId;
  }
  await audit.record(ctx, { action: id ? 'supplier.updated' : 'supplier.created', entityType: 'supplier', entityId: targetId, description: `Saved supplier ${data.name || ''}`.trim() });
  return getById(targetId);
}

async function remove(id, ctx) {
  const supplier = await getById(id);
  const used = await db.queryOne('SELECT (SELECT COUNT(*) FROM purchases WHERE supplier_id = ?) AS total', [id]);
  const archived = Number(used.total) > 0;
  if (archived) await db.query('UPDATE suppliers SET is_active = 0 WHERE id = ?', [id]);
  else await db.query('DELETE FROM suppliers WHERE id = ?', [id]);
  await audit.record(ctx, { action: 'supplier.deleted', entityType: 'supplier', entityId: id, description: `${archived ? 'Deactivated' : 'Deleted'} supplier ${supplier.name}` });
  return { archived };
}

// ---- Purchases ----------------------------------------------------------------------------

function paymentStatus(total, paid) {
  if (D(paid).greaterThanOrEqualTo(total)) return 'paid';
  return D(paid).greaterThan(0) ? 'partial' : 'unpaid';
}

async function listPurchases(filters, ctx) {
  const where = ['p.branch_id = ?'];
  const params = [ctx.branchId];
  if (filters.supplierId) {
    where.push('p.supplier_id = ?');
    params.push(filters.supplierId);
  }
  if (filters.status) {
    where.push('p.status = ?');
    params.push(filters.status);
  }
  if (filters.paymentStatus) {
    where.push('p.payment_status = ?');
    params.push(filters.paymentStatus);
  }
  if (filters.from) {
    where.push('p.purchase_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('p.purchase_date <= ?');
    params.push(filters.to);
  }
  if (filters.search) {
    where.push('(p.code LIKE ? OR p.supplier_invoice_no LIKE ? OR s.name LIKE ?)');
    params.push(...Array(3).fill(contains(filters.search)));
  }
  const result = await paginate({
    select: `p.id, p.code, p.supplier_id, s.name AS supplier_name, p.supplier_invoice_no, p.purchase_date, p.status, p.subtotal,
             p.discount_amount, p.tax_amount, p.total, p.amount_paid, (p.total - p.amount_paid) AS balance, p.payment_status,
             p.received_at, p.created_at, (SELECT COUNT(*) FROM purchase_items i WHERE i.purchase_id = p.id) AS item_count`,
    from: `FROM purchases p JOIN suppliers s ON s.id = p.supplier_id WHERE ${where.join(' AND ')}`,
    params,
    orderBy: 'p.purchase_date DESC, p.id DESC',
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows) };
}

async function getPurchase(id, ctx, conn) {
  const row = await db.queryOne(
    `SELECT p.*, (p.total - p.amount_paid) AS balance, s.name AS supplier_name, s.phone AS supplier_phone,
            u.full_name AS created_by_name, r.full_name AS received_by_name
     FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN users u ON u.id = p.created_by LEFT JOIN users r ON r.id = p.received_by
     WHERE p.id = ?`,
    [id],
    conn,
  );
  if (!row || row.branch_id !== ctx.branchId) throw ApiError.notFound('Purchase not found');
  const items = await db.query(
    `SELECT i.id, i.product_id, pr.name AS product_name, pr.sku, pr.unit, i.quantity, i.unit_cost, i.line_total
     FROM purchase_items i JOIN products pr ON pr.id = i.product_id WHERE i.purchase_id = ? ORDER BY i.id`,
    [id],
    conn,
  );
  const payments = await db.query(
    `SELECT sp.id, sp.amount, sp.payment_method, sp.payment_date, sp.reference, sp.notes, u.full_name AS created_by_name
     FROM supplier_payments sp LEFT JOIN users u ON u.id = sp.created_by WHERE sp.purchase_id = ? ORDER BY sp.payment_date, sp.id`,
    [id],
    conn,
  );
  return { ...camelizeRow(row), items: camelizeRows(items), payments: camelizeRows(payments) };
}

/** Receive stock for every item (inside the caller's transaction). */
async function receiveItems(conn, purchase, items, ctx, at = null) {
  for (const item of items) {
    await inventoryService.changeStock(conn, {
      productId: item.productId,
      branchId: ctx.branchId,
      change: item.quantity,
      type: 'purchase',
      unitCost: item.unitCost,
      referenceType: 'purchase',
      referenceId: purchase.id,
      reason: `Received on ${purchase.code}`,
      userId: ctx.userId,
      at,
    });
    // Latest cost becomes the product's purchase price (used for cost of goods sold).
    await db.query('UPDATE products SET purchase_price = ? WHERE id = ?', [item.unitCost, item.productId], conn);
  }
  await db.query("UPDATE purchases SET status = 'received', received_at = COALESCE(?, UTC_TIMESTAMP()), received_by = ? WHERE id = ?", [at, ctx.userId, purchase.id], conn);
}

/**
 * `options` is for trusted server-side callers only: `at` records the purchase
 * as created/received at an earlier moment and `demo` marks demo activity.
 */
async function createPurchase(data, ctx, options = {}) {
  const supplier = await getById(data.supplierId);
  if (!supplier.isActive) throw ApiError.validation([{ field: 'supplierId', message: 'This supplier is inactive' }]);
  const productIds = [...new Set(data.items.map((i) => i.productId))];
  if (productIds.length !== data.items.length) throw ApiError.validation([{ field: 'items', message: 'Each product can appear only once' }]);
  const products = await db.query('SELECT id FROM products WHERE id IN (?) AND branch_id = ?', [productIds, ctx.branchId]);
  if (products.length !== productIds.length) throw ApiError.validation([{ field: 'items', message: 'One or more products are not in this branch' }]);

  const lines = data.items.map((i) => ({ ...i, lineTotal: D(i.unitCost).times(i.quantity).toDecimalPlaces(2) }));
  const subtotal = lines.reduce((s, l) => s.plus(l.lineTotal), D(0));
  const discount = D(data.discountAmount || 0);
  const tax = D(data.taxAmount || 0);
  if (discount.greaterThan(subtotal)) throw ApiError.validation([{ field: 'discountAmount', message: 'Discount cannot exceed the subtotal' }]);
  const total = subtotal.minus(discount).plus(tax);

  const id = await db.withTransaction(async (conn) => {
    const code = await nextCode(conn, 'purchase', 'PO-', 6);
    const result = await db.query(
      `INSERT INTO purchases (code, branch_id, supplier_id, supplier_invoice_no, purchase_date, status, subtotal, discount_amount, tax_amount, total, notes, created_by, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, 'ordered', ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))`,
      [code, ctx.branchId, supplier.id, data.supplierInvoiceNo || null, data.purchaseDate, toNumber(subtotal), toNumber(discount), toNumber(tax), toNumber(total), data.notes || null, ctx.userId, options.demo ? 1 : 0, options.at || null],
      conn,
    );
    const purchase = { id: result.insertId, code };
    await db.query(
      'INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, line_total) VALUES ?',
      [lines.map((l) => [purchase.id, l.productId, l.quantity, l.unitCost, toNumber(l.lineTotal)])],
      conn,
    );
    if (data.receiveNow) await receiveItems(conn, purchase, lines, ctx, options.at || null);
    await audit.record(ctx, {
      action: 'purchase.created', entityType: 'purchase', entityId: purchase.id,
      description: `Created purchase ${code} from ${supplier.name} (${lines.length} item(s))${data.receiveNow ? ' and received stock' : ''}`,
    }, conn);
    return purchase.id;
  });
  if (data.initialPayment?.amount) await recordPayment(id, { ...data.initialPayment, paymentDate: data.purchaseDate }, ctx);
  return getPurchase(id, ctx);
}

async function receivePurchase(id, ctx) {
  await db.withTransaction(async (conn) => {
    const purchase = await db.queryOne('SELECT id, code, status, branch_id FROM purchases WHERE id = ? FOR UPDATE', [id], conn);
    if (!purchase || purchase.branch_id !== ctx.branchId) throw ApiError.notFound('Purchase not found');
    if (purchase.status !== 'ordered') throw ApiError.badRequest(`This purchase is already ${purchase.status}`);
    const items = await db.query('SELECT product_id AS productId, quantity, unit_cost AS unitCost FROM purchase_items WHERE purchase_id = ?', [id], conn);
    await receiveItems(conn, purchase, items, ctx);
    await audit.record(ctx, { action: 'purchase.received', entityType: 'purchase', entityId: id, description: `Received stock for ${purchase.code}` }, conn);
  });
  return getPurchase(id, ctx);
}

async function cancelPurchase(id, ctx) {
  const purchase = await getPurchase(id, ctx);
  if (purchase.status !== 'ordered') throw ApiError.badRequest('Only purchases that have not been received can be cancelled');
  if (purchase.amountPaid > 0) throw ApiError.badRequest('This purchase has payments recorded against it');
  await db.query("UPDATE purchases SET status = 'cancelled' WHERE id = ?", [id]);
  await audit.record(ctx, { action: 'purchase.cancelled', entityType: 'purchase', entityId: id, description: `Cancelled purchase ${purchase.code}` });
  return getPurchase(id, ctx);
}

async function recordPayment(purchaseId, data, ctx) {
  await db.withTransaction(async (conn) => {
    const purchase = await db.queryOne('SELECT id, code, supplier_id, branch_id, status, total, amount_paid FROM purchases WHERE id = ? FOR UPDATE', [purchaseId], conn);
    if (!purchase || purchase.branch_id !== ctx.branchId) throw ApiError.notFound('Purchase not found');
    if (purchase.status === 'cancelled') throw ApiError.badRequest('Cannot pay a cancelled purchase');
    const balance = D(purchase.total).minus(purchase.amount_paid);
    if (D(data.amount).greaterThan(balance)) throw ApiError.validation([{ field: 'amount', message: `Amount exceeds the balance of ${toNumber(balance)}` }]);
    const paid = D(purchase.amount_paid).plus(data.amount);
    await db.query(
      `INSERT INTO supplier_payments (supplier_id, purchase_id, branch_id, amount, payment_method, payment_date, reference, notes, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [purchase.supplier_id, purchase.id, ctx.branchId, data.amount, data.paymentMethod, data.paymentDate, data.reference || null, data.notes || null, ctx.userId],
      conn,
    );
    await db.query('UPDATE purchases SET amount_paid = ?, payment_status = ? WHERE id = ?', [toNumber(paid), paymentStatus(purchase.total, paid), purchase.id], conn);
    await audit.record(ctx, { action: 'purchase.payment_recorded', entityType: 'purchase', entityId: purchase.id, description: `Paid ${data.amount} on ${purchase.code}` }, conn);
  });
  return getPurchase(purchaseId, ctx);
}

module.exports = {
  list,
  getById,
  getDetail,
  save,
  remove,
  listPurchases,
  getPurchase,
  createPurchase,
  receivePurchase,
  cancelPurchase,
  recordPayment,
};
