'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const permissionService = require('../services/permissionService');
const branchService = require('../services/branchService');

const SUPER_ADMIN = 'super_admin';

// Routes a user who must change their password is still allowed to call.
const PASSWORD_CHANGE_ALLOWLIST = new Set(['/api/auth/me', '/api/auth/change-password', '/api/auth/logout']);
// Routes a user who must first set up two-step sign-in may call.
const TWO_FACTOR_SETUP_ALLOWLIST = new Set([
  '/api/auth/me', '/api/auth/logout', '/api/auth/change-password', '/api/auth/two-factor', '/api/auth/two-factor/setup', '/api/auth/two-factor/confirm',
]);

function readBearerToken(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

/**
 * Resolve which branch the request operates on. Users with branches.manage
 * (Super Admin) may pick any active branch with the X-Branch-Id header; all
 * other users always work in their own branch.
 */
async function resolveBranchId(req, user) {
  const requested = Number.parseInt(req.headers['x-branch-id'], 10);
  if (requested && user.permissions.has('branches.manage')) {
    const branch = await branchService.getActiveBranch(requested);
    if (branch) return branch.id;
  }
  if (user.branchId) {
    const own = await branchService.getActiveBranch(user.branchId);
    if (own) return own.id;
  }
  const fallback = await branchService.getDefaultBranch();
  return fallback ? fallback.id : null;
}

/**
 * Is the session the access token belongs to still open? Signing out, a
 * password change, deactivation or detected token theft ends a session, and
 * its access tokens stop working at once (see authService).
 */
async function sessionIsOpen(sessionId, userId) {
  if (!sessionId) return false;
  const row = await db.queryOne(
    'SELECT id FROM refresh_tokens WHERE family_id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() LIMIT 1',
    [sessionId, userId],
  );
  return Boolean(row);
}

/** Verify the JWT access token, check its session is still open and load the current user. */
async function authenticate(req, _res, next) {
  const token = readBearerToken(req);
  if (!token) throw ApiError.unauthorized('Authentication required', { code: 'NO_TOKEN' });

  let payload;
  try {
    payload = jwt.verify(token, config.auth.jwtSecret, { algorithms: ['HS256'] });
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw ApiError.unauthorized('Your session has expired', { code: 'TOKEN_EXPIRED' });
    }
    throw ApiError.unauthorized('Invalid authentication token', { code: 'INVALID_TOKEN' });
  }
  if (payload.type !== 'access') throw ApiError.unauthorized('Invalid authentication token', { code: 'INVALID_TOKEN' });
  if (!(await sessionIsOpen(payload.sid, payload.sub))) {
    throw ApiError.unauthorized('Your session has ended. Please sign in again.', { code: 'SESSION_ENDED' });
  }

  // Loaded on every request so deactivated accounts and role changes apply immediately.
  const row = await db.queryOne(
    `SELECT u.id, u.full_name, u.email, u.phone, u.avatar, u.role_id, u.branch_id, u.is_active,
            u.must_change_password, u.totp_enabled_at, r.slug AS role_slug, r.name AS role_name, e.id AS employee_id
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN employees e ON e.user_id = u.id
     WHERE u.id = ?`,
    [payload.sub],
  );
  if (!row || !row.is_active) throw ApiError.unauthorized('Account is not active', { code: 'ACCOUNT_INACTIVE' });

  const permissions = await permissionService.getRolePermissions(row.role_id);
  const user = {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    avatar: row.avatar,
    roleId: row.role_id,
    roleSlug: row.role_slug,
    roleName: row.role_name,
    branchId: row.branch_id,
    employeeId: row.employee_id,
    mustChangePassword: Boolean(row.must_change_password),
    isSuperAdmin: row.role_slug === SUPER_ADMIN,
    twoFactorEnabled: Boolean(row.totp_enabled_at),
    permissions,
  };

  const path = req.originalUrl.split('?')[0];
  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWLIST.has(path)) {
    throw ApiError.forbidden('You must change your password before continuing', { code: 'PASSWORD_CHANGE_REQUIRED' });
  }
  // Loaded here, not at the top: the two-step service depends on settings and audit.
  const { isRequiredFor } = require('../services/twoFactorService');
  if (!user.twoFactorEnabled && isRequiredFor(user) && !TWO_FACTOR_SETUP_ALLOWLIST.has(path)) {
    throw ApiError.forbidden('Set up two-step sign-in before continuing', { code: 'TWO_FACTOR_SETUP_REQUIRED' });
  }

  req.user = user;
  req.ctx = {
    userId: user.id,
    user,
    sessionId: payload.sid,
    branchId: await resolveBranchId(req, user),
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
  };
  next();
}

function hasPermission(user, code) {
  return Boolean(user) && (user.isSuperAdmin || user.permissions.has(code));
}

// The same refusal is logged once a minute per user and address, not on every retry.
const recentDenials = new Map();
function logDenial(req, codes) {
  const key = `${req.user.id}:${req.method}:${req.baseUrl}${req.route?.path || req.path}`;
  const now = Date.now();
  if (recentDenials.get(key) > now - 60_000) return;
  recentDenials.set(key, now);
  if (recentDenials.size > 5000) recentDenials.clear();
  // Required here, not at the top: the audit service is loaded after this module.
  require('../services/auditService').record(req.ctx, {
    action: 'auth.permission_denied', entityType: 'user', entityId: req.user.id,
    description: `Refused ${req.method} ${req.originalUrl.split('?')[0]}: needs ${codes.join(' or ')}`,
    metadata: { method: req.method, path: req.originalUrl.split('?')[0], needs: codes },
  });
}

/** Allow the request when the user holds ANY of the given permissions; log a refusal. */
function requirePermission(...codes) {
  return (req, _res, next) => {
    if (!req.user) throw ApiError.unauthorized();
    if (codes.some((code) => hasPermission(req.user, code))) return next();
    logDenial(req, codes);
    throw ApiError.forbidden();
  };
}

module.exports = { authenticate, requirePermission, hasPermission, SUPER_ADMIN };
