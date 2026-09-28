'use strict';

const db = require('../config/database');
const { camelizeRow, camelizeRows } = require('../utils/case');
const { getPaging, getSort, paginate } = require('../utils/pagination');
const { contains, startsWith } = require('../utils/sql');

/** Data access for customers (soft-deleted rows are excluded everywhere). */
const COLUMNS = `c.id, c.code, c.branch_id, c.full_name, c.phone, c.email, c.gender, c.date_of_birth, c.address,
  c.photo, c.notes, c.loyalty_points, c.lifetime_points, c.total_spent, c.visit_count, c.last_visit_at,
  c.marketing_opt_in, c.preferred_channel, c.is_demo, c.created_at, c.updated_at, b.name AS branch_name`;

const BOOL_KEYS = ['marketing_opt_in'];

const SORTS = {
  name: 'c.full_name',
  createdAt: 'c.created_at',
  lastVisit: 'c.last_visit_at',
  totalSpent: 'c.total_spent',
  loyalty: 'c.loyalty_points',
  visits: 'c.visit_count',
};

async function list(filters) {
  const where = ['c.deleted_at IS NULL'];
  const params = [];
  if (filters.search) {
    const digits = filters.search.replace(/[^\d]/g, '').replace(/^0/, '');
    where.push('(c.full_name LIKE ? OR c.phone LIKE ? OR c.email LIKE ? OR c.code LIKE ?)');
    params.push(contains(filters.search), contains(digits || filters.search), startsWith(filters.search), startsWith(filters.search));
  }
  if (filters.gender) {
    where.push('c.gender = ?');
    params.push(filters.gender);
  }
  if (filters.minPoints !== undefined) {
    where.push('c.lifetime_points >= ?');
    params.push(filters.minPoints);
  }
  if (filters.maxPoints !== undefined) {
    where.push('c.lifetime_points < ?');
    params.push(filters.maxPoints);
  }
  if (filters.visited === 'never') where.push('c.visit_count = 0');
  if (filters.visited === 'returning') where.push('c.visit_count > 1');
  if (filters.birthdayMonth) {
    where.push('MONTH(c.date_of_birth) = ?');
    params.push(filters.birthdayMonth);
  }

  const result = await paginate({
    select: COLUMNS,
    from: `FROM customers c LEFT JOIN branches b ON b.id = c.branch_id WHERE ${where.join(' AND ')}`,
    params,
    orderBy: `${getSort(filters.sortBy, filters.sortOrder, SORTS, 'createdAt')}, c.id DESC`,
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows, BOOL_KEYS) };
}

async function findById(id, conn) {
  const row = await db.queryOne(
    `SELECT ${COLUMNS} FROM customers c LEFT JOIN branches b ON b.id = c.branch_id WHERE c.id = ? AND c.deleted_at IS NULL`,
    [id],
    conn,
  );
  return row ? camelizeRow(row, BOOL_KEYS) : null;
}

async function findByPhone(phone, excludeId = 0) {
  return db.queryOne('SELECT id, code, full_name FROM customers WHERE phone = ? AND deleted_at IS NULL AND id <> ?', [phone, excludeId]);
}

const WRITABLE = {
  fullName: 'full_name',
  phone: 'phone',
  email: 'email',
  gender: 'gender',
  dateOfBirth: 'date_of_birth',
  address: 'address',
  notes: 'notes',
  marketingOptIn: 'marketing_opt_in',
  preferredChannel: 'preferred_channel',
  photo: 'photo',
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
    `INSERT INTO customers (code, branch_id, created_by, ${columns.join(', ')}) VALUES (?, ?, ?, ${columns.map(() => '?').join(', ')})`,
    [data.code, data.branchId || null, data.createdBy || null, ...values],
    conn,
  );
  return result.insertId;
}

async function update(id, data, conn) {
  const { columns, values } = toColumns(data);
  if (!columns.length) return;
  await db.query(`UPDATE customers SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...values, id], conn);
}

async function historyCounts(id) {
  return db.queryOne(
    `SELECT (SELECT COUNT(*) FROM appointments WHERE customer_id = ?) AS appointments,
            (SELECT COUNT(*) FROM sales WHERE customer_id = ?) AS sales`,
    [id, id],
  );
}

async function softDelete(id, conn) {
  await db.query('UPDATE customers SET deleted_at = UTC_TIMESTAMP() WHERE id = ?', [id], conn);
}

async function hardDelete(id, conn) {
  await db.query('DELETE FROM customers WHERE id = ?', [id], conn);
}

// ---- Notes --------------------------------------------------------------------
async function listNotes(customerId) {
  return camelizeRows(
    await db.query(
      `SELECT n.id, n.note, n.created_at, u.full_name AS created_by_name
       FROM customer_notes n LEFT JOIN users u ON u.id = n.created_by
       WHERE n.customer_id = ? ORDER BY n.created_at DESC, n.id DESC`,
      [customerId],
    ),
  );
}

async function insertNote(customerId, note, userId, conn) {
  const result = await db.query('INSERT INTO customer_notes (customer_id, note, created_by) VALUES (?, ?, ?)', [customerId, note, userId], conn);
  return result.insertId;
}

async function deleteNote(customerId, noteId) {
  const result = await db.query('DELETE FROM customer_notes WHERE id = ? AND customer_id = ?', [noteId, customerId]);
  return result.affectedRows > 0;
}

module.exports = {
  list,
  findById,
  findByPhone,
  insert,
  update,
  historyCounts,
  softDelete,
  hardDelete,
  listNotes,
  insertNote,
  deleteNote,
};
