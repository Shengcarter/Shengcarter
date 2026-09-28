'use strict';

const db = require('../config/database');
const { camelizeRow } = require('../utils/case');
const { getPaging, getSort, paginate } = require('../utils/pagination');

/** Data access for the `users` table. password_hash is only read by auth code. */
const PUBLIC_COLUMNS = `u.id, u.full_name, u.email, u.phone, u.avatar, u.role_id, u.branch_id, u.is_active,
  u.must_change_password, u.failed_login_attempts, u.locked_until, u.last_login_at, u.is_demo,
  u.created_at, u.updated_at, r.slug AS role_slug, r.name AS role_name, b.name AS branch_name,
  e.id AS employee_id, e.full_name AS employee_name`;

const JOINS = `FROM users u
  JOIN roles r ON r.id = u.role_id
  LEFT JOIN branches b ON b.id = u.branch_id
  LEFT JOIN employees e ON e.user_id = u.id`;

const BOOL_KEYS = ['must_change_password'];

async function findAuthByEmail(email) {
  return db.queryOne(
    `SELECT u.id, u.email, u.password_hash, u.is_active, u.failed_login_attempts, u.locked_until,
            u.must_change_password, u.full_name
     FROM users u WHERE u.email = ?`,
    [String(email).trim().toLowerCase()],
  );
}

async function findAuthById(id, conn) {
  return db.queryOne('SELECT id, email, password_hash, is_active, full_name FROM users WHERE id = ?', [id], conn);
}

async function findById(id, conn) {
  const row = await db.queryOne(`SELECT ${PUBLIC_COLUMNS} ${JOINS} WHERE u.id = ?`, [id], conn);
  return row ? camelizeRow(row, BOOL_KEYS) : null;
}

async function emailExists(email, excludeId = null) {
  const row = await db.queryOne('SELECT id FROM users WHERE email = ? AND id <> ?', [email.toLowerCase(), excludeId || 0]);
  return Boolean(row);
}

const SORTS = { name: 'u.full_name', email: 'u.email', createdAt: 'u.created_at', lastLogin: 'u.last_login_at' };

async function list(filters) {
  const where = ['1=1'];
  const params = [];
  if (filters.search) {
    where.push('(u.full_name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`);
  }
  if (filters.roleId) {
    where.push('u.role_id = ?');
    params.push(filters.roleId);
  }
  if (filters.branchId) {
    where.push('u.branch_id = ?');
    params.push(filters.branchId);
  }
  if (filters.status === 'active') where.push('u.is_active = 1');
  if (filters.status === 'inactive') where.push('u.is_active = 0');

  const result = await paginate({
    select: `${PUBLIC_COLUMNS}, u.last_login_ip`,
    from: `${JOINS} WHERE ${where.join(' AND ')}`,
    params,
    orderBy: getSort(filters.sortBy, filters.sortOrder, SORTS, 'name'),
    paging: getPaging(filters),
  });
  return { ...result, rows: result.rows.map((r) => camelizeRow(r, BOOL_KEYS)) };
}

async function insert(data, conn) {
  const result = await db.query(
    `INSERT INTO users (role_id, branch_id, full_name, email, phone, password_hash, is_active, must_change_password, is_demo, password_changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
    [
      data.roleId,
      data.branchId || null,
      data.fullName,
      data.email.toLowerCase(),
      data.phone || null,
      data.passwordHash,
      data.isActive === false ? 0 : 1,
      data.mustChangePassword ? 1 : 0,
      data.isDemo ? 1 : 0,
    ],
    conn,
  );
  return result.insertId;
}

async function update(id, data, conn) {
  const fields = [];
  const params = [];
  const map = {
    fullName: 'full_name',
    email: 'email',
    phone: 'phone',
    roleId: 'role_id',
    branchId: 'branch_id',
    avatar: 'avatar',
  };
  for (const [key, column] of Object.entries(map)) {
    if (data[key] !== undefined) {
      fields.push(`${column} = ?`);
      params.push(key === 'email' ? data.email.toLowerCase() : data[key] === '' ? null : data[key]);
    }
  }
  if (data.isActive !== undefined) {
    fields.push('is_active = ?');
    params.push(data.isActive ? 1 : 0);
  }
  if (!fields.length) return;
  params.push(id);
  await db.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params, conn);
}

async function setPassword(id, passwordHash, { mustChange = false } = {}, conn) {
  await db.query(
    `UPDATE users SET password_hash = ?, must_change_password = ?, password_changed_at = UTC_TIMESTAMP(),
            failed_login_attempts = 0, locked_until = NULL
     WHERE id = ?`,
    [passwordHash, mustChange ? 1 : 0, id],
    conn,
  );
}

async function countActiveSuperAdmins(excludeUserId = 0) {
  const row = await db.queryOne(
    `SELECT COUNT(*) AS total FROM users u JOIN roles r ON r.id = u.role_id
     WHERE r.slug = 'super_admin' AND u.is_active = 1 AND u.id <> ?`,
    [excludeUserId],
  );
  return Number(row.total);
}

module.exports = {
  findAuthByEmail,
  findAuthById,
  findById,
  emailExists,
  list,
  insert,
  update,
  setPassword,
  countActiveSuperAdmins,
};
