'use strict';

const fs = require('fs');
const mysql = require('mysql2/promise');
const config = require('../../src/config');

const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

/** Connection for maintenance scripts (multiple statements enabled). */
async function connect({ withDatabase = true } = {}) {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: withDatabase ? config.db.database : undefined,
    multipleStatements: true,
    timezone: 'Z',
    charset: 'utf8mb4',
    decimalNumbers: true,
    dateStrings: ['DATE'],
  });
  await conn.query("SET time_zone = '+00:00'");
  return conn;
}

async function ensureDatabase() {
  if (!SAFE_IDENTIFIER.test(config.db.database)) {
    throw new Error('DATABASE_NAME may only contain letters, numbers and underscores');
  }
  const conn = await connect({ withDatabase: false });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await conn.end();
  }
}

async function runSqlFile(conn, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  await conn.query(sql);
}

module.exports = { connect, ensureDatabase, runSqlFile };
