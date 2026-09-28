'use strict';

const db = require('../config/database');

/**
 * Get the next value of a named sequence. MUST be called with a transaction
 * connection: the row lock (FOR UPDATE) guarantees unique, gap-free numbers
 * even when several cashiers complete sales at the same moment.
 */
async function nextSequenceValue(conn, name) {
  if (!conn) throw new Error('nextSequenceValue requires a transaction connection');
  await db.query('INSERT IGNORE INTO sequences (name, current_value) VALUES (?, 0)', [name], conn);
  const row = await db.queryOne('SELECT current_value FROM sequences WHERE name = ? FOR UPDATE', [name], conn);
  const next = Number(row.current_value) + 1;
  await db.query('UPDATE sequences SET current_value = ? WHERE name = ?', [next, name], conn);
  return next;
}

function formatNumber(prefix, value, padding = 6) {
  return `${prefix}${String(value).padStart(padding, '0')}`;
}

async function nextCode(conn, name, prefix, padding) {
  const value = await nextSequenceValue(conn, name);
  return formatNumber(prefix, value, padding);
}

module.exports = { nextSequenceValue, nextCode, formatNumber };
