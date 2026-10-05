'use strict';

const config = require('../config');
const authService = require('../services/authService');
const { sendSuccess } = require('../utils/response');

// The refresh token is only ever sent to /api/auth, never readable by scripts
// (HttpOnly), only over HTTPS when COOKIE_SECURE is on, and never on requests
// started by another site (SameSite=Strict).
const COOKIE_PATH = '/api/auth';
const COOKIE_OPTIONS = () => ({ httpOnly: true, secure: config.auth.cookieSecure, sameSite: 'strict', path: COOKIE_PATH });

function setRefreshCookie(res, refresh) {
  if (!refresh) return;
  res.cookie(config.auth.refreshCookieName, refresh.token, {
    ...COOKIE_OPTIONS(),
    // Without "remember me" the cookie ends with the browser session.
    ...(refresh.remember ? { expires: refresh.expiresAt } : {}),
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(config.auth.refreshCookieName, COOKIE_OPTIONS());
}

function bearer(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  return scheme === 'Bearer' && token ? token : null;
}

const meta = (req) => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  branchId: Number.parseInt(req.headers['x-branch-id'], 10) || null,
});

async function login(req, res) {
  const result = await authService.login(req.body, meta(req), req.cookies?.[config.auth.refreshCookieName]);
  setRefreshCookie(res, result.refresh);
  sendSuccess(res, { accessToken: result.accessToken, ...result.session }, 'Signed in successfully');
}

async function refresh(req, res) {
  try {
    const result = await authService.refresh(req.cookies?.[config.auth.refreshCookieName], meta(req));
    setRefreshCookie(res, result.refresh);
    sendSuccess(res, { accessToken: result.accessToken, ...result.session }, 'Session refreshed');
  } catch (error) {
    clearRefreshCookie(res);
    throw error;
  }
}

async function logout(req, res) {
  await authService.logout(req.cookies?.[config.auth.refreshCookieName], req.ctx || { ip: req.ip, userAgent: req.headers['user-agent'] }, bearer(req));
  clearRefreshCookie(res);
  sendSuccess(res, null, 'Signed out successfully');
}

async function me(req, res) {
  sendSuccess(res, await authService.buildSession(req.user.id, req.ctx.branchId));
}

async function changePassword(req, res) {
  const result = await authService.changePassword(req.user.id, req.body, req.ctx, req.cookies?.[config.auth.refreshCookieName]);
  sendSuccess(res, { accessToken: result.accessToken, ...result.session }, 'Password changed successfully');
}

async function forgotPassword(req, res) {
  await authService.forgotPassword(req.body.email, meta(req));
  sendSuccess(res, null, 'If an account exists for that email, a password reset link has been sent.');
}

async function resetPassword(req, res) {
  await authService.resetPassword(req.body, meta(req));
  sendSuccess(res, null, 'Your password has been reset. You can now sign in.');
}

module.exports = { login, refresh, logout, me, changePassword, forgotPassword, resetPassword };
