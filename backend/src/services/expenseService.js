'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { camelizeRow, camelizeRows } = require('../utils/case');
const { getPaging, getSort, paginate } = require('../utils/pagination');
const { contains } = require('../utils/sql');
const audit = require('./auditService');

/** Expenses (branch-scoped) and expense categories. */

const COLUMNS = `e.id, e.branch_id, e.category_id, c.name AS category_name, e.expense_date, e.amount, e.description, e.payment_method,
  e.reference, e.vendor, e.attachment, e.recorded_by, u.full_name AS recorded_by_name, e.created_at, e.updated_at,
  (SELECT sr.id FROM salary_records sr WHERE sr.expense_id = e.id LIMIT 1) AS salary_record_id`;
const JOINS = 'FROM expenses e JOIN expense_categories c ON c.id = e.category_id LEFT JOIN users u ON u.id = e.recorded_by';

async function list(filters, ctx) {
  const where = ['e.branch_id = ?'];
  const params = [ctx.branchId];
  if (filters.from) {
    where.push('e.expense_date >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('e.expense_date <= ?');
    params.push(filters.to);
  }
  if (filters.categoryId) {
    where.push('e.category_id = ?');
    params.push(filters.categoryId);
  }
  if (filters.paymentMethod) {
    where.push('e.payment_method = ?');
    params.push(filters.paymentMethod);
  }
  if (filters.search) {
    where.push('(e.description LIKE ? OR e.vendor LIKE ? OR e.reference LIKE ?)');
    params.push(...Array(3).fill(contains(filters.search)));
  }
  const from = `${JOINS} WHERE ${where.join(' AND ')}`;
  const result = await paginate({
    select: COLUMNS,
    from,
    params,
    orderBy: `${getSort(filters.sortBy, filters.sortOrder, { date: 'e.expense_date', amount: 'e.amount' }, 'date')}, e.id DESC`,
    paging: getPaging(filters),
  });
  const [summary, byCategory] = await Promise.all([
    db.queryOne(`SELECT COUNT(*) AS count, COALESCE(SUM(e.amount), 0) AS total ${from}`, params),
    db.query(`SELECT c.name AS category, COALESCE(SUM(e.amount), 0) AS total ${from} GROUP BY c.name ORDER BY total DESC`, params),
  ]);
  return {
    ...result,
    rows: camelizeRows(result.rows),
    summary: { count: Number(summary.count), total: Number(summary.total), byCategory: byCategory.map((r) => ({ category: r.category, total: Number(r.total) })) },
  };
}

async function getById(id, ctx) {
  const row = await db.queryOne(`SELECT ${COLUMNS} ${JOINS} WHERE e.id = ?`, [id]);
  if (!row || row.branch_id !== ctx.branchId) throw ApiError.notFound('Expense not found');
  return camelizeRow(row);
}

async function assertCategory(categoryId) {
  const category = await db.queryOne('SELECT id, is_active FROM expense_categories WHERE id = ?', [categoryId]);
  if (!category) throw ApiError.validation([{ field: 'categoryId', message: 'Choose a valid category' }]);
}

async function create(data, ctx) {
  await assertCategory(data.categoryId);
  const id = await db.withTransaction(async (conn) => {
    const result = await db.query(
      `INSERT INTO expenses (branch_id, category_id, expense_date, amount, description, payment_method, reference, vendor, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ctx.branchId, data.categoryId, data.expenseDate, data.amount, data.description, data.paymentMethod, data.reference || null, data.vendor || null, ctx.userId],
      conn,
    );
    await audit.record(ctx, { action: 'expense.created', entityType: 'expense', entityId: result.insertId, description: `Recorded expense ${data.amount}: ${data.description}` }, conn);
    return result.insertId;
  });
  return getById(id, ctx);
}

async function update(id, data, ctx) {
  const existing = await getById(id, ctx);
  if (existing.salaryRecordId) throw ApiError.badRequest('This expense was created by a salary payment. Edit the salary record instead.');
  if (data.categoryId) await assertCategory(data.categoryId);
  const map = { categoryId: 'category_id', expenseDate: 'expense_date', amount: 'amount', description: 'description', paymentMethod: 'payment_method', reference: 'reference', vendor: 'vendor' };
  const entries = Object.entries(map).filter(([k]) => data[k] !== undefined);
  if (entries.length) {
    await db.query(`UPDATE expenses SET ${entries.map(([, c]) => `${c} = ?`).join(', ')} WHERE id = ?`, [...entries.map(([k]) => data[k]), id]);
  }
  await audit.record(ctx, {
    action: 'expense.updated', entityType: 'expense', entityId: id, description: `Updated expense: ${existing.description}`,
    metadata: data.amount !== undefined && Number(data.amount) !== Number(existing.amount) ? { amount: { from: existing.amount, to: data.amount } } : { fields: Object.keys(data) },
  });
  return getById(id, ctx);
}

async function remove(id, ctx) {
  const existing = await getById(id, ctx);
  if (existing.salaryRecordId) throw ApiError.badRequest('This expense belongs to a paid salary record and cannot be deleted');
  await db.query('DELETE FROM expenses WHERE id = ?', [id]);
  await audit.record(ctx, { action: 'expense.deleted', entityType: 'expense', entityId: id, description: `Deleted expense ${existing.amount}: ${existing.description}` });
  return existing.attachment;
}

async function setAttachment(id, publicPath, ctx) {
  const existing = await getById(id, ctx);
  await db.query('UPDATE expenses SET attachment = ? WHERE id = ?', [publicPath, id]);
  await audit.record(ctx, { action: 'expense.updated', entityType: 'expense', entityId: id, description: `${publicPath ? 'Attached receipt to' : 'Removed receipt from'} expense` });
  return existing.attachment;
}

// ---- Categories --------------------------------------------------------------------------
const slugify = (name) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);

async function listCategories() {
  return camelizeRows(
    await db.query('SELECT c.id, c.name, c.slug, c.is_active, (SELECT COUNT(*) FROM expenses e WHERE e.category_id = c.id) AS expense_count FROM expense_categories c ORDER BY c.name'),
  );
}

async function saveCategory(id, data, ctx) {
  let targetId = id;
  if (id) {
    const result = await db.query('UPDATE expense_categories SET name = ?, slug = ?, is_active = ? WHERE id = ?', [data.name, slugify(data.name), data.isActive === false ? 0 : 1, id]);
    if (!result.affectedRows) throw ApiError.notFound('Category not found');
  } else {
    const result = await db.query('INSERT INTO expense_categories (name, slug) VALUES (?, ?)', [data.name, slugify(data.name)]);
    targetId = result.insertId;
  }
  await audit.record(ctx, { action: 'expense_category.saved', entityType: 'expense_category', entityId: targetId, description: `Saved expense category ${data.name}` });
  return camelizeRow(await db.queryOne('SELECT * FROM expense_categories WHERE id = ?', [targetId]));
}

async function deleteCategory(id, ctx) {
  const category = await db.queryOne('SELECT slug FROM expense_categories WHERE id = ?', [id]);
  if (!category) throw ApiError.notFound('Category not found');
  if (category.slug === 'salaries') throw ApiError.badRequest('The Salaries category is used by payroll and cannot be deleted');
  const used = await db.queryOne('SELECT COUNT(*) AS total FROM expenses WHERE category_id = ?', [id]);
  if (Number(used.total)) throw ApiError.conflict('This category has expenses. Deactivate it instead.');
  await db.query('DELETE FROM expense_categories WHERE id = ?', [id]);
  await audit.record(ctx, { action: 'expense_category.deleted', entityType: 'expense_category', entityId: id, description: 'Deleted expense category' });
}

module.exports = { list, getById, create, update, remove, setAttachment, listCategories, saveCategory, deleteCategory };
