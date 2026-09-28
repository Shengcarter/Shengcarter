'use strict';

const db = require('../config/database');

/**
 * Role → permission lookup with a short in-memory cache. The cache is cleared
 * whenever role permissions change; the TTL keeps multiple server processes
 * (PM2 cluster) consistent within a few seconds.
 */
const CACHE_TTL_MS = 30_000;
const cache = new Map();

async function getRolePermissions(roleId) {
  const hit = cache.get(roleId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.permissions;

  const rows = await db.query(
    `SELECT p.code FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ?`,
    [roleId],
  );
  const permissions = new Set(rows.map((r) => r.code));
  cache.set(roleId, { permissions, at: Date.now() });
  return permissions;
}

function clearCache() {
  cache.clear();
}

module.exports = { getRolePermissions, clearCache };
