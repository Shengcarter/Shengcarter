'use strict';

/**
 * Database migrations for ZOLA STYLISH MANAGEMENT SYSTEM.
 *
 *   1. Creates the database if it does not exist.
 *   2. On a fresh database, applies database/schema.sql (the baseline).
 *   3. Applies every database/migrations/NNN_name.sql file not yet applied,
 *      in file-name order, recording each in `schema_migrations`.
 *
 * Usage: npm run migrate
 */
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const { connect, ensureDatabase, runSqlFile } = require('./lib/db');

async function migrate({ silent = false } = {}) {
  const log = (msg) => !silent && console.log(msg);
  await ensureDatabase();
  const conn = await connect();

  try {
    const [tables] = await conn.query(
      "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = ? AND table_name = 'schema_migrations'",
      [config.db.database],
    );

    if (Number(tables[0].total) === 0) {
      log('• Applying baseline schema (database/schema.sql)...');
      await runSqlFile(conn, path.join(config.paths.database, 'schema.sql'));
      await conn.query("INSERT IGNORE INTO schema_migrations (version) VALUES ('000_baseline')");
    }

    const [appliedRows] = await conn.query('SELECT version FROM schema_migrations');
    const applied = new Set(appliedRows.map((r) => r.version));
    const dir = path.join(config.paths.database, 'migrations');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort() : [];

    let count = 0;
    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) continue;
      log(`• Applying migration ${file}...`);
      await runSqlFile(conn, path.join(dir, file));
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
      count += 1;
    }
    log(count ? `✔ ${count} migration(s) applied.` : '✔ Database schema is up to date.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error(`✖ Migration failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = migrate;
