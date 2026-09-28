'use strict';

const { DateTime } = require('luxon');
const settings = require('../services/settingsService');

/** Server-side formatting for PDFs, exports and messages (mirrors the frontend). */
const cache = new Map();

function formatMoney(amount) {
  const currency = settings.get('financial.currency_code') || 'TZS';
  const decimals = Number(settings.get('financial.currency_decimals') ?? 0);
  const locale = settings.get('financial.currency_locale') || 'en-TZ';
  const key = `${locale}|${currency}|${decimals}`;
  if (!cache.has(key)) {
    let formatter;
    try {
      formatter = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    } catch {
      formatter = new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    cache.set(key, formatter);
  }
  return cache.get(key).format(Number(amount || 0));
}

function formatNumber(value, decimals = 0) {
  return new Intl.NumberFormat('en', { maximumFractionDigits: decimals }).format(Number(value || 0));
}

function tz() {
  return settings.get('system.timezone') || 'Africa/Dar_es_Salaam';
}

function timePattern() {
  return settings.get('system.time_format') === '12h' ? 'h:mm a' : 'HH:mm';
}

function formatDateTime(value) {
  if (!value) return '';
  return DateTime.fromJSDate(new Date(value)).setZone(tz()).toFormat(`dd LLL yyyy, ${timePattern()}`);
}

function formatDate(value) {
  if (!value) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return DateTime.fromISO(value).toFormat('dd LLL yyyy');
  return DateTime.fromJSDate(new Date(value)).setZone(tz()).toFormat('dd LLL yyyy');
}

const titleCase = (value = '') => String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

module.exports = { formatMoney, formatNumber, formatDateTime, formatDate, titleCase };
