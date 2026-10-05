'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');

const message = (text) => ({ success: false, message: text, errors: [], code: 'RATE_LIMITED' });
const skip = () => config.isTest;

/** Sign-in limits that are hit are worth knowing about (password guessing): logged once per window. */
const loggedLimits = new Map();
function auditedHandler(action) {
  return (req, res, _next, options) => {
    const key = `${action}:${req.ip}`;
    if (!(loggedLimits.get(key) > Date.now() - options.windowMs)) {
      loggedLimits.set(key, Date.now());
      if (loggedLimits.size > 5000) loggedLimits.clear();
      require('../services/auditService').record({ ip: req.ip, userAgent: req.headers['user-agent'] }, {
        action, description: `Too many attempts from ${req.ip}: requests refused for ${Math.round(options.windowMs / 60000)} minutes`,
        metadata: { path: req.originalUrl.split('?')[0], email: req.body?.email ? String(req.body.email).slice(0, 150) : undefined },
      });
    }
    res.status(options.statusCode).json(options.message);
  };
}

/** General API limit per IP address (WhatsApp webhooks have their own). */
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 1500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => skip() || req.path.startsWith('/webhooks/'),
  message: message('Too many requests. Please slow down and try again shortly.'),
});

/** Login attempts per IP + email (account lockout adds a second layer). */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email || '').toLowerCase()}`,
  message: message('Too many login attempts. Please wait 15 minutes and try again.'),
  handler: auditedHandler('auth.rate_limited'),
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: message('Too many password reset requests. Please try again later.'),
  handler: auditedHandler('auth.rate_limited'),
});

/** Public (unauthenticated) endpoints such as QR appointment verification. */
const publicLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: message('Too many requests. Please try again in a minute.'),
});

/** Expensive work (report exports, AI summaries, backups): per signed-in user. */
const heavyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
  message: message('Too many requests. Please wait a minute and try again.'),
});

/** The second sign-in step (codes): per address; wrong codes also lock the account. */
const twoFactorLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: message('Too many attempts. Please wait 15 minutes and try again.'),
  handler: auditedHandler('auth.rate_limited'),
});

/** Refresh and sign-out: generous (every open tab refreshes), but not unlimited. */
const sessionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: message('Too many requests. Please slow down and try again shortly.'),
});

/** Changing a password or two-step sign-in: per signed-in user. */
const accountSecurityLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  keyGenerator: (req) => (req.user ? `user:${req.user.id}` : ipKeyGenerator(req.ip)),
  message: message('Too many attempts. Please wait 15 minutes and try again.'),
});

module.exports = { apiLimiter, loginLimiter, passwordResetLimiter, publicLimiter, heavyLimiter, twoFactorLimiter, sessionLimiter, accountSecurityLimiter };
