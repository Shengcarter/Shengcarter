'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { camelizeRow, camelizeRows } = require('../utils/case');
const { getPaging, paginate } = require('../utils/pagination');
const { D, toNumber } = require('../utils/money');
const productModel = require('../models/productModel');
const notificationService = require('./notificationService');
const audit = require('./auditService');

/**
 * Inventory: products, the auditable stock ledger and stock alerts.
 *
 * Stock is only ever changed through changeStock(), which locks the product
 * row, refuses to go below zero and writes an inventory_transactions row with
 * the quantity before and after. Sales, refunds, purchases and manual
 * adjustments all go through it inside their own database transactions.
 */

async function getProduct(id, ctx) {
  const product = await productModel.findById(id);
  if (!product || product.branchId !== ctx.branchId) throw ApiError.notFound('Product not found');
  return product;
}

/**
 * Change stock inside a transaction. `change` is signed (+ in, − out).
 * @returns {{ before, after, product }}
 */
async function changeStock(conn, { productId, branchId, change, type, unitCost = null, referenceType = null, referenceId = null, reason = null, userId = null, at = null }) {
  const product = await db.queryOne(
    'SELECT id, name, branch_id, quantity, purchase_price, min_stock, status FROM products WHERE id = ? FOR UPDATE',
    [productId],
    conn,
  );
  if (!product || product.branch_id !== branchId) throw ApiError.validation([{ field: 'productId', message: 'Product not found in this branch' }]);
  // Stock can be fractional (0.2 of a bottle), so it is added up exactly, to 3 decimals.
  const after = toNumber(D(product.quantity).plus(change), 3);
  if (after < 0) {
    throw ApiError.validation([{ field: 'quantity', message: `Not enough stock for ${product.name} (available: ${product.quantity})` }]);
  }
  await db.query('UPDATE products SET quantity = ? WHERE id = ?', [after, productId], conn);
  await db.query(
    `INSERT INTO inventory_transactions (branch_id, product_id, type, quantity_change, quantity_before, quantity_after, unit_cost, reference_type, reference_id, reason, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))`,
    [branchId, productId, type, change, product.quantity, after, unitCost ?? product.purchase_price, referenceType, referenceId, reason, userId, at],
    conn,
  );
  return { before: product.quantity, after, product };
}

/** Notify stock managers about products at or below minimum stock (deduplicated per day). */
async function alertLowStock(productIds, branchId) {
  if (!productIds.length) return;
  const low = await db.query(
    "SELECT id, name, quantity, min_stock, unit FROM products WHERE id IN (?) AND quantity <= min_stock AND status = 'active'",
    [productIds],
  );
  for (const p of low) {
    await notificationService.notifyByPermission({
      permission: 'inventory.manage',
      branchId,
      type: 'inventory.low_stock',
      category: 'inventory',
      title: p.quantity === 0 ? `${p.name} is out of stock` : `Low stock: ${p.name}`,
      message: `Only ${p.quantity} ${p.unit} left (minimum ${p.min_stock}). Consider reordering.`,
      link: `/inventory?product=${p.id}`,
      dedupeKey: `low-stock:${p.id}:${p.quantity === 0 ? 'out' : 'low'}`,
    });
  }
}

// ---- Products ------------------------------------------------------------------------

async function assertUnique(branchId, { sku, barcode }, excludeId = 0) {
  if (sku) {
    const dup = await db.queryOne('SELECT id FROM products WHERE branch_id = ? AND sku = ? AND id <> ?', [branchId, sku, excludeId]);
    if (dup) throw ApiError.validation([{ field: 'sku', message: 'Another product in this branch uses this SKU' }]);
  }
  if (barcode) {
    const dup = await db.queryOne('SELECT id FROM products WHERE branch_id = ? AND barcode = ? AND id <> ?', [branchId, barcode, excludeId]);
    if (dup) throw ApiError.validation([{ field: 'barcode', message: 'Another product in this branch uses this barcode' }]);
  }
}

async function createProduct(data, ctx) {
  await assertUnique(ctx.branchId, data);
  const id = await db.withTransaction(async (conn) => {
    const productId = await productModel.insert({ ...data, branchId: ctx.branchId, createdBy: ctx.userId }, conn);
    if (data.openingStock > 0) {
      await changeStock(conn, {
        productId, branchId: ctx.branchId, change: data.openingStock, type: 'opening',
        unitCost: data.purchasePrice, reason: 'Opening stock', userId: ctx.userId,
      });
    }
    await audit.record(ctx, { action: 'product.created', entityType: 'product', entityId: productId, description: `Added product ${data.name} (${data.sku})` }, conn);
    return productId;
  });
  return getProduct(id, ctx);
}

async function updateProduct(id, data, ctx) {
  const existing = await getProduct(id, ctx);
  await assertUnique(ctx.branchId, data, id);
  await db.withTransaction(async (conn) => {
    await productModel.update(id, data, conn);
    const priceChanged = (data.sellingPrice !== undefined && Number(data.sellingPrice) !== Number(existing.sellingPrice))
      || (data.purchasePrice !== undefined && Number(data.purchasePrice) !== Number(existing.purchasePrice));
    await audit.record(ctx, {
      action: 'product.updated', entityType: 'product', entityId: id, description: `Updated product ${existing.name}`,
      metadata: priceChanged
        ? { purchasePrice: { from: existing.purchasePrice, to: data.purchasePrice ?? existing.purchasePrice }, sellingPrice: { from: existing.sellingPrice, to: data.sellingPrice ?? existing.sellingPrice } }
        : { fields: Object.keys(data) },
    }, conn);
  });
  return getProduct(id, ctx);
}

/** Products with sales/purchase history are discontinued instead of deleted. */
async function deleteProduct(id, ctx) {
  const product = await getProduct(id, ctx);
  const archived = (await productModel.historyCount(id)) > 0;
  await db.withTransaction(async (conn) => {
    if (archived) {
      await db.query("UPDATE products SET status = 'discontinued' WHERE id = ?", [id], conn);
    } else {
      await db.query('DELETE FROM inventory_transactions WHERE product_id = ?', [id], conn);
      await db.query('DELETE FROM products WHERE id = ?', [id], conn);
    }
    await audit.record(ctx, { action: 'product.deleted', entityType: 'product', entityId: id, description: `${archived ? 'Discontinued' : 'Deleted'} product ${product.name}` }, conn);
  });
  return { archived };
}

/** Product detail with its most recent stock movements. */
async function getProductDetail(id, ctx) {
  const product = await getProduct(id, ctx);
  const movements = await db.query(
    `SELECT t.id, t.type, t.quantity_change, t.quantity_before, t.quantity_after, t.unit_cost, t.reference_type, t.reference_id,
            t.reason, t.created_at, u.full_name AS created_by_name
     FROM inventory_transactions t LEFT JOIN users u ON u.id = t.created_by
     WHERE t.product_id = ? ORDER BY t.created_at DESC, t.id DESC LIMIT 15`,
    [id],
  );
  const sales = await db.queryOne(
    `SELECT COALESCE(SUM(si.quantity), 0) AS units, COALESCE(SUM(si.net_amount), 0) AS revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE si.product_id = ? AND s.status = 'completed' AND s.sold_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)`,
    [id],
  );
  return { ...product, recentMovements: camelizeRows(movements), last30Days: { unitsSold: Number(sales.units), revenue: Number(sales.revenue) } };
}

/**
 * Active products of the branch that can be used on services, in the unit they
 * are used in (e.g. ml of a product stocked in bottles). The cost per unit is
 * only for people who see costs.
 */
async function usableProducts(ctx) {
  const rows = await db.query(
    `SELECT id, name, sku, unit, usage_unit, usage_per_unit, purchase_price, quantity, is_retail FROM products
     WHERE branch_id = ? AND status = 'active' ORDER BY is_retail, name`,
    [ctx.branchId],
  );
  const { canSeeCosts, usageOf } = require('./serviceFinanceService');
  const showCosts = canSeeCosts(ctx);
  return rows.map((p) => {
    const usage = usageOf(p);
    return {
      id: p.id, name: p.name, sku: p.sku, unit: usage.unit, stockUnit: p.unit, perStockUnit: usage.per.toNumber(),
      inStock: toNumber(D(p.quantity).times(usage.per), 3), isRetail: Boolean(p.is_retail),
      ...(showCosts ? { unitCost: toNumber(usage.unitCost, 4) } : {}),
    };
  });
}

// ---- Manual stock operations ----------------------------------------------------------

const MANUAL_TYPES = {
  stock_in: 1,
  stock_out: -1,
  damage: -1,
  internal_use: -1,
};

/**
 * Manual stock movement. For "adjustment" the quantity is the counted stock
 * level (stock take) and the difference is recorded; for the other types it
 * is the number of units moved.
 */
async function adjust({ productId, type, quantity, unitCost, reason }, ctx) {
  await getProduct(productId, ctx);
  const result = await db.withTransaction(async (conn) => {
    let change;
    if (type === 'adjustment') {
      const current = await db.queryOne('SELECT quantity FROM products WHERE id = ? FOR UPDATE', [productId], conn);
      change = toNumber(D(quantity).minus(current.quantity), 3);
      if (change === 0) throw ApiError.badRequest('The counted quantity matches the current stock — nothing to adjust');
    } else {
      change = MANUAL_TYPES[type] * quantity;
    }
    const moved = await changeStock(conn, {
      productId, branchId: ctx.branchId, change, type, unitCost: unitCost ?? null, referenceType: 'manual', reason, userId: ctx.userId,
    });
    if (type === 'stock_in' && unitCost) {
      await db.query('UPDATE products SET purchase_price = ? WHERE id = ?', [unitCost, productId], conn);
    }
    await audit.record(ctx, {
      action: 'inventory.adjusted', entityType: 'product', entityId: productId,
      description: `${type.replace('_', ' ')}: ${moved.product.name} ${change > 0 ? '+' : ''}${change} (${moved.before} → ${moved.after})${reason ? ` — ${reason}` : ''}`,
    }, conn);
    return moved;
  });
  await alertLowStock([productId], ctx.branchId);
  return { productId, before: result.before, after: result.after };
}

async function listTransactions(filters, ctx) {
  const where = ['t.branch_id = ?'];
  const params = [ctx.branchId];
  if (filters.productId) {
    where.push('t.product_id = ?');
    params.push(filters.productId);
  }
  if (filters.type) {
    where.push('t.type = ?');
    params.push(filters.type);
  }
  if (filters.start) {
    where.push('t.created_at >= ?');
    params.push(filters.start);
  }
  if (filters.end) {
    where.push('t.created_at < ?');
    params.push(filters.end);
  }
  const result = await paginate({
    select: `t.id, t.type, t.quantity_change, t.quantity_before, t.quantity_after, t.unit_cost, t.reference_type, t.reference_id,
             t.reason, t.created_at, p.id AS product_id, p.name AS product_name, p.sku, p.unit, u.full_name AS created_by_name,
             CASE WHEN t.reference_type = 'sale' THEN (SELECT invoice_number FROM sales WHERE id = t.reference_id)
                  WHEN t.reference_type = 'purchase' THEN (SELECT code FROM purchases WHERE id = t.reference_id) END AS reference_code`,
    from: `FROM inventory_transactions t JOIN products p ON p.id = t.product_id LEFT JOIN users u ON u.id = t.created_by WHERE ${where.join(' AND ')}`,
    params,
    orderBy: 't.created_at DESC, t.id DESC',
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows) };
}

/** Stock value at cost and at retail price, overall and per category. */
async function valuation(ctx) {
  const rows = await db.query(
    `SELECT COALESCE(c.name, 'Uncategorised') AS category, COUNT(*) AS products, SUM(p.quantity) AS units,
            SUM(p.quantity * p.purchase_price) AS cost_value, SUM(p.quantity * p.selling_price) AS retail_value
     FROM products p LEFT JOIN product_categories c ON c.id = p.category_id
     WHERE p.branch_id = ? AND p.status <> 'discontinued'
     GROUP BY category ORDER BY cost_value DESC`,
    [ctx.branchId],
  );
  const counts = await db.queryOne(
    `SELECT COUNT(*) AS total, SUM(quantity <= min_stock AND quantity > 0) AS low, SUM(quantity = 0) AS out_of_stock,
            SUM(expiry_date IS NOT NULL AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)) AS expiring
     FROM products WHERE branch_id = ? AND status = 'active'`,
    [ctx.branchId],
  );
  const categories = rows.map((r) => ({
    category: r.category,
    products: Number(r.products),
    units: Number(r.units || 0),
    costValue: toNumber(r.cost_value || 0),
    retailValue: toNumber(r.retail_value || 0),
  }));
  return {
    totals: {
      products: Number(counts.total || 0),
      lowStock: Number(counts.low || 0),
      outOfStock: Number(counts.out_of_stock || 0),
      expiringSoon: Number(counts.expiring || 0),
      units: categories.reduce((s, c) => s + c.units, 0),
      costValue: toNumber(categories.reduce((s, c) => s + c.costValue, 0)),
      retailValue: toNumber(categories.reduce((s, c) => s + c.retailValue, 0)),
    },
    categories,
  };
}

// ---- Product categories -----------------------------------------------------------------
const slugify = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

async function listCategories() {
  return camelizeRows(
    await db.query(
      `SELECT c.id, c.name, c.slug, c.description, c.is_active, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
       FROM product_categories c ORDER BY c.name`,
    ),
  );
}

async function saveCategory(id, data, ctx) {
  let targetId = id;
  if (id) {
    const result = await db.query('UPDATE product_categories SET name = ?, slug = ?, description = ? WHERE id = ?', [data.name, slugify(data.name), data.description || null, id]);
    if (!result.affectedRows) throw ApiError.notFound('Category not found');
  } else {
    const result = await db.query('INSERT INTO product_categories (name, slug, description) VALUES (?, ?, ?)', [data.name, slugify(data.name), data.description || null]);
    targetId = result.insertId;
  }
  await audit.record(ctx, { action: 'product_category.saved', entityType: 'product_category', entityId: targetId, description: `Saved product category ${data.name}` });
  return camelizeRow(await db.queryOne('SELECT * FROM product_categories WHERE id = ?', [targetId]));
}

async function deleteCategory(id, ctx) {
  const used = await db.queryOne('SELECT COUNT(*) AS total FROM products WHERE category_id = ?', [id]);
  if (Number(used.total)) throw ApiError.conflict('Move the products in this category first');
  const result = await db.query('DELETE FROM product_categories WHERE id = ?', [id]);
  if (!result.affectedRows) throw ApiError.notFound('Category not found');
  await audit.record(ctx, { action: 'product_category.deleted', entityType: 'product_category', entityId: id, description: 'Deleted product category' });
}

/** Daily check (job): alert about products at/below minimum in every branch. */
async function dailyStockCheck() {
  const rows = await db.query("SELECT id, branch_id FROM products WHERE quantity <= min_stock AND status = 'active'");
  const byBranch = new Map();
  for (const r of rows) {
    if (!byBranch.has(r.branch_id)) byBranch.set(r.branch_id, []);
    byBranch.get(r.branch_id).push(r.id);
  }
  for (const [branchId, ids] of byBranch) await alertLowStock(ids, branchId);
}

module.exports = {
  usableProducts,
  changeStock,
  alertLowStock,
  list: productModel.list,
  getProduct,
  getProductDetail,
  createProduct,
  updateProduct,
  deleteProduct,
  adjust,
  listTransactions,
  valuation,
  listCategories,
  saveCategory,
  deleteCategory,
  dailyStockCheck,
};
