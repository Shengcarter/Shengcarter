'use strict';

/**
 * Restore a backup into the database configured in .env.
 *
 * WARNING: this replaces ALL data in that database with the backup's data.
 * Stop the application first, and make a fresh backup if you might need the
 * current data.
 *
 * Usage: npm run restore -- <path-to-backup.sql.gz[.enc]> [--yes]
 * An encrypted backup (.enc) needs BACKUP_ENCRYPTION_KEY in .env; it is
 * checked in full before anything is changed.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const config = require('../src/config');
const db = require('../src/config/database');
const backupService = require('../src/services/backupService');

async function confirm(file) {
  if (process.argv.includes('--yes')) return true;
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) =>
    rl.question(`Replace ALL data in database "${config.db.database}" with ${path.basename(file)}? Type "restore" to continue: `, resolve),
  );
  rl.close();
  return answer.trim().toLowerCase() === 'restore';
}

(async () => {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!arg) {
    console.error('Usage: npm run restore -- <path-to-backup.sql.gz[.enc]> [--yes]');
    process.exit(1);
  }
  // A bare file name refers to the backup folder.
  const file = fs.existsSync(arg) ? path.resolve(arg) : path.join(config.paths.backups, arg);
  if (!fs.existsSync(file) || !/\.sql(\.gz(\.enc)?)?$/.test(file)) {
    console.error(`✖ Backup file not found (expected a .sql, .sql.gz or .sql.gz.enc file): ${arg}`);
    process.exit(1);
  }
  if (!(await confirm(file))) {
    console.log('• Restore cancelled. Nothing was changed.');
    process.exit(0);
  }
  const started = Date.now();
  try {
    console.log(`• Restoring ${path.basename(file)} into "${config.db.database}"...`);
    const result = await backupService.restoreFile(file, { onProgress: (n) => process.stdout.write(`\r  ${n} statements`) });
    console.log(`\n✔ Restore complete: ${result.statements} statements in ${Math.round((Date.now() - started) / 1000)}s.`);
    console.log('  Start the application again. Users may need to sign in again.');
    await db.close().catch(() => {});
    process.exit(0);
  } catch (error) {
    console.error(`\n✖ Restore failed: ${error.message}`);
    await db.close().catch(() => {});
    process.exit(1);
  }
})();
