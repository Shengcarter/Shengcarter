'use strict';

const db = require('../config/database');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const { camelizeRows } = require('../utils/case');
const { getPaging, paginate } = require('../utils/pagination');

/**
 * In-app notifications. One row is stored per recipient so each user has
 * their own read/unread state. Recipients are chosen by permission and branch.
 */

async function insertForUsers(userIds, { type, category = 'system', title, message, link = null, data = null, branchId = null }, conn) {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (!unique.length) return 0;
  await db.query(
    'INSERT INTO notifications (user_id, branch_id, type, category, title, message, link, data) VALUES ?',
    [unique.map((userId) => [userId, branchId, type, category, title.slice(0, 150), message.slice(0, 500), link, data ? JSON.stringify(data) : null])],
    conn,
  );
  return unique.length;
}

/**
 * Notify active users who hold `permission` (any of, if an array) and work in
 * `branchId`. Super Admins are always included. When `dedupeKey` is given,
 * an identical unread notification from the last 24 hours suppresses it.
 */
async function notifyByPermission({ permission, branchId = null, dedupeKey = null, ...notification }, conn = null) {
  const permissions = Array.isArray(permission) ? permission : [permission];
  try {
    if (dedupeKey) {
      const existing = await db.queryOne(
        `SELECT id FROM notifications
         WHERE type = ? AND read_at IS NULL AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
           AND JSON_UNQUOTE(JSON_EXTRACT(data, '$.dedupeKey')) = ?
         LIMIT 1`,
        [notification.type, dedupeKey],
        conn,
      );
      if (existing) return 0;
    }
    const users = await db.query(
      `SELECT DISTINCT u.id FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE u.is_active = 1
         AND (r.slug = 'super_admin' OR (p.code IN (?) AND (u.branch_id = ? OR u.branch_id IS NULL OR ? IS NULL)))`,
      [permissions, branchId, branchId],
      conn,
    );
    return insertForUsers(users.map((u) => u.id), {
      ...notification,
      branchId,
      data: dedupeKey ? { ...(notification.data || {}), dedupeKey } : notification.data,
    }, conn);
  } catch (error) {
    // Notifications must never break the business operation that triggered them
    // unless they are part of the same transaction.
    if (conn) throw error;
    logger.error({ err: error, type: notification.type }, 'Failed to create notification');
    return 0;
  }
}

async function notifyUser(userId, notification, conn = null) {
  return insertForUsers([userId], notification, conn);
}

async function list(userId, filters) {
  const where = ['n.user_id = ?'];
  const params = [userId];
  if (filters.unreadOnly) where.push('n.read_at IS NULL');
  if (filters.category) {
    where.push('n.category = ?');
    params.push(filters.category);
  }
  const result = await paginate({
    select: 'n.id, n.type, n.category, n.title, n.message, n.link, n.data, n.read_at, n.created_at, b.name AS branch_name',
    from: `FROM notifications n LEFT JOIN branches b ON b.id = n.branch_id WHERE ${where.join(' AND ')}`,
    params,
    orderBy: 'n.created_at DESC, n.id DESC',
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows) };
}

async function unreadCount(userId) {
  const row = await db.queryOne('SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL', [userId]);
  return Number(row.count);
}

async function markRead(userId, id) {
  const result = await db.query('UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP()) WHERE id = ? AND user_id = ?', [id, userId]);
  if (!result.affectedRows) throw ApiError.notFound('Notification not found');
}

async function markAllRead(userId) {
  const result = await db.query('UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND read_at IS NULL', [userId]);
  return result.affectedRows;
}

/** Remove read notifications older than 90 days (called by a daily job). */
async function prune() {
  await db.query('DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY)');
}

module.exports = { notifyByPermission, notifyUser, list, unreadCount, markRead, markAllRead, prune };
