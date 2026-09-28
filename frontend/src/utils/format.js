import { DateTime } from 'luxon';
import { useAuthStore } from '../store/authStore';

/**
 * Centralized formatting. Currency, locale, decimals, time zone and 12/24h
 * clock all come from Settings, so nothing is hard-coded in components.
 */
const DEFAULTS = {
  currency: 'TZS',
  decimals: 0,
  locale: 'en-TZ',
  timezone: 'Africa/Dar_es_Salaam',
  timeFormat: '24h',
};

export function getFormatSettings() {
  const s = useAuthStore.getState().settings;
  return {
    currency: s?.financial?.currency_code || DEFAULTS.currency,
    decimals: s?.financial?.currency_decimals ?? DEFAULTS.decimals,
    locale: s?.financial?.currency_locale || DEFAULTS.locale,
    timezone: s?.system?.timezone || DEFAULTS.timezone,
    timeFormat: s?.system?.time_format || DEFAULTS.timeFormat,
  };
}

const moneyFormatters = new Map();

function moneyFormatter(locale, currency, decimals) {
  const key = `${locale}|${currency}|${decimals}`;
  if (!moneyFormatters.has(key)) {
    let formatter;
    try {
      formatter = new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    } catch {
      formatter = new Intl.NumberFormat('en', { style: 'currency', currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    }
    moneyFormatters.set(key, formatter);
  }
  return moneyFormatters.get(key);
}

/** Format an amount in the configured currency, e.g. "TSh 25,000". */
export function formatMoney(amount, { compact = false } = {}) {
  const { currency, decimals, locale } = getFormatSettings();
  const value = Number(amount || 0);
  if (compact && Math.abs(value) >= 1_000) {
    return new Intl.NumberFormat(locale, { style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1 }).format(value);
  }
  return moneyFormatter(locale, currency, decimals).format(value);
}

export function formatNumber(value, options = {}) {
  const { locale } = getFormatSettings();
  return new Intl.NumberFormat(locale, options).format(Number(value || 0));
}

export function formatPercent(value, digits = 1) {
  return `${Number(value || 0).toFixed(digits)}%`;
}

function toDateTime(value) {
  if (!value) return null;
  if (value instanceof Date) return DateTime.fromJSDate(value);
  return DateTime.fromISO(String(value), { setZone: false });
}

function timePattern() {
  return getFormatSettings().timeFormat === '12h' ? 'h:mm a' : 'HH:mm';
}

/** A UTC timestamp shown in the business time zone. */
export function formatDateTime(value) {
  const dt = toDateTime(value);
  if (!dt?.isValid) return '—';
  return dt.setZone(getFormatSettings().timezone).toFormat(`dd LLL yyyy, ${timePattern()}`);
}

export function formatTime(value) {
  const dt = toDateTime(value);
  if (!dt?.isValid) return '—';
  return dt.setZone(getFormatSettings().timezone).toFormat(timePattern());
}

/** Date part of a UTC timestamp, or a plain YYYY-MM-DD business date. */
export function formatDate(value, pattern = 'dd LLL yyyy') {
  if (!value) return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    const d = DateTime.fromISO(value);
    return d.isValid ? d.toFormat(pattern) : '—';
  }
  const dt = toDateTime(value);
  return dt?.isValid ? dt.setZone(getFormatSettings().timezone).toFormat(pattern) : '—';
}

export function formatRelative(value) {
  const dt = toDateTime(value);
  if (!dt?.isValid) return '';
  return dt.toRelative() || '';
}

/** Current moment in the business time zone. */
export function nowInBusinessZone() {
  return DateTime.now().setZone(getFormatSettings().timezone);
}

export function todayISO() {
  return nowInBusinessZone().toISODate();
}

/** Convert a business-local date + "HH:mm" into an ISO string with offset. */
export function localToISO(date, time) {
  return DateTime.fromISO(`${date}T${time}`, { zone: getFormatSettings().timezone }).toISO({ suppressMilliseconds: true });
}

export function toBusinessZone(value) {
  const dt = toDateTime(value);
  return dt?.isValid ? dt.setZone(getFormatSettings().timezone) : null;
}

export function formatDuration(minutes) {
  const m = Number(minutes || 0);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

export function initials(name = '') {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('');
}

export function titleCase(value = '') {
  return String(value).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
