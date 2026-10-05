'use strict';

const db = require('../config/database');
const { camelizeRow, camelizeRows } = require('../utils/case');
const { getPaging, getSort, paginate } = require('../utils/pagination');
const { contains, startsWith } = require('../utils/sql');

/** Data access for products (stock is per branch: each row belongs to one branch). */
const COLUMNS = `p.id, p.branch_id, p.category_id, p.supplier_id, p.name, p.sku, p.barcode, p.description, p.unit, p.usage_unit, p.usage_per_unit,
  p.purchase_price, p.selling_price, p.quantity, p.min_stock, p.max_stock, p.expiry_date, p.status, p.is_retail,
  p.image, p.is_demo, p.created_at, p.updated_at, c.name AS category_name, s.name AS supplier_name,
  (p.quantity <= p.min_stock) AS is_low_stock`;

const JOINS = `FROM products p
  LEFT JOIN product_categories c ON c.id = p.category_id
  LEFT JOIN suppliers s ON s.id = p.supplier_id`;

const SORTS = {
  name: 'p.name',
  sku: 'p.sku',
  quantity: 'p.quantity',
  sellingPrice: 'p.selling_price',
  expiryDate: 'p.expiry_date',
  updatedAt: 'p.updated_at',
};

async function list(filters) {
  const where = ['p.branch_id = ?'];
  const params = [filters.branchId];
  if (filters.search) {
    // Name, SKU, barcode or category ("hair care").
    where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode = ? OR c.name LIKE ?)');
    params.push(contains(filters.search), startsWith(filters.search), filters.search, contains(filters.search));
  }
  if (filters.categoryId) {
    where.push('p.category_id = ?');
    params.push(filters.categoryId);
  }
  if (filters.supplierId) {
    where.push('p.supplier_id = ?');
    params.push(filters.supplierId);
  }
  if (filters.status) {
    where.push('p.status = ?');
    params.push(filters.status);
  } else {
    where.push("p.status <> 'discontinued'");
  }
  if (filters.retail !== undefined) {
    where.push('p.is_retail = ?');
    params.push(filters.retail ? 1 : 0);
  }
  if (filters.stock === 'low') where.push('p.quantity <= p.min_stock AND p.quantity > 0');
  if (filters.stock === 'out') where.push('p.quantity = 0');
  if (filters.stock === 'attention') where.push('p.quantity <= p.min_stock');
  if (filters.stock === 'in') where.push('p.quantity > p.min_stock');
  if (filters.expiring) where.push('p.expiry_date IS NOT NULL AND p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY)');

  const result = await paginate({
    select: COLUMNS,
    from: `${JOINS} WHERE ${where.join(' AND ')}`,
    params,
    orderBy: `${getSort(filters.sortBy, filters.sortOrder || 'asc', SORTS, 'name')}, p.id`,
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows, ['is_low_stock']) };
}

async function findById(id, conn) {
  const row = await db.queryOne(`SELECT ${COLUMNS} ${JOINS} WHERE p.id = ?`, [id], conn);
  return row ? camelizeRow(row, ['is_low_stock']) : null;
}

const WRITABLE = {
  categoryId: 'category_id',
  supplierId: 'supplier_id',
  name: 'name',
  sku: 'sku',
  barcode: 'barcode',
  description: 'description',
  unit: 'unit',
  usageUnit: 'usage_unit',
  usagePerUnit: 'usage_per_unit',
  purchasePrice: 'purchase_price',
  sellingPrice: 'selling_price',
  minStock: 'min_stock',
  maxStock: 'max_stock',
  expiryDate: 'expiry_date',
  status: 'status',
  isRetail: 'is_retail',
  image: 'image',
};

function toColumns(data) {
  const columns = [];
  const values = [];
  for (const [key, column] of Object.entries(WRITABLE)) {
    if (data[key] === undefined) continue;
    columns.push(column);
    values.push(typeof data[key] === 'boolean' ? Number(data[key]) : data[key]);
  }
  return { columns, values };
}

async function insert(data, conn) {
  const { columns, values } = toColumns(data);
  const result = await db.query(
    `INSERT INTO products (branch_id, created_by, quantity, ${columns.join(', ')}) VALUES (?, ?, 0, ${columns.map(() => '?').join(', ')})`,
    [data.branchId, data.createdBy || null, ...values],
    conn,
  );
  return result.insertId;
}

async function update(id, data, conn) {
  const { columns, values } = toColumns(data);
  if (!columns.length) return;
  await db.query(`UPDATE products SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...values, id], conn);
}

async function historyCount(id) {
  const row = await db.queryOne(
    `SELECT (SELECT COUNT(*) FROM sale_items WHERE product_id = ?) + (SELECT COUNT(*) FROM purchase_items WHERE product_id = ?)
          + (SELECT COUNT(*) FROM inventory_transactions WHERE product_id = ? AND type <> 'opening')
          + (SELECT COUNT(*) FROM sale_item_products WHERE product_id = ?) AS total`,
    [id, id, id, id],
  );
  return Number(row.total);
}

module.exports = { list, findById, insert, update, historyCount };
