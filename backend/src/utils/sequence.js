'use strict';

const db = require('../config/database');

/**
 * Get the next value of a named sequence. MUST be called with a transaction
 * connection: the row lock taken by the increment guarantees unique, gap-free
 * numbers even when several cashiers complete sales at the same moment.
 */
async function nextSequenceValue(conn, name) {
  if (!conn) throw new Error('nextSequenceValue requires a transaction connection');
  // One atomic statement takes the row lock and increments; LAST_INSERT_ID(expr)
  // hands the new value back to this connection only. Rolling the transaction
  // back also rolls the number back, so numbering stays gap-free.
  const updated = await db.query('UPDATE sequences SET current_value = LAST_INSERT_ID(current_value + 1) WHERE name = ?', [name], conn);
  if (!updated.affectedRows) {
    await db.query(
      'INSERT INTO sequences (name, current_value) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE current_value = LAST_INSERT_ID(current_value + 1)',
      [name],
      conn,
    );
  }
  const row = await db.queryOne('SELECT LAST_INSERT_ID() AS value', [], conn);
  return Number(row.value);
}

function formatNumber(prefix, value, padding = 6) {
  return `${prefix}${String(value).padStart(padding, '0')}`;
}

async function nextCode(conn, name, prefix, padding) {
  const value = await nextSequenceValue(conn, name);
  return formatNumber(prefix, value, padding);
}

module.exports = { nextSequenceValue, nextCode, formatNumber };
