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

/** Verify the JWT access token and load the current user. */
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

  // Loaded on every request so deactivated accounts and role changes apply immediately.
  const row = await db.queryOne(
    `SELECT u.id, u.full_name, u.email, u.phone, u.avatar, u.role_id, u.branch_id, u.is_active,
            u.must_change_password, r.slug AS role_slug, r.name AS role_name, e.id AS employee_id
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
    permissions,
  };

  if (user.mustChangePassword && !PASSWORD_CHANGE_ALLOWLIST.has(req.originalUrl.split('?')[0])) {
    throw ApiError.forbidden('You must change your password before continuing', { code: 'PASSWORD_CHANGE_REQUIRED' });
  }

  req.user = user;
  req.ctx = {
    userId: user.id,
    user,
    branchId: await resolveBranchId(req, user),
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
  };
  next();
}

function hasPermission(user, code) {
  return Boolean(user) && (user.isSuperAdmin || user.permissions.has(code));
}

/** Allow the request when the user holds ANY of the given permissions. */
function requirePermission(...codes) {
  return (req, _res, next) => {
    if (!req.user) throw ApiError.unauthorized();
    if (codes.some((code) => hasPermission(req.user, code))) return next();
    throw ApiError.forbidden();
  };
}

module.exports = { authenticate, requirePermission, hasPermission, SUPER_ADMIN };
