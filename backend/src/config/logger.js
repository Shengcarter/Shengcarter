'use strict';

const fs = require('fs');
const path = require('path');
const pino = require('pino');
const config = require('./index');

const ROTATION_CHECK_MS = 10 * 60 * 1000;
let fileDestination = null;

/**
 * Size-based rotation for LOG_FILE, so an always-on salon computer never fills
 * its disk: app.log → app.log.1 → … → app.log.<LOG_KEEP_FILES>, oldest dropped.
 * The open file is renamed and then reopened, which works on Windows too.
 */
function rotateLogFile(file = config.paths.logFile) {
  if (!file) return false;
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return false;
  }
  if (size < config.logRotation.maxBytes) return false;
  try {
    for (let i = config.logRotation.keep - 1; i >= 1; i -= 1) {
      if (fs.existsSync(`${file}.${i}`)) fs.renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    }
    fs.renameSync(file, `${file}.1`);
    fileDestination?.reopen();
    return true;
  } catch (error) {
    process.stderr.write(`Log rotation failed: ${error.message}\n`);
    return false;
  }
}

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
    rotateLogFile();
    fileDestination = pino.destination({ dest: config.paths.logFile, sync: false, mkdir: true });
    streams.push({ stream: fileDestination });
    setInterval(() => rotateLogFile(), ROTATION_CHECK_MS).unref();
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
