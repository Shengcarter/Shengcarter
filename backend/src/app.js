'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const pinoHttp = require('pino-http');
const config = require('./config');
const logger = require('./config/logger');
const routes = require('./routes');
const { apiLimiter } = require('./middleware/rateLimiters');
const { errorHandler, notFound } = require('./middleware/errorHandler');

/**
 * Express application for ZOLA STYLISH MANAGEMENT SYSTEM.
 * Serves the REST API under /api, uploaded images under /uploads and — for
 * single-server installs (Windows / LAN) — the built React frontend.
 */
function createApp() {
  const app = express();

  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'img-src': ["'self'", 'data:', 'blob:'],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          // Allow plain-HTTP LAN installs (no HTTPS certificate on the salon network).
          'upgrade-insecure-requests': config.auth.cookieSecure ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      // HSTS only makes sense (and is only safe) when served over HTTPS.
      strictTransportSecurity: config.auth.cookieSecure,
    }),
  );

  app.use(
    cors({
      origin(origin, callback) {
        // Same-origin requests (no Origin header) and configured origins only.
        if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
    }),
  );

  app.use(compression());
  app.use(express.json({
    limit: '1mb',
    // WhatsApp webhooks are signed over the exact bytes received.
    verify: (req, _res, buffer) => {
      if (req.originalUrl.startsWith('/api/webhooks/')) req.rawBody = buffer;
    },
  }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());

  if (!config.isTest) {
    app.use(
      pinoHttp({
        logger,
        autoLogging: { ignore: (req) => req.url === '/api/health' },
        customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
        serializers: {
          // Path only: query strings can hold reset tokens and customer search
          // terms. raw.ip honours TRUST_PROXY, so logs show the real client.
          req: (req) => ({ method: req.method, url: req.url.split('?')[0], ip: req.raw?.ip || req.remoteAddress }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  }

  // Uploaded profile photos, logos and expense receipts. File names are random
  // and unguessable; nosniff stops browsers from executing anything uploaded.
  app.use(
    '/uploads',
    express.static(config.paths.uploads, {
      index: false,
      dotfiles: 'deny',
      maxAge: '7d',
      setHeaders: (res, filePath) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (filePath.endsWith('.pdf')) res.setHeader('Content-Disposition', 'inline');
      },
    }),
  );

  app.use('/api', apiLimiter, routes);
  app.use('/api', notFound);

  // Built frontend (single-page app). Unknown paths fall back to index.html.
  const indexHtml = path.join(config.paths.frontendDist, 'index.html');
  if (config.serveFrontend && fs.existsSync(indexHtml)) {
    app.use(express.static(config.paths.frontendDist, { index: false, maxAge: '1y', immutable: true }));
    app.get(/^(?!\/(api|uploads)\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexHtml);
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

module.exports = createApp;
