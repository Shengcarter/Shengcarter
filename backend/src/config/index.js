'use strict';

/**
 * Centralized configuration. Every environment variable is read and validated
 * here; the rest of the code base imports `config` instead of touching
 * process.env directly.
 */
const path = require('path');
const dotenv = require('dotenv');
const { z } = require('zod');

const BACKEND_ROOT = path.resolve(__dirname, '..', '..');
const PROJECT_ROOT = path.resolve(BACKEND_ROOT, '..');

// Root .env is the primary location; backend/.env is supported as a fallback.
// Values already present in process.env always win.
dotenv.config({ path: path.join(PROJECT_ROOT, '.env'), quiet: true });
dotenv.config({ path: path.join(BACKEND_ROOT, '.env'), quiet: true });

const bool = (fallback) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((value) => {
      if (value === undefined || value === '') return fallback;
      if (typeof value === 'boolean') return value;
      return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
    });

const int = (fallback) =>
  z
    .union([z.number(), z.string()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined || value === '') return fallback;
      const parsed = Number(value);
      if (!Number.isInteger(parsed)) {
        ctx.addIssue({ code: 'custom', message: 'must be an integer' });
        return z.NEVER;
      }
      return parsed;
    });

const str = (fallback = '') =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : value));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).optional().default('development'),
  HOST: str('0.0.0.0'),
  PORT: int(5000),
  APP_URL: str('http://localhost:5000'),
  FRONTEND_URL: str('http://localhost:5173'),
  SERVE_FRONTEND: bool(true),
  TRUST_PROXY: str('false'),
  COOKIE_SECURE: bool(false),

  DATABASE_HOST: str('127.0.0.1'),
  DATABASE_PORT: int(3306),
  DATABASE_NAME: str('zola_stylish'),
  DATABASE_USER: str('root'),
  DATABASE_PASSWORD: str(''),
  DATABASE_CONNECTION_LIMIT: int(10),

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  APP_ENCRYPTION_KEY: str(''),
  JWT_ACCESS_EXPIRES_IN: str('15m'),
  REFRESH_TOKEN_DAYS: int(30),
  SESSION_HOURS: int(12),
  BCRYPT_ROUNDS: int(12),
  LOGIN_MAX_ATTEMPTS: int(5),
  LOGIN_LOCK_MINUTES: int(15),

  SMTP_HOST: str(''),
  SMTP_PORT: int(587),
  SMTP_SECURE: bool(false),
  SMTP_USER: str(''),
  SMTP_PASSWORD: str(''),
  EMAIL_FROM: str(''),

  SMS_USERNAME: str(''),
  SMS_API_KEY: str(''),
  TWILIO_ACCOUNT_SID: str(''),
  TWILIO_AUTH_TOKEN: str(''),
  TWILIO_FROM: str(''),

  WHATSAPP_API_KEY: str(''),
  WHATSAPP_PHONE_NUMBER_ID: str(''),

  AI_PROVIDER: str(''),
  AI_API_KEY: str(''),
  AI_MODEL: str(''),

  UPLOAD_DIR: str('storage/uploads'),
  BACKUP_DIR: str('storage/backups'),
  MAX_UPLOAD_MB: int(5),
  LOG_LEVEL: str('info'),
  LOG_FILE: str('logs/app.log'),
  LOG_MAX_MB: int(20),
  LOG_KEEP_FILES: int(5),
  JOBS_ENABLED: bool(true),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  const details = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
  // Logger is not available yet (it depends on config), so write directly.
  process.stderr.write(`\n[ZOLA STYLISH MANAGEMENT SYSTEM] Invalid environment configuration:\n${details}\n\n` +
    'Copy .env.example to .env in the project root and fill in the required values.\n\n');
  process.exit(1);
}

const env = parsed.data;
const resolveFromBackend = (p) => (path.isAbsolute(p) ? p : path.join(BACKEND_ROOT, p));

function parseTrustProxy(value) {
  if (value === 'true') return 1;
  if (value === 'false' || value === '') return false;
  const asNumber = Number(value);
  return Number.isInteger(asNumber) ? asNumber : value;
}

const config = Object.freeze({
  appName: 'ZOLA STYLISH MANAGEMENT SYSTEM',
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  host: env.HOST,
  port: env.PORT,
  appUrl: env.APP_URL.replace(/\/+$/, ''),
  corsOrigins: env.FRONTEND_URL.split(',').map((o) => o.trim()).filter(Boolean),
  serveFrontend: env.SERVE_FRONTEND,
  trustProxy: parseTrustProxy(env.TRUST_PROXY),
  paths: {
    backendRoot: BACKEND_ROOT,
    projectRoot: PROJECT_ROOT,
    frontendDist: path.join(PROJECT_ROOT, 'frontend', 'dist'),
    database: path.join(PROJECT_ROOT, 'database'),
    uploads: resolveFromBackend(env.UPLOAD_DIR),
    backups: resolveFromBackend(env.BACKUP_DIR),
    logFile: env.LOG_FILE ? resolveFromBackend(env.LOG_FILE) : null,
  },
  db: {
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    connectionLimit: env.DATABASE_CONNECTION_LIMIT,
  },
  auth: {
    jwtSecret: env.JWT_SECRET,
    accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    refreshTokenDays: env.REFRESH_TOKEN_DAYS,
    sessionHours: env.SESSION_HOURS,
    bcryptRounds: env.BCRYPT_ROUNDS,
    maxLoginAttempts: env.LOGIN_MAX_ATTEMPTS,
    lockMinutes: env.LOGIN_LOCK_MINUTES,
    cookieSecure: env.COOKIE_SECURE,
    refreshCookieName: 'zola_rt',
  },
  encryptionKey: env.APP_ENCRYPTION_KEY || env.JWT_SECRET,
  // Fallback credentials for integrations when nothing is saved in Settings.
  integrations: {
    smtp: {
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      password: env.SMTP_PASSWORD,
      from: env.EMAIL_FROM,
    },
    sms: {
      username: env.SMS_USERNAME,
      apiKey: env.SMS_API_KEY,
      twilioAccountSid: env.TWILIO_ACCOUNT_SID,
      twilioAuthToken: env.TWILIO_AUTH_TOKEN,
      twilioFrom: env.TWILIO_FROM,
    },
    whatsapp: {
      apiKey: env.WHATSAPP_API_KEY,
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    },
    ai: {
      provider: env.AI_PROVIDER,
      apiKey: env.AI_API_KEY,
      model: env.AI_MODEL,
    },
  },
  uploads: {
    maxBytes: env.MAX_UPLOAD_MB * 1024 * 1024,
  },
  logLevel: env.LOG_LEVEL,
  logRotation: {
    maxBytes: Math.max(1, env.LOG_MAX_MB) * 1024 * 1024,
    keep: Math.max(1, env.LOG_KEEP_FILES),
  },
  jobsEnabled: env.JOBS_ENABLED,
});

module.exports = config;
