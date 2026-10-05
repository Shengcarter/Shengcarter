'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const { authenticator } = require('otplib');
const config = require('../config');
const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { encrypt, decrypt, sha256 } = require('../utils/crypto');
const settings = require('./settingsService');
const audit = require('./auditService');

/**
 * Two-step sign-in: after the password, a 6-digit code from an authenticator
 * app (Google Authenticator, Microsoft Authenticator, Authy…), standard TOTP
 * (RFC 6238) through the otplib library — no home-made cryptography.
 *
 *   • The secret is stored encrypted (AES-256-GCM); recovery codes only as
 *     SHA-256 hashes of high-entropy random values, each usable once.
 *   • A code is accepted for its own 30-second step or the one before (clock
 *     drift), and never twice: the last accepted step is remembered.
 *   • Wrong codes count as failed sign-ins, so the account locks after
 *     LOGIN_MAX_ATTEMPTS like a wrong password.
 *   • Settings → Security decides who must use it: nobody (optional for
 *     everyone), administrators, or everyone. Administrators are the Super
 *     Admin and anyone who can manage users, roles, settings or backups.
 */

const ADMIN_PERMISSIONS = ['users.manage', 'roles.manage', 'settings.manage', 'backups.manage'];
const RECOVERY_CODES = 10;
const CHALLENGE_MINUTES = 5;
const ISSUER = () => settings.get('business.salon_name') || config.appName;

/** Does the salon's policy require this signed-in user to use two-step sign-in? */
function isRequiredFor(user) {
  const policy = settings.get('security.two_factor_required') || 'none';
  if (policy === 'all') return true;
  if (policy !== 'admins') return false;
  const permissions = user.permissions instanceof Set ? user.permissions : new Set(user.permissions || []);
  return Boolean(user.isSuperAdmin || user.roleSlug === 'super_admin' || ADMIN_PERMISSIONS.some((p) => permissions.has(p)));
}

/** Format a recovery code for people: XXXXX-XXXXX (base32, about 50 bits). */
function newRecoveryCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

const normaliseRecovery = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const hashRecovery = (code) => sha256(`recovery:${normaliseRecovery(code)}`);

async function replaceRecoveryCodes(userId, conn) {
  const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
  await db.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [userId], conn);
  await db.query('INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ?', [codes.map((c) => [userId, hashRecovery(c)])], conn);
  return codes;
}

async function loadUser(userId, conn, { lock = false } = {}) {
  return db.queryOne(
    `SELECT id, email, full_name, password_hash, totp_secret, totp_pending_secret, totp_enabled_at, totp_last_step
     FROM users WHERE id = ?${lock ? ' FOR UPDATE' : ''}`,
    [userId],
    conn,
  );
}

/**
 * Check a 6-digit code against a stored (encrypted) secret, refusing a code
 * already used. Returns the accepted time step, or null.
 */
const STEP_SECONDS = 30;

async function checkCode(encryptedSecret, code, lastStep) {
  const secret = decrypt(encryptedSecret);
  const token = String(code || '').replace(/\s+/g, '');
  if (!secret || !/^\d{6}$/.test(token)) return null;
  const now = Date.now();
  // This step or the one before (clock drift on the phone), checked at one fixed moment.
  const delta = authenticator.clone({ window: [1, 0], epoch: now }).checkDelta(token, secret);
  if (delta === null) return null;
  const step = Math.floor(now / 1000 / STEP_SECONDS) + delta;
  // A code is never accepted twice, nor an older one after a newer was used.
  if (lastStep && step <= Number(lastStep)) return null;
  return step;
}

async function assertPassword(account, password) {
  if (!password || !(await bcrypt.compare(password, account.password_hash))) {
    throw ApiError.validation([{ field: 'password', message: 'Password is incorrect' }]);
  }
}

/** What the profile page shows. */
async function status(user) {
  const row = await db.queryOne(
    `SELECT u.totp_enabled_at, (SELECT COUNT(*) FROM user_recovery_codes c WHERE c.user_id = u.id AND c.used_at IS NULL) AS codes_left
     FROM users u WHERE u.id = ?`,
    [user.id],
  );
  return {
    enabled: Boolean(row.totp_enabled_at),
    enabledAt: row.totp_enabled_at,
    recoveryCodesLeft: Number(row.codes_left),
    required: isRequiredFor(user),
    policy: settings.get('security.two_factor_required') || 'none',
  };
}

/** Step 1 of turning it on: a new secret to scan (not active until a code confirms it). */
async function startSetup(user, { password }, ctx) {
  const account = await loadUser(user.id);
  if (account.totp_enabled_at) throw ApiError.conflict('Two-step sign-in is already on. Turn it off first to use a new phone.');
  // The password again, so a stolen session cannot attach its own phone to the account.
  await assertPassword(account, password);
  const secret = authenticator.generateSecret(20); // 160 bits, as RFC 4226 recommends
  await db.query('UPDATE users SET totp_pending_secret = ? WHERE id = ?', [encrypt(secret), user.id]);
  const uri = authenticator.keyuri(account.email, ISSUER(), secret);
  await audit.record(ctx, { action: 'auth.two_factor_setup_started', entityType: 'user', entityId: user.id, description: 'Started setting up two-step sign-in' });
  return { secret, uri, qrCode: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) };
}

/** Step 2: the first code proves the phone is set up; returns the recovery codes (shown once). */
async function confirmSetup(user, { code }, ctx) {
  const codes = await db.withTransaction(async (conn) => {
    const account = await loadUser(user.id, conn, { lock: true });
    if (account.totp_enabled_at) throw ApiError.conflict('Two-step sign-in is already on');
    if (!account.totp_pending_secret) throw ApiError.badRequest('Start the setup again: scan the code first');
    const step = await checkCode(account.totp_pending_secret, code, null);
    if (!step) throw ApiError.validation([{ field: 'code', message: 'That code is not right. Check the time on your phone and try the newest code.' }]);
    await db.query(
      'UPDATE users SET totp_secret = totp_pending_secret, totp_pending_secret = NULL, totp_enabled_at = UTC_TIMESTAMP(), totp_last_step = ? WHERE id = ?',
      [step, user.id],
      conn,
    );
    const recovery = await replaceRecoveryCodes(user.id, conn);
    // Every other session must now pass the second step too.
    await db.query(
      "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(), revoked_reason = 'two_factor' WHERE user_id = ? AND revoked_at IS NULL AND family_id <> ?",
      [user.id, ctx.sessionId || ''],
      conn,
    );
    await audit.record(ctx, {
      action: 'auth.two_factor_enabled', entityType: 'user', entityId: user.id, description: 'Turned on two-step sign-in',
      before: { twoFactor: false }, after: { twoFactor: true },
    }, conn);
    return recovery;
  });
  return { recoveryCodes: codes };
}

/** Turn it off (not allowed when the salon requires it for this user). */
async function disable(user, { password, code }, ctx) {
  if (isRequiredFor(user)) throw ApiError.forbidden('Two-step sign-in is required for your account and cannot be turned off.');
  await db.withTransaction(async (conn) => {
    const account = await loadUser(user.id, conn, { lock: true });
    if (!account.totp_enabled_at) throw ApiError.badRequest('Two-step sign-in is not on');
    await assertPassword(account, password);
    const step = await checkCode(account.totp_secret, code, account.totp_last_step);
    const recovery = step ? null : await useRecoveryCode(user.id, code, conn);
    if (!step && !recovery) throw ApiError.validation([{ field: 'code', message: 'That code is not right' }]);
    await clear(user.id, conn);
    await audit.record(ctx, {
      action: 'auth.two_factor_disabled', entityType: 'user', entityId: user.id, description: 'Turned off two-step sign-in',
      before: { twoFactor: true }, after: { twoFactor: false },
    }, conn);
  });
}

/** New recovery codes (the old ones stop working). */
async function regenerateRecoveryCodes(user, { password, code }, ctx) {
  return db.withTransaction(async (conn) => {
    const account = await loadUser(user.id, conn, { lock: true });
    if (!account.totp_enabled_at) throw ApiError.badRequest('Two-step sign-in is not on');
    await assertPassword(account, password);
    const step = await checkCode(account.totp_secret, code, account.totp_last_step);
    if (!step) throw ApiError.validation([{ field: 'code', message: 'That code is not right' }]);
    await db.query('UPDATE users SET totp_last_step = ? WHERE id = ?', [step, user.id], conn);
    const codes = await replaceRecoveryCodes(user.id, conn);
    await audit.record(ctx, { action: 'auth.recovery_codes_regenerated', entityType: 'user', entityId: user.id, description: 'Created new recovery codes' }, conn);
    return { recoveryCodes: codes };
  });
}

async function useRecoveryCode(userId, code, conn) {
  const normalised = normaliseRecovery(code);
  if (normalised.length !== 10) return null;
  const row = await db.queryOne(
    'SELECT id FROM user_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL FOR UPDATE',
    [userId, hashRecovery(normalised)],
    conn,
  );
  if (!row) return null;
  await db.query('UPDATE user_recovery_codes SET used_at = UTC_TIMESTAMP() WHERE id = ?', [row.id], conn);
  return row.id;
}

async function clear(userId, conn) {
  await db.query('UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?', [userId], conn);
  await db.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [userId], conn);
}

/**
 * Second step of signing in: a code from the app or a recovery code.
 * @returns {Promise<'totp'|'recovery'|null>}
 */
async function verifySignIn(userId, code, conn) {
  const account = await loadUser(userId, conn, { lock: true });
  if (!account?.totp_enabled_at) return null;
  const step = await checkCode(account.totp_secret, code, account.totp_last_step);
  if (step) {
    await db.query('UPDATE users SET totp_last_step = ? WHERE id = ?', [step, userId], conn);
    return 'totp';
  }
  return (await useRecoveryCode(userId, code, conn)) ? 'recovery' : null;
}

/** An administrator (or the server command line) turns it off for someone who lost their phone. */
async function resetForUser(userId, ctx) {
  await db.withTransaction(async (conn) => {
    const account = await loadUser(userId, conn, { lock: true });
    if (!account) throw ApiError.notFound('User not found');
    if (!account.totp_enabled_at && !account.totp_pending_secret) throw ApiError.badRequest('Two-step sign-in is not on for this user');
    await clear(userId, conn);
    await db.query("UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(), revoked_reason = 'two_factor' WHERE user_id = ? AND revoked_at IS NULL", [userId], conn);
    await audit.record(ctx, {
      action: 'user.two_factor_reset', entityType: 'user', entityId: userId,
      description: `Reset two-step sign-in for ${account.full_name}`, before: { twoFactor: true }, after: { twoFactor: false },
    }, conn);
  });
}

module.exports = {
  ADMIN_PERMISSIONS, CHALLENGE_MINUTES, isRequiredFor, status, startSetup, confirmSetup, disable, regenerateRecoveryCodes, verifySignIn, resetForUser,
  newRecoveryCode, hashRecovery,
};
