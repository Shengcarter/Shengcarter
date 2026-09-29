'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');
const cron = require('node-cron');
const mysql = require('mysql2/promise');
const config = require('../config');
const db = require('../config/database');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const { camelizeRows, camelizeRow } = require('../utils/case');
const settings = require('./settingsService');
const audit = require('./auditService');

/**
 * Database backups for ZOLA STYLISH MANAGEMENT SYSTEM.
 *
 * A backup is a gzip-compressed SQL file written with plain Node.js (no
 * mysqldump needed, so it works the same on Windows, Linux and Docker). Files
 * live in BACKUP_DIR, outside the public web root, and can only be downloaded
 * by users with the backups.manage permission. Scheduled backups follow the
 * cron expression and retention count in Settings → Backups.
 *
 * Restore with `npm run restore -- <file>` (see scripts/restore.js).
 */

const FILE_PATTERN = /^zola-backup-\d{8}-\d{6}(-[a-z]+)?\.sql\.gz$/;
const BATCH = 500;
let scheduledTask = null;
let running = false;

function backupDir() {
  fs.mkdirSync(config.paths.backups, { recursive: true });
  return config.paths.backups;
}

/** Absolute path of a backup file, refusing anything outside the backup folder. */
function filePath(filename) {
  if (!FILE_PATTERN.test(filename)) throw ApiError.badRequest('Invalid backup file name');
  const dir = path.resolve(backupDir());
  const full = path.resolve(dir, filename);
  if (path.dirname(full) !== dir) throw ApiError.badRequest('Invalid backup file name');
  return full;
}

/** Dedicated connection: raw strings for dates/decimals/JSON so values round-trip exactly. */
async function dumpConnection() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    charset: 'utf8mb4',
    // JSON arrives with the binary charset; decode it as UTF-8 so non-ASCII text survives.
    typeCast: (field, next) => (field.type === 'JSON' ? field.string('utf8') : next()),
  });
  await conn.query("SET time_zone = '+00:00'");
  return conn;
}

function timestamp(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

async function writeDump(conn, out) {
  const write = (text) =>
    new Promise((resolve, reject) => {
      if (out.write(text)) resolve();
      else out.once('drain', resolve).once('error', reject);
    });
  const [[{ version }]] = await conn.query('SELECT VERSION() AS version');
  await write(`-- ${config.appName} database backup\n-- Database: ${config.db.database}\n-- Created: ${new Date().toISOString()} (UTC)\n-- Server: MySQL ${version}\n\n`);
  await write("SET NAMES utf8mb4;\nSET time_zone = '+00:00';\nSET FOREIGN_KEY_CHECKS = 0;\nSET UNIQUE_CHECKS = 0;\n\n");

  const [tables] = await conn.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY table_name",
    [config.db.database],
  );
  let rowsTotal = 0;
  for (const { name } of tables) {
    const [[create]] = await conn.query(`SHOW CREATE TABLE \`${name}\``);
    await write(`DROP TABLE IF EXISTS \`${name}\`;\n${create['Create Table']};\n`);
    // Generated columns are recalculated by MySQL, so they are not dumped.
    const [columns] = await conn.query(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? AND COALESCE(generation_expression, '') = '' ORDER BY ordinal_position`,
      [config.db.database, name],
    );
    const [keys] = await conn.query(
      "SELECT column_name AS name FROM information_schema.key_column_usage WHERE table_schema = ? AND table_name = ? AND constraint_name = 'PRIMARY' ORDER BY ordinal_position",
      [config.db.database, name],
    );
    const columnList = columns.map((c) => `\`${c.name}\``).join(', ');
    const orderBy = keys.length ? ` ORDER BY ${keys.map((k) => `\`${k.name}\``).join(', ')}` : '';
    for (let offset = 0; ; offset += BATCH) {
      const [rows] = await conn.query({ sql: `SELECT ${columnList} FROM \`${name}\`${orderBy} LIMIT ? OFFSET ?`, rowsAsArray: true }, [BATCH, offset]);
      if (!rows.length) break;
      const values = rows.map((row) => `(${row.map((v) => conn.escape(v)).join(',')})`).join(',');
      await write(`INSERT INTO \`${name}\` (${columnList}) VALUES ${values};\n`);
      rowsTotal += rows.length;
      if (rows.length < BATCH) break;
    }
    await write('\n');
  }
  await write('SET UNIQUE_CHECKS = 1;\nSET FOREIGN_KEY_CHECKS = 1;\n-- End of backup\n');
  return { tables: tables.length, rows: rowsTotal };
}

async function createBackup({ type = 'manual', ctx = null } = {}) {
  if (running) throw ApiError.conflict('A backup is already running. Please wait for it to finish.');
  running = true;
  const filename = `zola-backup-${timestamp()}${type === 'scheduled' ? '-auto' : ''}.sql.gz`;
  const full = filePath(filename);
  const record = await db.query("INSERT INTO backups (filename, type, status, created_by) VALUES (?, ?, 'running', ?)", [filename, type, ctx?.userId || null]);
  const id = record.insertId;
  const started = Date.now();
  let conn;
  try {
    conn = await dumpConnection();
    const gzip = zlib.createGzip({ level: 6 });
    const file = fs.createWriteStream(full, { mode: 0o600 });
    const finished = new Promise((resolve, reject) => {
      file.on('finish', resolve);
      file.on('error', reject);
      gzip.on('error', reject);
    });
    gzip.pipe(file);
    const stats = await writeDump(conn, gzip);
    gzip.end();
    await finished;
    const size = fs.statSync(full).size;
    await db.query("UPDATE backups SET status = 'completed', size_bytes = ?, completed_at = UTC_TIMESTAMP() WHERE id = ?", [size, id]);
    logger.info({ filename, size, ...stats, ms: Date.now() - started }, 'Backup completed');
    if (ctx) await audit.record(ctx, { action: 'backup.created', entityType: 'backup', entityId: id, description: `Created backup ${filename}` });
    await applyRetention();
    return getById(id);
  } catch (error) {
    fs.rmSync(full, { force: true });
    await db.query("UPDATE backups SET status = 'failed', error = ?, completed_at = UTC_TIMESTAMP() WHERE id = ?", [String(error.message).slice(0, 500), id]);
    logger.error({ err: error, filename }, 'Backup failed');
    throw new ApiError(500, 'The backup failed. Check the server log for details.');
  } finally {
    running = false;
    if (conn) await conn.end().catch(() => {});
  }
}

/** Keep only the newest N scheduled backups (manual backups are never removed automatically). */
async function applyRetention() {
  const keep = Number(settings.get('backup.retention_count')) || 14;
  const old = await db.query(
    "SELECT id, filename FROM backups WHERE type = 'scheduled' AND status = 'completed' ORDER BY created_at DESC, id DESC LIMIT 1000 OFFSET ?",
    [keep],
  );
  for (const b of old) {
    fs.rmSync(filePath(b.filename), { force: true });
    await db.query('DELETE FROM backups WHERE id = ?', [b.id]);
  }
}

async function getById(id) {
  const row = await db.queryOne(
    'SELECT b.*, u.full_name AS created_by_name FROM backups b LEFT JOIN users u ON u.id = b.created_by WHERE b.id = ?',
    [id],
  );
  if (!row) throw ApiError.notFound('Backup not found');
  const backup = camelizeRow(row);
  backup.fileExists = fs.existsSync(filePath(backup.filename));
  return backup;
}

async function list() {
  const rows = await db.query(
    'SELECT b.*, u.full_name AS created_by_name FROM backups b LEFT JOIN users u ON u.id = b.created_by ORDER BY b.created_at DESC, b.id DESC LIMIT 200',
  );
  return camelizeRows(rows).map((b) => ({ ...b, fileExists: FILE_PATTERN.test(b.filename) && fs.existsSync(path.join(backupDir(), b.filename)) }));
}

async function downloadInfo(id, ctx) {
  const backup = await getById(id);
  if (backup.status !== 'completed' || !backup.fileExists) throw ApiError.notFound('The backup file is not available');
  await audit.record(ctx, { action: 'backup.downloaded', entityType: 'backup', entityId: id, description: `Downloaded backup ${backup.filename}` });
  return { path: filePath(backup.filename), filename: backup.filename };
}

async function remove(id, ctx) {
  const backup = await getById(id);
  if (backup.status === 'running') throw ApiError.conflict('This backup is still running');
  fs.rmSync(filePath(backup.filename), { force: true });
  await db.query('DELETE FROM backups WHERE id = ?', [id]);
  await audit.record(ctx, { action: 'backup.deleted', entityType: 'backup', entityId: id, description: `Deleted backup ${backup.filename}` });
}

/** (Re)register the scheduled backup from Settings. Called at start-up and when settings change. */
function schedule() {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
  }
  if (!config.jobsEnabled || !settings.get('backup.auto_enabled')) return;
  const expression = settings.get('backup.cron');
  if (!cron.validate(expression)) {
    logger.warn({ expression }, 'Invalid backup schedule — scheduled backups are off');
    return;
  }
  scheduledTask = cron.schedule(
    expression,
    () => createBackup({ type: 'scheduled' }).catch((error) => logger.error({ err: error }, 'Scheduled backup failed')),
    { name: 'scheduled-backup', timezone: settings.get('system.timezone') || 'Africa/Dar_es_Salaam' },
  );
  logger.info({ expression }, 'Scheduled backups enabled');
}

/**
 * Restore a backup file into the configured database (used by scripts/restore.js).
 * Statements are executed one by one; each ends at a line that ends with ';'.
 */
async function restoreFile(file, { onProgress } = {}) {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    charset: 'utf8mb4',
    timezone: 'Z',
  });
  const input = fs.createReadStream(file).pipe(file.endsWith('.gz') ? zlib.createGunzip() : new (require('stream').PassThrough)());
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let statement = '';
  let count = 0;
  try {
    for await (const line of lines) {
      if (!statement && (line.startsWith('--') || !line.trim())) continue;
      statement += `${line}\n`;
      if (line.endsWith(';')) {
        await conn.query(statement);
        statement = '';
        count += 1;
        if (onProgress && count % 50 === 0) onProgress(count);
      }
    }
    if (statement.trim()) await conn.query(statement);
    // The backup that produced this file was still "running" when it was written.
    await conn.query("UPDATE backups SET status = 'completed', completed_at = COALESCE(completed_at, created_at) WHERE status = 'running'");
    // Recorded in the restored database, so the activity log shows when it happened.
    await conn.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, description, metadata)
       VALUES (NULL, 'backup.restored', 'backup', ?, ?)`,
      [`Restored backup ${path.basename(file)} from the server command line`, JSON.stringify({ statements: count })],
    );
    return { statements: count };
  } finally {
    await conn.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    await conn.end();
  }
}

module.exports = { createBackup, list, getById, downloadInfo, remove, schedule, restoreFile, applyRetention };
