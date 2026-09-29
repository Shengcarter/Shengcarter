'use strict';

/**
 * Convert database rows (snake_case, TINYINT flags) into API objects
 * (camelCase, real booleans). Columns named is_* / has_* become booleans.
 */
const toCamel = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

function camelizeRow(row, booleanKeys = []) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    const camelKey = toCamel(key);
    const isFlag = /^(is|has)_/.test(key) || booleanKeys.includes(key);
    out[camelKey] = isFlag && value !== null && value !== undefined ? Boolean(value) : value;
  }
  return out;
}

function camelizeRows(rows, booleanKeys) {
  return rows.map((row) => camelizeRow(row, booleanKeys));
}

module.exports = { camelizeRow, camelizeRows, toCamel };
