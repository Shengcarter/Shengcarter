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

// InnoDB resolves lock cycles by rolling one transaction back; that
// transaction is safe to run again from the start.
const RETRYABLE = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);
const MAX_ATTEMPTS = 3;

/**
 * Run `work(conn)` in a transaction: commit on success, roll back on error,
 * so multi-step business operations (sales, refunds, purchases...) are never
 * partially saved. Deadlocks between concurrent requests are retried
 * automatically, so work must only change the database (side effects belong
 * after the commit).
 */
async function withTransaction(work) {
  for (let attempt = 1; ; attempt += 1) {
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
      if (RETRYABLE.has(error.code) && attempt < MAX_ATTEMPTS) {
        logger.warn({ code: error.code, attempt }, 'Transaction conflict — retrying');
        await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.floor(Math.random() * 30)));
        continue;
      }
      throw error;
    } finally {
      conn.release();
    }
  }
}

async function ping() {
  await pool.query('SELECT 1');
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, queryOne, withTransaction, ping, close };
