'use strict';

const config = require('../config');
const ApiError = require('../utils/ApiError');

/**
 * CSRF protection for the endpoints that act on the refresh cookie (sign in,
 * refresh, sign out). Every other endpoint is authorised by the bearer access
 * token, which a browser never attaches on its own, so other sites cannot
 * forge those requests. On top of the SameSite=Strict cookie, a request whose
 * Origin (or, without one, Referer) names another site is refused. Browsers
 * always send Origin on POST requests; tools without a browser page (no Origin,
 * no Referer) carry no cookie of the user's and are not a CSRF risk.
 */
const originOf = (url) => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

function allowedOrigins(req) {
  return new Set([`${req.protocol}://${req.get('host')}`, config.appUrl, ...config.corsOrigins].map(originOf).filter(Boolean));
}

function requireSameOrigin(req, _res, next) {
  const origin = req.get('origin');
  const source = origin !== undefined ? origin : req.get('referer') ? originOf(req.get('referer')) || 'invalid' : null;
  if (source === null) return next();
  if (source !== 'null' && allowedOrigins(req).has(source)) return next();
  throw ApiError.forbidden('This request did not come from the application and was blocked.', { code: 'CROSS_SITE_REQUEST' });
}

module.exports = { requireSameOrigin };
