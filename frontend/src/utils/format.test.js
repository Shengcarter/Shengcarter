import { beforeEach, describe, expect, test } from 'vitest';
import { useAuthStore } from '../store/authStore';
import { formatDate, formatMoney, formatPercent, formatTime, localToISO, titleCase } from './format';

const settings = (financial = {}, system = {}) => ({
  financial: { currency_code: 'TZS', currency_decimals: 0, currency_locale: 'en-TZ', ...financial },
  system: { timezone: 'Africa/Dar_es_Salaam', time_format: '24h', ...system },
});

describe('formatting follows Settings', () => {
  beforeEach(() => useAuthStore.setState({ settings: settings() }));

  test('money uses the configured currency without decimals by default', () => {
    expect(formatMoney(25000)).toMatch(/TSh\s?25,000$/);
    expect(formatMoney(0)).toMatch(/TSh\s?0$/);
  });

  test('compact money for chart axes', () => {
    expect(formatMoney(1_250_000, { compact: true })).toMatch(/1\.3M|1\.25M/);
    expect(formatMoney(900, { compact: true })).toMatch(/900/);
  });

  test('another currency and decimals', () => {
    useAuthStore.setState({ settings: settings({ currency_code: 'USD', currency_decimals: 2, currency_locale: 'en-US' }) });
    expect(formatMoney(12.5)).toBe('$12.50');
  });

  test('UTC timestamps are shown in the business time zone', () => {
    // 07:30 UTC is 10:30 in Dar es Salaam (UTC+3).
    expect(formatTime('2026-09-28T07:30:00.000Z')).toBe('10:30');
    useAuthStore.setState({ settings: settings({}, { time_format: '12h' }) });
    expect(formatTime('2026-09-28T07:30:00.000Z')).toBe('10:30 AM');
  });

  test('calendar dates are not shifted by time zones', () => {
    expect(formatDate('2026-01-01')).toBe('01 Jan 2026');
  });

  test('local date + time converts to a UTC instant', () => {
    expect(localToISO('2026-09-28', '10:30')).toBe('2026-09-28T10:30:00+03:00');
    expect(new Date(localToISO('2026-09-28', '10:30')).toISOString()).toBe('2026-09-28T07:30:00.000Z');
  });

  test('helpers', () => {
    expect(formatPercent(12.345)).toBe('12.3%');
    expect(titleCase('mobile_money')).toBe('Mobile Money');
  });
});
