'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const userModel = require('../models/userModel');
const authService = require('./authService');
const audit = require('./auditService');

async function getById(id) {
  const user = await userModel.findById(id);
  if (!user) throw ApiError.notFound('User not found');
  return user;
}

async function assertRoleExists(roleId) {
  const role = await db.queryOne('SELECT id, slug FROM roles WHERE id = ?', [roleId]);
  if (!role) throw ApiError.validation([{ field: 'roleId', message: 'Role does not exist' }]);
  return role;
}

async function assertBranchExists(branchId) {
  if (!branchId) return;
  const branch = await db.queryOne('SELECT id FROM branches WHERE id = ?', [branchId]);
  if (!branch) throw ApiError.validation([{ field: 'branchId', message: 'Branch does not exist' }]);
}

/** Link (or unlink) the employee profile that belongs to a user account. */
async function linkEmployee(userId, employeeId, conn) {
  if (employeeId === undefined) return;
  await db.query('UPDATE employees SET user_id = NULL WHERE user_id = ?', [userId], conn);
  if (employeeId) {
    const employee = await db.queryOne('SELECT id, user_id FROM employees WHERE id = ?', [employeeId], conn);
    if (!employee) throw ApiError.validation([{ field: 'employeeId', message: 'Employee does not exist' }]);
    if (employee.user_id && employee.user_id !== userId) {
      throw ApiError.validation([{ field: 'employeeId', message: 'This employee is already linked to another user' }]);
    }
    await db.query('UPDATE employees SET user_id = ? WHERE id = ?', [userId, employeeId], conn);
  }
}

async function create(data, ctx) {
  await assertRoleExists(data.roleId);
  await assertBranchExists(data.branchId);
  if (await userModel.emailExists(data.email)) {
    throw ApiError.validation([{ field: 'email', message: 'A user with this email already exists' }]);
  }
  const passwordHash = await authService.hashPassword(data.password);

  const id = await db.withTransaction(async (conn) => {
    const userId = await userModel.insert({ ...data, passwordHash, mustChangePassword: true }, conn);
    await linkEmployee(userId, data.employeeId, conn);
    await audit.record(ctx, {
      action: 'user.created',
      entityType: 'user',
      entityId: userId,
      description: `Created user ${data.fullName} (${data.email})`,
      metadata: { roleId: data.roleId, branchId: data.branchId || null },
    }, conn);
    return userId;
  });
  return getById(id);
}

async function update(id, data, ctx) {
  const existing = await getById(id);
  if (data.roleId) await assertRoleExists(data.roleId);
  if (data.branchId) await assertBranchExists(data.branchId);
  if (data.email && data.email !== existing.email && (await userModel.emailExists(data.email, id))) {
    throw ApiError.validation([{ field: 'email', message: 'A user with this email already exists' }]);
  }

  const losingAdmin = existing.roleSlug === 'super_admin'
    && ((data.roleId && data.roleId !== existing.roleId) || data.isActive === false);
  if (losingAdmin && (await userModel.countActiveSuperAdmins(id)) === 0) {
    throw ApiError.badRequest('This is the last active Super Admin. Create another Super Admin first.');
  }
  if (id === ctx.userId && data.isActive === false) throw ApiError.badRequest('You cannot deactivate your own account');
  if (id === ctx.userId && data.roleId && data.roleId !== existing.roleId) throw ApiError.badRequest('You cannot change your own role');

  await db.withTransaction(async (conn) => {
    await userModel.update(id, data, conn);
    await linkEmployee(id, data.employeeId, conn);
    if (data.isActive === false) {
      await db.query("UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(), revoked_reason = 'admin' WHERE user_id = ? AND revoked_at IS NULL", [id], conn);
    }
    const roleChanged = data.roleId && data.roleId !== existing.roleId;
    await audit.record(ctx, {
      action: roleChanged ? 'user.permission_changed' : 'user.updated',
      entityType: 'user',
      entityId: id,
      description: roleChanged ? `Changed role of ${existing.fullName}` : `Updated user ${existing.fullName}`,
      metadata: roleChanged ? { fromRoleId: existing.roleId, toRoleId: data.roleId } : { fields: Object.keys(data) },
    }, conn);
  });
  return getById(id);
}

/** Administrator sets a temporary password; the user must change it at next login. */
async function resetPassword(id, password, ctx) {
  const user = await getById(id);
  const passwordHash = await authService.hashPassword(password);
  await db.withTransaction(async (conn) => {
    await userModel.setPassword(id, passwordHash, { mustChange: true }, conn);
    await db.query("UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(), revoked_reason = 'admin' WHERE user_id = ? AND revoked_at IS NULL", [id], conn);
    await audit.record(ctx, { action: 'user.password_reset', entityType: 'user', entityId: id, description: `Reset password for ${user.fullName}` }, conn);
  });
}

async function unlock(id, ctx) {
  const user = await getById(id);
  await db.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?', [id]);
  await audit.record(ctx, { action: 'user.unlocked', entityType: 'user', entityId: id, description: `Unlocked ${user.fullName}` });
}

async function updateAvatar(userId, publicPath, ctx) {
  const user = await getById(userId);
  await userModel.update(userId, { avatar: publicPath });
  await audit.record(ctx, { action: 'user.avatar_updated', entityType: 'user', entityId: userId, description: 'Updated profile photo' });
  return user.avatar;
}

module.exports = { list: userModel.list, getById, create, update, resetPassword, unlock, updateAvatar };
