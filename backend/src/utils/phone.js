'use strict';

/**
 * Normalize phone numbers to international format so "0712 345 678" and
 * "+255712345678" are recognised as the same customer.
 */
function normalizePhone(raw, countryCode = '255') {
  if (raw === null || raw === undefined) return raw;
  let value = String(raw).trim().replace(/[\s\-().]/g, '');
  if (!value) return value;
  if (value.startsWith('00')) value = `+${value.slice(2)}`;
  if (value.startsWith('+')) return value;
  if (value.startsWith('0')) return `+${countryCode}${value.slice(1)}`;
  if (value.startsWith(countryCode) && value.length > 9) return `+${value}`;
  return `+${countryCode}${value}`;
}

const PHONE_PATTERN = /^\+?[0-9\s\-().]{7,20}$/;

module.exports = { normalizePhone, PHONE_PATTERN };
