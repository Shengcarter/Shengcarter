'use strict';

/**
 * Container start-up for ZOLA STYLISH MANAGEMENT SYSTEM:
 *   1. wait until MySQL accepts connections,
 *   2. apply migrations (creates the schema on first start),
 *   3. seed reference data and the first Super Admin (idempotent),
 *   4. start the API server.
 */
const mysql = require('mysql2/promise');
const config = require('../src/config');

async function waitForDatabase(timeoutMs = 120_000) {
  const started = Date.now();
  for (;;) {
    try {
      const conn = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password });
      await conn.end();
      return;
    } catch (error) {
      if (Date.now() - started > timeoutMs) throw new Error(`Database not reachable at ${config.db.host}:${config.db.port}: ${error.message}`);
      console.log(`• Waiting for the database (${error.code || error.message})...`);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}

(async () => {
  try {
    await waitForDatabase();
    await require('./migrate')();
    await require('./seed')();
  } catch (error) {
    console.error(`✖ Start-up failed: ${error.message}`);
    process.exit(1);
  }
  require('../src/server');
})();
