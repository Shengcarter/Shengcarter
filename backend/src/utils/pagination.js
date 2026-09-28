'use strict';

const db = require('../config/database');

const MAX_LIMIT = 100;

function getPaging({ page = 1, limit = 20 } = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safeLimit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(limit, 10) || 20));
  return { page: safePage, limit: safeLimit, offset: (safePage - 1) * safeLimit };
}

function buildPagination(total, { page, limit }) {
  return {
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

/**
 * Resolve a user-supplied sort key against a whitelist of SQL expressions.
 * Column names can never be parameterized, so only whitelisted values are
 * ever placed in ORDER BY.
 */
function getSort(sortBy, sortOrder, allowed, fallbackKey) {
  const column = allowed[sortBy] || allowed[fallbackKey];
  const direction = String(sortOrder).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  return `${column} ${direction}`;
}

/**
 * Run a paginated list query. `from` holds the FROM / JOIN / WHERE clauses
 * (no ORDER BY / LIMIT); `countFrom` can override it for the COUNT query.
 */
async function paginate({ select, from, countFrom, params = [], orderBy, paging }) {
  const countRow = await db.queryOne(`SELECT COUNT(*) AS total ${countFrom || from}`, params);
  const rows = await db.query(
    `SELECT ${select} ${from} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, paging.limit, paging.offset],
  );
  return { rows, pagination: buildPagination(Number(countRow.total), paging) };
}

module.exports = { getPaging, buildPagination, getSort, paginate, MAX_LIMIT };
