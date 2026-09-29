'use strict';

const { z } = require('zod');
const { IANAZone } = require('luxon');
const cron = require('node-cron');
const db = require('../config/database');
const config = require('../config');
const ApiError = require('../utils/ApiError');
const { encrypt, decrypt } = require('../utils/crypto');
const audit = require('./auditService');

/**
 * Key/value settings stored in the `settings` table.
 *
 * Every key is declared in SETTINGS below with its validation schema and
 * whether it is secret (encrypted at rest, never returned by the API) or
 * public (safe to expose to any signed-in user, e.g. currency and time zone).
 * Values are cached in memory and refreshed at most every CACHE_TTL_MS so
 * several server processes stay in sync.
 */
const CACHE_TTL_MS = 30_000;

const text = (max) => z.string().trim().max(max);
const optionalEmail = z.union([z.literal(''), z.email().max(150)]);
const channelList = z.array(z.enum(['sms', 'whatsapp', 'email'])).max(3);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour) format');
const dayHours = z
  .object({ open: z.boolean(), start: hhmm, end: hhmm })
  .refine((d) => !d.open || d.start < d.end, 'Closing time must be after opening time');

const SETTINGS = {
  // Business
  'business.salon_name': { schema: text(120).min(1), public: true },
  'business.phone': { schema: text(30), public: true },
  'business.email': { schema: optionalEmail, public: true },
  'business.address': { schema: text(255), public: true },
  'business.website': { schema: text(150), public: true },
  'business.tax_number': { schema: text(50), public: true },
  'business.vat_number': { schema: text(50), public: true },
  'business.logo': { schema: text(255), public: true, readOnly: true },

  // Financial
  'financial.currency_code': { schema: z.string().trim().length(3).transform((v) => v.toUpperCase()), public: true },
  'financial.currency_decimals': { schema: z.number().int().min(0).max(3), public: true },
  'financial.currency_locale': { schema: text(20).min(2), public: true },
  'financial.tax_mode': { schema: z.enum(['exclusive', 'inclusive', 'none']), public: true },
  'financial.tax_rate': { schema: z.number().min(0).max(100), public: true },
  'financial.tax_label': { schema: text(20).min(1), public: true },
  'financial.invoice_prefix': { schema: z.string().trim().max(10).regex(/^[A-Za-z0-9\-/]*$/), public: true },
  'financial.receipt_prefix': { schema: z.string().trim().max(10).regex(/^[A-Za-z0-9\-/]*$/), public: true },
  'financial.number_padding': { schema: z.number().int().min(3).max(10), public: true },
  'financial.receipt_footer': { schema: text(300), public: true },
  'financial.receipt_format': { schema: z.enum(['thermal', 'a4']), public: true },
  'financial.allow_partial_payments': { schema: z.boolean(), public: true },

  // System
  'system.timezone': {
    schema: z.string().refine((tz) => IANAZone.isValidZone(tz), 'Unknown time zone'),
    public: true,
  },
  'system.language': { schema: z.enum(['en']), public: true },
  'system.default_theme': { schema: z.enum(['dark', 'light', 'system']), public: true },
  'system.time_format': { schema: z.enum(['12h', '24h']), public: true },
  'system.slot_interval_minutes': { schema: z.union([5, 10, 15, 20, 30, 60].map((n) => z.literal(n))), public: true },
  'system.enforce_working_hours': { schema: z.boolean(), public: true },
  'system.appointment_buffer_minutes': { schema: z.number().int().min(0).max(120), public: true },
  'system.business_hours': {
    schema: z.object(Object.fromEntries(['0', '1', '2', '3', '4', '5', '6'].map((d) => [d, dayHours]))),
    public: true,
  },

  // Notifications
  'notifications.reminders_enabled': { schema: z.boolean() },
  'notifications.reminder_hours_before': { schema: z.number().int().min(1).max(168) },
  'notifications.channels': {
    schema: z.object({
      appointment_confirmation: channelList,
      appointment_reminder: channelList,
      appointment_cancelled: channelList,
      payment_receipt: channelList,
    }),
  },
  'notifications.templates': {
    schema: z.object({
      appointment_confirmation: text(600).min(1),
      appointment_reminder: text(600).min(1),
      appointment_cancelled: text(600).min(1),
      payment_receipt: text(600).min(1),
    }),
  },

  // Integrations
  'integrations.email_provider': { schema: z.enum(['log', 'smtp']) },
  'integrations.email_from_name': { schema: text(100) },
  'integrations.email_from_address': { schema: optionalEmail },
  'integrations.smtp_host': { schema: text(150) },
  'integrations.smtp_port': { schema: z.number().int().min(1).max(65535) },
  'integrations.smtp_secure': { schema: z.boolean() },
  'integrations.smtp_user': { schema: text(150) },
  'integrations.smtp_password': { schema: text(300), secret: true, env: () => config.integrations.smtp.password },
  'integrations.sms_provider': { schema: z.enum(['log', 'africastalking', 'twilio']) },
  'integrations.sms_sender_id': { schema: text(20) },
  'integrations.sms_username': { schema: text(100) },
  'integrations.sms_api_key': { schema: text(300), secret: true, env: () => config.integrations.sms.apiKey },
  'integrations.twilio_account_sid': { schema: text(100) },
  'integrations.twilio_auth_token': { schema: text(300), secret: true, env: () => config.integrations.sms.twilioAuthToken },
  'integrations.twilio_from': { schema: text(30) },
  'integrations.whatsapp_provider': { schema: z.enum(['log', 'meta_cloud', 'twilio']) },
  'integrations.whatsapp_phone_number_id': { schema: text(60) },
  'integrations.whatsapp_access_token': { schema: text(600), secret: true, env: () => config.integrations.whatsapp.apiKey },
  'integrations.ai_provider': { schema: z.enum(['rule_based', 'anthropic', 'openai']) },
  'integrations.ai_model': { schema: text(100) },
  'integrations.ai_api_key': { schema: text(300), secret: true, env: () => config.integrations.ai.apiKey },

  // Loyalty
  'loyalty.enabled': { schema: z.boolean(), public: true },
  'loyalty.earn_amount_unit': { schema: z.number().positive().max(100_000_000), public: true },
  'loyalty.points_per_unit': { schema: z.number().int().min(0).max(10_000), public: true },
  'loyalty.redeem_value_per_point': { schema: z.number().min(0).max(1_000_000), public: true },
  'loyalty.min_redeem_points': { schema: z.number().int().min(0).max(1_000_000), public: true },
  'loyalty.max_redeem_percent': { schema: z.number().min(0).max(100), public: true },

  // Backups
  'backup.auto_enabled': { schema: z.boolean() },
  'backup.cron': { schema: z.string().trim().refine((v) => cron.validate(v), 'Invalid cron expression') },
  'backup.retention_count': { schema: z.number().int().min(1).max(365) },
};

const GROUPS = ['business', 'financial', 'system', 'notifications', 'integrations', 'loyalty', 'backup'];

/** Fallback values used when a key is missing from the database. */
const DEFAULTS = {
  'business.salon_name': 'Zola Stylish',
  'financial.currency_code': 'TZS',
  'financial.currency_decimals': 0,
  'financial.currency_locale': 'en-TZ',
  'financial.tax_mode': 'exclusive',
  'financial.tax_rate': 18,
  'financial.tax_label': 'VAT',
  'financial.invoice_prefix': 'INV-',
  'financial.receipt_prefix': 'RCT-',
  'financial.number_padding': 6,
  'financial.receipt_format': 'thermal',
  'financial.allow_partial_payments': true,
  'system.timezone': 'Africa/Dar_es_Salaam',
  'system.language': 'en',
  'system.default_theme': 'dark',
  'system.time_format': '24h',
  'system.slot_interval_minutes': 15,
  'system.enforce_working_hours': true,
  'system.appointment_buffer_minutes': 0,
  'notifications.reminders_enabled': true,
  'notifications.reminder_hours_before': 24,
  'integrations.email_provider': 'log',
  'integrations.sms_provider': 'log',
  'integrations.whatsapp_provider': 'log',
  'integrations.ai_provider': 'rule_based',
  'loyalty.enabled': true,
  'loyalty.earn_amount_unit': 1000,
  'loyalty.points_per_unit': 1,
  'loyalty.redeem_value_per_point': 10,
  'loyalty.min_redeem_points': 100,
  'loyalty.max_redeem_percent': 50,
  'backup.auto_enabled': true,
  'backup.cron': '0 23 * * *',
  'backup.retention_count': 14,
};

let cache = new Map();
let loadedAt = 0;
let loading = null;

async function load() {
  const rows = await db.query('SELECT setting_key, setting_value FROM settings');
  const next = new Map();
  for (const row of rows) next.set(row.setting_key, row.setting_value);
  cache = next;
  loadedAt = Date.now();
}

/** Reload the cache when it is older than the TTL. Cheap to call per request. */
async function ensureFresh() {
  if (Date.now() - loadedAt < CACHE_TTL_MS && cache.size) return;
  if (!loading) {
    loading = load().finally(() => {
      loading = null;
    });
  }
  await loading;
}

/** Synchronous read from the cache (call ensureFresh() first in jobs/scripts). */
function get(key) {
  const def = SETTINGS[key];
  if (def?.secret) throw new Error(`Use getSecret() for secret setting ${key}`);
  const value = cache.has(key) ? cache.get(key) : undefined;
  return value === undefined || value === null ? DEFAULTS[key] ?? '' : value;
}

/** Decrypted secret from the database, falling back to the environment. */
function getSecret(key) {
  const def = SETTINGS[key];
  const stored = cache.get(key);
  const decrypted = stored ? decrypt(stored) : null;
  if (decrypted) return decrypted;
  return def?.env ? def.env() || '' : '';
}

function getGroup(group, { includeSecrets = false } = {}) {
  const result = {};
  for (const [key, def] of Object.entries(SETTINGS)) {
    if (!key.startsWith(`${group}.`)) continue;
    const shortKey = key.slice(group.length + 1);
    if (def.secret) {
      if (!includeSecrets) continue;
      const hasDbValue = Boolean(cache.get(key) && decrypt(cache.get(key)));
      const hasEnvValue = Boolean(def.env && def.env());
      result[shortKey] = { isSet: hasDbValue || hasEnvValue, source: hasDbValue ? 'settings' : hasEnvValue ? 'environment' : null };
    } else {
      result[shortKey] = get(key);
    }
  }
  return result;
}

/** Settings every signed-in user may read (currency, time zone, tax...). */
function getPublicSettings() {
  const result = {};
  for (const [key, def] of Object.entries(SETTINGS)) {
    if (!def.public) continue;
    const [group, shortKey] = key.split('.');
    result[group] = result[group] || {};
    result[group][shortKey] = get(key);
  }
  result.appName = config.appName;
  return result;
}

/** Minimal branding for the unauthenticated login page. */
function getBranding() {
  return {
    appName: config.appName,
    salonName: get('business.salon_name'),
    logo: get('business.logo') || null,
    defaultTheme: get('system.default_theme'),
  };
}

function getAllForAdmin() {
  const result = {};
  for (const group of GROUPS) result[group] = getGroup(group, { includeSecrets: true });
  return result;
}

async function writeValue(key, value, userId, conn) {
  const def = SETTINGS[key];
  const group = key.split('.')[0];
  const stored = def.secret ? (value ? JSON.stringify(encrypt(value)) : null) : JSON.stringify(value);
  await db.query(
    `INSERT INTO settings (setting_key, setting_value, group_name, is_secret, updated_by)
     VALUES (?, CAST(? AS JSON), ?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), is_secret = VALUES(is_secret), updated_by = VALUES(updated_by)`,
    [key, stored, group, def.secret ? 1 : 0, userId],
    conn,
  );
}

/**
 * Validate and save a group of settings. For secret keys: omit to keep the
 * current value, send null or '' to clear it, send a string to replace it.
 */
async function updateGroup(group, values, ctx) {
  if (!GROUPS.includes(group)) throw ApiError.notFound('Unknown settings group');
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw ApiError.validation([{ field: group, message: 'Expected an object of settings' }]);
  }

  const errors = [];
  const updates = [];
  for (const [shortKey, rawValue] of Object.entries(values)) {
    const key = `${group}.${shortKey}`;
    const def = SETTINGS[key];
    if (!def || def.readOnly) {
      errors.push({ field: shortKey, message: 'This setting cannot be changed here' });
      continue;
    }
    if (def.secret && (rawValue === null || rawValue === '')) {
      updates.push([key, null]);
      continue;
    }
    const parsed = def.schema.safeParse(rawValue);
    if (!parsed.success) {
      errors.push({ field: shortKey, message: parsed.error.issues[0]?.message || 'Invalid value' });
    } else {
      updates.push([key, parsed.data]);
    }
  }
  if (errors.length) throw ApiError.validation(errors);

  await db.withTransaction(async (conn) => {
    for (const [key, value] of updates) await writeValue(key, value, ctx.userId, conn);
    await audit.record(ctx, {
      action: 'settings.updated',
      entityType: 'settings',
      description: `Updated ${group} settings`,
      // Never log secret values — only which keys changed.
      metadata: { keys: updates.map(([key]) => key) },
    }, conn);
  });

  await load();
  return getGroup(group, { includeSecrets: true });
}

/** Used internally (e.g. logo upload) to set a read-only key. */
async function setInternal(key, value, ctx) {
  await writeValue(key, value, ctx.userId);
  await load();
}

module.exports = {
  SETTINGS,
  GROUPS,
  load,
  ensureFresh,
  get,
  getSecret,
  getGroup,
  getPublicSettings,
  getBranding,
  getAllForAdmin,
  updateGroup,
  setInternal,
};
