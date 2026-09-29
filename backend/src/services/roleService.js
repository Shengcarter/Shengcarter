'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { camelizeRow } = require('../utils/case');
const permissionService = require('./permissionService');
const audit = require('./auditService');

async function listPermissions() {
  const rows = await db.query('SELECT code, module, description FROM permissions ORDER BY module, code');
  const modules = {};
  for (const row of rows) {
    modules[row.module] = modules[row.module] || [];
    modules[row.module].push({ code: row.code, description: row.description });
  }
  return Object.entries(modules).map(([module, permissions]) => ({ module, permissions }));
}

async function list() {
  const roles = await db.query(
    `SELECT r.id, r.slug, r.name, r.description, r.is_system,
            (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) AS user_count
     FROM roles r ORDER BY r.is_system DESC, r.id`,
  );
  const grants = await db.query(
    'SELECT rp.role_id, p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id',
  );
  return roles.map((role) => ({
    ...camelizeRow(role),
    permissions: grants.filter((g) => g.role_id === role.id).map((g) => g.code).sort(),
  }));
}

async function getById(id) {
  const role = (await list()).find((r) => r.id === Number(id));
  if (!role) throw ApiError.notFound('Role not found');
  return role;
}

async function resolvePermissionIds(codes, conn) {
  if (!codes.length) return [];
  const rows = await db.query('SELECT id, code FROM permissions WHERE code IN (?)', [codes], conn);
  const unknown = codes.filter((c) => !rows.some((r) => r.code === c));
  if (unknown.length) throw ApiError.validation([{ field: 'permissions', message: `Unknown permissions: ${unknown.join(', ')}` }]);
  return rows.map((r) => r.id);
}

async function setPermissions(roleId, codes, conn) {
  const ids = await resolvePermissionIds([...new Set(codes)], conn);
  await db.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId], conn);
  if (ids.length) {
    await db.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [ids.map((pid) => [roleId, pid])], conn);
  }
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 50);
}

async function create(data, ctx) {
  const slug = slugify(data.name);
  if (!slug) throw ApiError.validation([{ field: 'name', message: 'Enter a valid role name' }]);
  const exists = await db.queryOne('SELECT id FROM roles WHERE slug = ? OR name = ?', [slug, data.name]);
  if (exists) throw ApiError.validation([{ field: 'name', message: 'A role with this name already exists' }]);

  const id = await db.withTransaction(async (conn) => {
    const result = await db.query('INSERT INTO roles (slug, name, description, is_system) VALUES (?, ?, ?, 0)', [slug, data.name, data.description || null], conn);
    await setPermissions(result.insertId, data.permissions, conn);
    await audit.record(ctx, {
      action: 'role.created', entityType: 'role', entityId: result.insertId,
      description: `Created role ${data.name}`, metadata: { permissions: data.permissions },
    }, conn);
    return result.insertId;
  });
  permissionService.clearCache();
  return getById(id);
}

async function update(id, data, ctx) {
  const role = await getById(id);
  if (role.slug === 'super_admin' && data.permissions) {
    throw ApiError.badRequest('Super Admin always has every permission and cannot be changed');
  }
  if (data.name && data.name !== role.name) {
    const exists = await db.queryOne('SELECT id FROM roles WHERE name = ? AND id <> ?', [data.name, id]);
    if (exists) throw ApiError.validation([{ field: 'name', message: 'A role with this name already exists' }]);
  }

  await db.withTransaction(async (conn) => {
    await db.query('UPDATE roles SET name = ?, description = ? WHERE id = ?', [
      role.isSystem ? role.name : data.name ?? role.name,
      data.description !== undefined ? data.description : role.description,
      id,
    ], conn);
    if (data.permissions) {
      await setPermissions(id, data.permissions, conn);
      const added = data.permissions.filter((p) => !role.permissions.includes(p));
      const removed = role.permissions.filter((p) => !data.permissions.includes(p));
      await audit.record(ctx, {
        action: 'role.permissions_changed', entityType: 'role', entityId: id,
        description: `Changed permissions of role ${role.name}`, metadata: { added, removed },
      }, conn);
    }
  });
  permissionService.clearCache();
  return getById(id);
}

async function remove(id, ctx) {
  const role = await getById(id);
  if (role.isSystem) throw ApiError.badRequest('Built-in roles cannot be deleted');
  if (role.userCount > 0) throw ApiError.conflict('This role is assigned to users. Move them to another role first.');
  await db.withTransaction(async (conn) => {
    await db.query('DELETE FROM roles WHERE id = ?', [id], conn);
    await audit.record(ctx, { action: 'role.deleted', entityType: 'role', entityId: id, description: `Deleted role ${role.name}` }, conn);
  });
  permissionService.clearCache();
}

module.exports = { list, getById, listPermissions, create, update, remove };
