'use strict';

const db = require('../config/database');
const logger = require('../config/logger');
const { getPaging, getSort, paginate } = require('../utils/pagination');

/**
 * Activity (audit) log. Pass the transaction connection when recording as part
 * of a business operation so the log entry commits or rolls back with it.
 * `before` / `after` keep the previous and new values of what changed; the IP
 * address and device (browser user agent) come from the request.
 */
async function record(ctx, { action, entityType = null, entityId = null, description = null, metadata = null, before = null, after = null }, conn = null) {
  const params = [
    ctx?.userId || null,
    ctx?.branchId || null,
    action,
    entityType,
    entityId,
    description ? String(description).slice(0, 500) : null,
    metadata ? JSON.stringify(metadata) : null,
    before === null || before === undefined ? null : JSON.stringify(before),
    after === null || after === undefined ? null : JSON.stringify(after),
    ctx?.ip || null,
    ctx?.userAgent ? String(ctx.userAgent).slice(0, 255) : null,
  ];
  const sql = `INSERT INTO activity_logs (user_id, branch_id, action, entity_type, entity_id, description, metadata, old_values, new_values, ip_address, user_agent)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  if (conn) {
    await db.query(sql, params, conn);
    return;
  }
  // Outside a transaction an audit failure must never break the request.
  try {
    await db.query(sql, params);
  } catch (error) {
    logger.error({ err: error, action }, 'Failed to write activity log');
  }
}

const SORTS = { createdAt: 'a.created_at', action: 'a.action' };

async function list(filters) {
  const paging = getPaging(filters);
  const where = ['1=1'];
  const params = [];
  if (filters.userId) {
    where.push('a.user_id = ?');
    params.push(filters.userId);
  }
  if (filters.action) {
    where.push('a.action LIKE ?');
    params.push(`${filters.action}%`);
  }
  if (filters.entityType) {
    where.push('a.entity_type = ?');
    params.push(filters.entityType);
  }
  if (filters.from) {
    where.push('a.created_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('a.created_at < ?');
    params.push(filters.to);
  }
  if (filters.search) {
    where.push('(a.description LIKE ? OR u.full_name LIKE ?)');
    params.push(`%${filters.search}%`, `%${filters.search}%`);
  }

  return paginate({
    select: `a.id, a.action, a.entity_type AS entityType, a.entity_id AS entityId, a.description,
             a.metadata, a.old_values AS oldValues, a.new_values AS newValues, a.ip_address AS ipAddress,
             a.user_agent AS device, a.created_at AS createdAt,
             u.id AS userId, u.full_name AS userName, b.name AS branchName`,
    from: `FROM activity_logs a
           LEFT JOIN users u ON u.id = a.user_id
           LEFT JOIN branches b ON b.id = a.branch_id
           WHERE ${where.join(' AND ')}`,
    params,
    orderBy: `${getSort(filters.sortBy, filters.sortOrder, SORTS, 'createdAt')}, a.id DESC`,
    paging,
  });
}

module.exports = { record, list };
