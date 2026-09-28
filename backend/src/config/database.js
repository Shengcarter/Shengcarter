'use strict';

const mysql = require('mysql2/promise');
const config = require('./index');
const logger = require('./logger');

/**
 * MySQL connection pool.
 *
 * - All queries use `?` placeholders (values are escaped by the driver), so
 *   user input is never concatenated into SQL.
 * - Sessions run in UTC; the application converts to the business time zone.
 * - DECIMAL columns are returned as numbers for convenience. Every financial
 *   calculation is re-done with decimal.js on the server (see utils/money.js).
 */
const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  connectionLimit: config.db.connectionLimit,
  waitForConnections: true,
  queueLimit: 0,
  timezone: 'Z',
  charset: 'utf8mb4',
  decimalNumbers: true,
  // DATE columns (business-local dates) stay plain 'YYYY-MM-DD' strings.
  dateStrings: ['DATE'],
  supportBigNumbers: true,
  enableKeepAlive: true,
});

pool.on('connection', (connection) => {
  connection.query("SET time_zone = '+00:00'");
});

/** Run a query and return all rows. Pass `conn` to run inside a transaction. */
async function query(sql, params = [], conn = null) {
  const [rows] = await (conn || pool).query(sql, params);
  return rows;
}

/** Run a query and return the first row or null. */
async function queryOne(sql, params = [], conn = null) {
  const rows = await query(sql, params, conn);
  return rows[0] || null;
}

/**
 * Execute `work(conn)` inside a database transaction. Commits when the
 * callback resolves and rolls back when it throws, so multi-step business
 * operations (sales, refunds, purchases...) are never partially saved.
 */
async function withTransaction(work) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await work(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch (rollbackError) {
      logger.error({ err: rollbackError }, 'Transaction rollback failed');
    }
    throw error;
  } finally {
    conn.release();
  }
}

async function ping() {
  await pool.query('SELECT 1');
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, queryOne, withTransaction, ping, close };
