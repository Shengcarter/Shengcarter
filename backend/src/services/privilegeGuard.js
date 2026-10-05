'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');

/**
 * No one can give more rights than they hold themselves. A person who may
 * manage users or roles but is not the Super Admin (for example a custom
 * "Manager" role):
 *   • cannot create or promote a Super Admin, nor change, reset, unlock or
 *     reset two-step sign-in for a Super Admin account;
 *   • cannot give anyone a role that has permissions they do not have, nor
 *     manage someone whose role has such permissions;
 *   • cannot add to a role permissions they do not have, nor edit or delete a
 *     role that has such permissions.
 * The Super Admin may do all of it.
 */
const holds = (ctx, code) => Boolean(ctx.user?.isSuperAdmin || ctx.user?.permissions?.has(code));

async function roleInfo(roleId, conn) {
  const role = await db.queryOne('SELECT id, slug, name FROM roles WHERE id = ?', [roleId], conn);
  if (!role) return null;
  const rows = await db.query(
    'SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ?',
    [roleId],
    conn,
  );
  return { ...role, permissions: rows.map((r) => r.code) };
}

function missingFor(ctx, permissions) {
  return permissions.filter((code) => !holds(ctx, code));
}

/** May this person give `roleId` to someone (new user or role change)? */
async function assertCanAssignRole(ctx, roleId) {
  if (ctx.user?.isSuperAdmin) return;
  const role = await roleInfo(roleId);
  if (!role) return; // "role does not exist" is reported by the caller
  if (role.slug === 'super_admin') throw ApiError.forbidden('Only a Super Admin can make someone a Super Admin.');
  const missing = missingFor(ctx, role.permissions);
  if (missing.length) {
    throw ApiError.forbidden(`The role ${role.name} has permissions you do not have yourself (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}), so you cannot give it.`);
  }
}

/** May this person change, reset, unlock or reset two-step sign-in for `target` (a user from userModel)? */
async function assertCanManageUser(ctx, target) {
  if (ctx.user?.isSuperAdmin) return;
  if (target.roleSlug === 'super_admin') throw ApiError.forbidden('Only a Super Admin can change a Super Admin account.');
  const role = await roleInfo(target.roleId);
  if (role && missingFor(ctx, role.permissions).length) {
    throw ApiError.forbidden(`${target.fullName} has rights you do not have yourself, so only someone with at least those rights can change this account.`);
  }
}

/** May this person put these permissions into a role? */
function assertCanGrant(ctx, permissions = []) {
  if (ctx.user?.isSuperAdmin) return;
  const missing = missingFor(ctx, permissions);
  if (missing.length) {
    throw ApiError.forbidden(`You cannot give permissions you do not have yourself: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}.`);
  }
}

/** May this person edit or delete this role (it must not hold rights they lack)? */
async function assertCanEditRole(ctx, roleId) {
  if (ctx.user?.isSuperAdmin) return;
  const role = await roleInfo(roleId);
  if (!role) return;
  if (role.slug === 'super_admin' || missingFor(ctx, role.permissions).length) {
    throw ApiError.forbidden(`The role ${role.name} has permissions you do not have yourself, so you cannot change it.`);
  }
}

module.exports = { assertCanAssignRole, assertCanManageUser, assertCanGrant, assertCanEditRole };
