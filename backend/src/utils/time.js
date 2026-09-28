'use strict';

const { DateTime } = require('luxon');
const settings = require('../services/settingsService');

/**
 * Time zone helpers. The database stores UTC; business rules (working hours,
 * "today", daily reports) use the configured business time zone.
 */
function timezone() {
  return settings.get('system.timezone') || 'Africa/Dar_es_Salaam';
}

function nowLocal() {
  return DateTime.now().setZone(timezone());
}

function toLocal(date) {
  return DateTime.fromJSDate(date instanceof Date ? date : new Date(date)).setZone(timezone());
}

/** 'yyyy-MM-dd' of today in the business time zone. */
function todayLocal() {
  return nowLocal().toISODate();
}

/**
 * Parse an API datetime. ISO strings with an offset/Z are respected; naive
 * strings ("2026-09-28T10:30") are interpreted in the business time zone.
 */
function parseDateTime(value) {
  if (value instanceof Date) return value;
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value);
  const dt = hasZone ? DateTime.fromISO(value, { setZone: true }) : DateTime.fromISO(value, { zone: timezone() });
  if (!dt.isValid) return null;
  return dt.toJSDate();
}

/** Start (inclusive) of a business-local date as a UTC Date. */
function startOfLocalDay(isoDate) {
  return DateTime.fromISO(isoDate, { zone: timezone() }).startOf('day').toJSDate();
}

/** [start, end) UTC range covering the local dates from..to inclusive. */
function localDateRange(from, to) {
  const start = DateTime.fromISO(from, { zone: timezone() }).startOf('day');
  const end = DateTime.fromISO(to, { zone: timezone() }).plus({ days: 1 }).startOf('day');
  return { start: start.toJSDate(), end: end.toJSDate() };
}

/**
 * MySQL offset string ('+03:00') for CONVERT_TZ. Named zones need the MySQL
 * time zone tables, which are often missing on Windows, so offsets are used.
 */
function sqlOffset(referenceDate = new Date()) {
  const offset = DateTime.fromJSDate(referenceDate).setZone(timezone()).offset;
  const sign = offset >= 0 ? '+' : '-';
  const abs = Math.abs(offset);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

function localDateString(date) {
  return toLocal(date).toISODate();
}

module.exports = {
  timezone,
  nowLocal,
  toLocal,
  todayLocal,
  parseDateTime,
  startOfLocalDay,
  localDateRange,
  sqlOffset,
  localDateString,
};
