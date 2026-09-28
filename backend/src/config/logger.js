'use strict';

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const config = require('./index');

/**
 * Structured JSON logger. Logs go to stdout (pretty-printed in development)
 * and, when LOG_FILE is set, to a file for later inspection on local installs.
 * Sensitive fields are redacted so passwords and tokens never reach the logs.
 */
function buildStreams() {
  const streams = [];

  if (!config.isProduction && !config.isTest) {
    try {
      const pretty = require('pino-pretty');
      streams.push({ stream: pretty({ colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' }) });
    } catch {
      streams.push({ stream: process.stdout });
    }
  } else if (!config.isTest) {
    streams.push({ stream: process.stdout });
  }

  if (config.paths.logFile && !config.isTest) {
    fs.mkdirSync(path.dirname(config.paths.logFile), { recursive: true });
    streams.push({ stream: pino.destination({ dest: config.paths.logFile, sync: false, mkdir: true }) });
  }

  return streams;
}

const streams = buildStreams();

const logger = pino(
  {
    level: config.isTest ? 'silent' : config.logLevel,
    base: { app: 'zola-stylish' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.newPassword',
        '*.currentPassword',
        '*.token',
        '*.accessToken',
        '*.password_hash',
      ],
      censor: '[REDACTED]',
    },
  },
  streams.length ? pino.multistream(streams) : undefined,
);

module.exports = logger;
