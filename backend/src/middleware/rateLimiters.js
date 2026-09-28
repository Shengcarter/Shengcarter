'use strict';

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const config = require('../config');

const message = (text) => ({ success: false, message: text, errors: [], code: 'RATE_LIMITED' });
const skip = () => config.isTest;

/** General API limit per IP address. */
const apiLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 1500,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
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
});

const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip,
  message: message('Too many password reset requests. Please try again later.'),
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

module.exports = { apiLimiter, loginLimiter, passwordResetLimiter, publicLimiter, heavyLimiter };
