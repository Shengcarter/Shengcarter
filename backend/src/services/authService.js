'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const { sha256, randomToken } = require('../utils/crypto');
const userModel = require('../models/userModel');
const permissionService = require('./permissionService');
const branchService = require('./branchService');
const settings = require('./settingsService');
const messaging = require('./messaging');
const audit = require('./auditService');

// Used to keep response time constant when the email does not exist,
// so attackers cannot discover which accounts exist by timing logins.
const DUMMY_HASH = bcrypt.hashSync('zola-timing-equalizer', 10);
// Grace window for concurrent refreshes from several tabs using one token.
const REUSE_GRACE_SECONDS = 30;
const RESET_TOKEN_MINUTES = 60;

function hashPassword(password) {
  return bcrypt.hash(password, config.auth.bcryptRounds);
}

function issueAccessToken(user) {
  return jwt.sign(
    { sub: user.id, type: 'access', mcp: Boolean(user.mustChangePassword) },
    config.auth.jwtSecret,
    { algorithm: 'HS256', expiresIn: config.auth.accessExpiresIn },
  );
}

function refreshLifetimeMs(remember) {
  return remember ? config.auth.refreshTokenDays * 86_400_000 : config.auth.sessionHours * 3_600_000;
}

async function createRefreshToken(userId, { remember, familyId = crypto.randomUUID(), ip, userAgent }, conn) {
  const token = randomToken(48);
  const expiresAt = new Date(Date.now() + refreshLifetimeMs(remember));
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family_id, remember, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, sha256(token), familyId, remember ? 1 : 0, expiresAt, ip || null, userAgent ? String(userAgent).slice(0, 255) : null],
    conn,
  );
  return { token, expiresAt, remember };
}

/** Everything the frontend needs about the signed-in user. */
async function buildSession(userId, branchId = null) {
  const user = await userModel.findById(userId);
  const permissionSet = await permissionService.getRolePermissions(user.roleId);
  const isSuperAdmin = user.roleSlug === 'super_admin';
  const permissions = isSuperAdmin
    ? (await db.query('SELECT code FROM permissions ORDER BY code')).map((p) => p.code)
    : [...permissionSet].sort();

  const canSwitchBranch = isSuperAdmin || permissionSet.has('branches.manage');
  const allBranches = await branchService.list({ includeInactive: false });
  const branches = canSwitchBranch ? allBranches : allBranches.filter((b) => b.id === user.branchId);
  const defaultBranch = await branchService.getDefaultBranch();

  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      role: { id: user.roleId, slug: user.roleSlug, name: user.roleName },
      branchId: user.branchId,
      employeeId: user.employeeId,
      mustChangePassword: user.mustChangePassword,
      isSuperAdmin,
    },
    permissions,
    canSwitchBranch,
    branches: branches.map((b) => ({ id: b.id, code: b.code, name: b.name, isDefault: b.isDefault })),
    currentBranchId: branchId || user.branchId || defaultBranch?.id || null,
    settings: settings.getPublicSettings(),
  };
}

async function login({ email, password, remember }, meta) {
  const account = await userModel.findAuthByEmail(email);

  if (!account) {
    await bcrypt.compare(password, DUMMY_HASH);
    await audit.record({ ip: meta.ip, userAgent: meta.userAgent }, {
      action: 'auth.login_failed',
      description: 'Login failed for unknown email',
      metadata: { email: String(email).slice(0, 150) },
    });
    throw ApiError.unauthorized('Invalid email or password', { code: 'INVALID_CREDENTIALS' });
  }

  const ctx = { userId: account.id, ip: meta.ip, userAgent: meta.userAgent };

  if (account.locked_until && new Date(account.locked_until) > new Date()) {
    const minutes = Math.ceil((new Date(account.locked_until) - Date.now()) / 60_000);
    throw ApiError.locked(`Account temporarily locked after too many failed attempts. Try again in ${minutes} minute(s).`, { code: 'ACCOUNT_LOCKED' });
  }

  const valid = await bcrypt.compare(password, account.password_hash);
  if (!valid) {
    const attempts = account.failed_login_attempts + 1;
    const lock = attempts >= config.auth.maxLoginAttempts;
    await db.query(
      `UPDATE users SET failed_login_attempts = ?, locked_until = ${lock ? 'DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE)' : 'NULL'} WHERE id = ?`,
      lock ? [0, config.auth.lockMinutes, account.id] : [attempts, account.id],
    );
    await audit.record(ctx, {
      action: lock ? 'auth.account_locked' : 'auth.login_failed',
      entityType: 'user',
      entityId: account.id,
      description: lock ? `Account locked for ${config.auth.lockMinutes} minutes after repeated failed logins` : 'Incorrect password',
    });
    if (lock) {
      throw ApiError.locked(`Too many failed attempts. Your account is locked for ${config.auth.lockMinutes} minutes.`, { code: 'ACCOUNT_LOCKED' });
    }
    throw ApiError.unauthorized('Invalid email or password', { code: 'INVALID_CREDENTIALS' });
  }

  if (!account.is_active) throw ApiError.forbidden('Your account has been deactivated. Contact your administrator.', { code: 'ACCOUNT_INACTIVE' });

  const refresh = await db.withTransaction(async (conn) => {
    await db.query(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = UTC_TIMESTAMP(), last_login_ip = ? WHERE id = ?',
      [meta.ip || null, account.id],
      conn,
    );
    await audit.record(ctx, { action: 'auth.login', entityType: 'user', entityId: account.id, description: `${account.full_name} logged in` }, conn);
    return createRefreshToken(account.id, { remember, ip: meta.ip, userAgent: meta.userAgent }, conn);
  });

  const session = await buildSession(account.id);
  return { accessToken: issueAccessToken(session.user), refresh, session };
}

/**
 * Rotate a refresh token. Reusing an already-rotated token (outside a short
 * grace window) indicates theft, so the whole token family is revoked.
 */
async function refresh(token, meta) {
  if (!token) throw ApiError.unauthorized('Session expired. Please sign in again.', { code: 'NO_REFRESH_TOKEN' });
  const hash = sha256(token);

  const result = await db.withTransaction(async (conn) => {
    const row = await db.queryOne(
      `SELECT rt.*, TIMESTAMPDIFF(SECOND, rt.revoked_at, UTC_TIMESTAMP()) AS revoked_seconds_ago
       FROM refresh_tokens rt WHERE token_hash = ? FOR UPDATE`,
      [hash],
      conn,
    );
    if (!row || new Date(row.expires_at) <= new Date()) {
      throw ApiError.unauthorized('Session expired. Please sign in again.', { code: 'REFRESH_EXPIRED' });
    }
    if (row.revoked_at) {
      if (row.revoked_seconds_ago !== null && row.revoked_seconds_ago <= REUSE_GRACE_SECONDS) {
        return { userId: row.user_id, rotated: null };
      }
      await db.query('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE family_id = ? AND revoked_at IS NULL', [row.family_id], conn);
      await audit.record({ userId: row.user_id, ip: meta.ip, userAgent: meta.userAgent }, {
        action: 'auth.token_reuse_detected',
        entityType: 'user',
        entityId: row.user_id,
        description: 'A revoked session token was reused; all sessions in the family were signed out',
      }, conn);
      throw ApiError.unauthorized('Session expired. Please sign in again.', { code: 'REFRESH_REUSED' });
    }

    const user = await userModel.findAuthById(row.user_id, conn);
    if (!user || !user.is_active) throw ApiError.unauthorized('Account is not active', { code: 'ACCOUNT_INACTIVE' });

    await db.query('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE id = ?', [row.id], conn);
    const rotated = await createRefreshToken(row.user_id, {
      remember: Boolean(row.remember),
      familyId: row.family_id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    }, conn);
    return { userId: row.user_id, rotated };
  });

  const session = await buildSession(result.userId, meta.branchId);
  return { accessToken: issueAccessToken(session.user), refresh: result.rotated, session };
}

async function logout(token, ctx) {
  if (token) {
    const row = await db.queryOne('SELECT family_id, user_id FROM refresh_tokens WHERE token_hash = ?', [sha256(token)]);
    if (row) {
      await db.query('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE family_id = ? AND revoked_at IS NULL', [row.family_id]);
      await audit.record({ ...ctx, userId: ctx?.userId || row.user_id }, { action: 'auth.logout', entityType: 'user', entityId: row.user_id, description: 'Logged out' });
    }
  }
}

async function changePassword(userId, { currentPassword, newPassword }, ctx, currentRefreshToken) {
  const account = await userModel.findAuthById(userId);
  if (!account) throw ApiError.notFound('User not found');
  if (!(await bcrypt.compare(currentPassword, account.password_hash))) {
    throw ApiError.validation([{ field: 'currentPassword', message: 'Current password is incorrect' }]);
  }
  if (await bcrypt.compare(newPassword, account.password_hash)) {
    throw ApiError.validation([{ field: 'newPassword', message: 'The new password must be different from the current password' }]);
  }
  const passwordHash = await hashPassword(newPassword);
  const currentFamily = currentRefreshToken
    ? (await db.queryOne('SELECT family_id FROM refresh_tokens WHERE token_hash = ?', [sha256(currentRefreshToken)]))?.family_id
    : null;

  await db.withTransaction(async (conn) => {
    await userModel.setPassword(userId, passwordHash, { mustChange: false }, conn);
    // Sign out every other device; keep the current session alive.
    await db.query(
      'UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL AND family_id <> ?',
      [userId, currentFamily || ''],
      conn,
    );
    await audit.record(ctx, { action: 'auth.password_changed', entityType: 'user', entityId: userId, description: 'Password changed' }, conn);
  });

  const session = await buildSession(userId, ctx.branchId);
  return { accessToken: issueAccessToken(session.user), session };
}

/** Always resolves the same way so the response never reveals whether an account exists. */
async function forgotPassword(email, meta) {
  const account = await userModel.findAuthByEmail(email);
  if (!account || !account.is_active) return;

  const token = randomToken(32);
  await db.query(
    'INSERT INTO password_resets (user_id, token_hash, expires_at, requested_ip) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE), ?)',
    [account.id, sha256(token), RESET_TOKEN_MINUTES, meta.ip || null],
  );
  const link = `${config.appUrl}/reset-password?token=${token}`;
  const body = [
    `Hello ${account.full_name},`,
    '',
    `A password reset was requested for your ${config.appName} account.`,
    `Open this link within ${RESET_TOKEN_MINUTES} minutes to choose a new password:`,
    link,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  try {
    await settings.ensureFresh();
    const result = await messaging.sendNow({ channel: 'email', to: account.email, subject: `${config.appName} — Password reset`, body });
    if (result.provider === 'log') {
      logger.warn({ userId: account.id }, 'Email is not configured: password reset link was written to the log above. Configure SMTP in Settings → Integrations, or have an administrator reset the password from Settings → Users.');
    }
  } catch (error) {
    logger.error({ err: error, userId: account.id }, 'Failed to send password reset email');
  }
  await audit.record({ userId: account.id, ip: meta.ip, userAgent: meta.userAgent }, {
    action: 'auth.password_reset_requested', entityType: 'user', entityId: account.id, description: 'Password reset requested',
  });
}

async function resetPassword({ token, password }, meta) {
  const row = await db.queryOne(
    'SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP()',
    [sha256(token)],
  );
  if (!row) throw ApiError.badRequest('This password reset link is invalid or has expired. Please request a new one.', { code: 'INVALID_RESET_TOKEN' });

  const passwordHash = await hashPassword(password);
  await db.withTransaction(async (conn) => {
    await userModel.setPassword(row.user_id, passwordHash, { mustChange: false }, conn);
    await db.query('UPDATE password_resets SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL', [row.user_id], conn);
    await db.query('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE user_id = ? AND revoked_at IS NULL', [row.user_id], conn);
    await audit.record({ userId: row.user_id, ip: meta.ip, userAgent: meta.userAgent }, {
      action: 'auth.password_reset', entityType: 'user', entityId: row.user_id, description: 'Password reset with emailed link',
    }, conn);
  });
}

module.exports = {
  hashPassword,
  issueAccessToken,
  buildSession,
  login,
  refresh,
  logout,
  changePassword,
  forgotPassword,
  resetPassword,
};
