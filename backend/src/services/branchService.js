'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { camelizeRow, camelizeRows } = require('../utils/case');
const audit = require('./auditService');

/**
 * Branches. A single-branch installation simply has the default "Main Branch";
 * everything branch-aware keeps working unchanged when more branches are added.
 */
const CACHE_TTL_MS = 30_000;
let cache = { rows: null, at: 0 };

async function allBranches() {
  if (cache.rows && Date.now() - cache.at < CACHE_TTL_MS) return cache.rows;
  const rows = await db.query('SELECT id, code, name, phone, email, address, is_default, is_active FROM branches ORDER BY is_default DESC, name');
  cache = { rows, at: Date.now() };
  return rows;
}

function clearCache() {
  cache = { rows: null, at: 0 };
}

async function getActiveBranch(id) {
  const rows = await allBranches();
  return rows.find((b) => b.id === Number(id) && b.is_active) || null;
}

async function getDefaultBranch() {
  const rows = await allBranches();
  return rows.find((b) => b.is_default && b.is_active) || rows.find((b) => b.is_active) || null;
}

async function list({ includeInactive = true } = {}) {
  const rows = await db.query(
    `SELECT b.id, b.code, b.name, b.phone, b.email, b.address, b.is_default, b.is_active, b.created_at,
            (SELECT COUNT(*) FROM employees e WHERE e.branch_id = b.id AND e.status <> 'terminated') AS employee_count,
            (SELECT COUNT(*) FROM users u WHERE u.branch_id = b.id AND u.is_active = 1) AS user_count
     FROM branches b
     ${includeInactive ? '' : 'WHERE b.is_active = 1'}
     ORDER BY b.is_default DESC, b.name`,
  );
  return camelizeRows(rows);
}

async function getById(id) {
  const row = await db.queryOne('SELECT id, code, name, phone, email, address, is_default, is_active, created_at FROM branches WHERE id = ?', [id]);
  if (!row) throw ApiError.notFound('Branch not found');
  return camelizeRow(row);
}

async function create(data, ctx) {
  const id = await db.withTransaction(async (conn) => {
    const result = await db.query(
      'INSERT INTO branches (code, name, phone, email, address, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [data.code.toUpperCase(), data.name, data.phone || null, data.email || null, data.address || null, data.isActive === false ? 0 : 1],
      conn,
    );
    await audit.record(ctx, { action: 'branch.created', entityType: 'branch', entityId: result.insertId, description: `Created branch ${data.name}` }, conn);
    return result.insertId;
  });
  clearCache();
  return getById(id);
}

async function update(id, data, ctx) {
  const existing = await getById(id);
  if (data.isActive === false && existing.isDefault) {
    throw ApiError.badRequest('The default branch cannot be deactivated. Make another branch the default first.');
  }
  await db.withTransaction(async (conn) => {
    if (data.isDefault === true) {
      if (data.isActive === false || (!existing.isActive && data.isActive !== true)) {
        throw ApiError.badRequest('An inactive branch cannot be the default branch');
      }
      await db.query('UPDATE branches SET is_default = 0 WHERE id <> ?', [id], conn);
    }
    await db.query(
      `UPDATE branches SET code = ?, name = ?, phone = ?, email = ?, address = ?, is_active = ?, is_default = ?
       WHERE id = ?`,
      [
        (data.code ?? existing.code).toUpperCase(),
        data.name ?? existing.name,
        data.phone !== undefined ? data.phone || null : existing.phone,
        data.email !== undefined ? data.email || null : existing.email,
        data.address !== undefined ? data.address || null : existing.address,
        data.isActive !== undefined ? (data.isActive ? 1 : 0) : existing.isActive ? 1 : 0,
        data.isDefault === true ? 1 : existing.isDefault ? 1 : 0,
        id,
      ],
      conn,
    );
    await audit.record(ctx, { action: 'branch.updated', entityType: 'branch', entityId: id, description: `Updated branch ${data.name ?? existing.name}` }, conn);
  });
  clearCache();
  return getById(id);
}

module.exports = { list, getById, create, update, getActiveBranch, getDefaultBranch, clearCache };
