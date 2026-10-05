'use strict';

const config = require('../config');
const db = require('../config/database');
const settings = require('./settingsService');

/**
 * A plain-language checklist of how this installation is protected, shown to
 * administrators (Settings → Security) and logged when the server starts in
 * production. It reports configuration, never secret values.
 *
 * Each check: { id, label, status: 'ok' | 'warn' | 'fail', detail }.
 */
const EXAMPLE_JWT_SECRET = 'replace-with-a-long-random-secret-at-least-32-characters';

function configurationChecks() {
  const https = config.auth.cookieSecure || config.auth.forceHttps;
  return [
    {
      id: 'https',
      label: 'HTTPS',
      status: https ? 'ok' : config.isProduction ? 'fail' : 'warn',
      detail: https
        ? 'Sessions only travel over HTTPS (COOKIE_SECURE / FORCE_HTTPS), with HSTS.'
        : 'Plain HTTP: anyone on the network can read sign-ins and data. Serve the site over HTTPS and set COOKIE_SECURE=true and FORCE_HTTPS=true (see docs/DEPLOYMENT.md).',
    },
    {
      id: 'jwt_secret',
      label: 'Signing secret',
      status: config.auth.jwtSecret === EXAMPLE_JWT_SECRET ? 'fail' : 'ok',
      detail: config.auth.jwtSecret === EXAMPLE_JWT_SECRET
        ? 'JWT_SECRET is still the example value from .env.example. Generate a random one and restart.'
        : 'JWT_SECRET is set to a private value.',
    },
    {
      id: 'database_user',
      label: 'Database account',
      status: config.db.user === 'root' ? 'warn' : 'ok',
      detail: config.db.user === 'root'
        ? 'The application connects to MySQL as root. Use its own account limited to its database (database/create-database.sql).'
        : `The application uses its own MySQL account (${config.db.user}).`,
    },
    {
      id: 'backup_encryption',
      label: 'Backup encryption',
      status: config.backup.encryptionKey ? 'ok' : 'warn',
      detail: config.backup.encryptionKey
        ? 'Backup files are encrypted (BACKUP_ENCRYPTION_KEY). Keep the key safely off this server.'
        : 'Backup files are not encrypted. Set BACKUP_ENCRYPTION_KEY.',
    },
    {
      id: 'backup_copy',
      label: 'Backups off this server',
      status: config.backup.copyDir ? 'ok' : 'warn',
      detail: config.backup.copyDir
        ? 'Every backup is copied to a second location (BACKUP_COPY_DIR).'
        : 'Backups are only on this server. Set BACKUP_COPY_DIR to a USB drive, NAS or cloud-synced folder, or download them regularly.',
    },
    {
      id: 'virus_scan',
      label: 'Virus scanning of uploads',
      status: config.uploads.scanner.host ? 'ok' : 'warn',
      detail: config.uploads.scanner.host
        ? `Uploads are scanned by ClamAV${config.uploads.scanner.required ? ', and refused while the scanner is down' : ''}.`
        : 'Uploaded receipts and photos are checked by type and content, but not scanned for viruses. Set CLAMAV_HOST (see .env.example).',
    },
  ];
}

async function check() {
  const checks = configurationChecks();
  const policy = settings.get('security.two_factor_required') || 'none';
  const [admins] = await Promise.all([
    db.queryOne(
      `SELECT COUNT(DISTINCT u.id) AS total, COUNT(DISTINCT CASE WHEN u.totp_enabled_at IS NULL THEN u.id END) AS without
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
       WHERE u.is_active = 1 AND (r.slug = 'super_admin' OR p.code IN ('users.manage', 'roles.manage', 'settings.manage', 'backups.manage'))`,
    ),
  ]);
  checks.push({
    id: 'two_factor',
    label: 'Two-step sign-in for administrators',
    status: policy === 'none' ? (Number(admins.without) ? 'warn' : 'ok') : 'ok',
    detail: policy !== 'none'
      ? `Required for ${policy === 'all' ? 'everyone' : 'administrators'}.`
      : Number(admins.without)
        ? `Optional, and ${Number(admins.without)} of ${Number(admins.total)} administrator account(s) do not use it. Require it below.`
        : 'Optional, but every administrator uses it. Require it below so it stays that way.',
  });
  const lastBackup = await db.queryOne("SELECT MAX(completed_at) AS at FROM backups WHERE status = 'completed'");
  const ageHours = lastBackup.at ? (Date.now() - new Date(lastBackup.at).getTime()) / 3_600_000 : null;
  checks.push({
    id: 'recent_backup',
    label: 'Recent backup',
    status: ageHours !== null && ageHours <= 48 ? 'ok' : 'warn',
    detail: ageHours === null ? 'No backup has been made yet.' : `Last successful backup ${Math.round(ageHours)} hour(s) ago.`,
  });
  const demo = await db.queryOne('SELECT COUNT(*) AS n FROM users WHERE is_demo = 1 AND is_active = 1');
  checks.push({
    id: 'demo_accounts',
    label: 'Demo accounts',
    status: Number(demo.n) ? 'warn' : 'ok',
    detail: Number(demo.n)
      ? `${Number(demo.n)} demo account(s) can sign in. Remove the demo data before real use (npm run demo:clear).`
      : 'No demo accounts.',
  });
  return { production: config.isProduction, checks };
}

module.exports = { check, configurationChecks, EXAMPLE_JWT_SECRET };
