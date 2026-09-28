'use strict';

/**
 * Create a database backup from the command line (also used by backup.bat).
 * The file is written to BACKUP_DIR and listed in Settings → Backups.
 *
 * Usage: npm run backup
 */
const config = require('../src/config');
const db = require('../src/config/database');
const settings = require('../src/services/settingsService');
const backupService = require('../src/services/backupService');

(async () => {
  try {
    await settings.load();
    const backup = await backupService.createBackup({ type: 'manual' });
    const kb = Math.round((backup.sizeBytes || 0) / 1024);
    console.log(`✔ Backup created: ${config.paths.backups}/${backup.filename} (${kb} KB)`);
    await db.close();
    process.exit(0);
  } catch (error) {
    console.error(`✖ Backup failed: ${error.message}`);
    await db.close().catch(() => {});
    process.exit(1);
  }
})();
