import { describe, expect, test } from 'vitest';
import { bucketLabel, PRESETS, presetRange } from './periods';

describe('report periods', () => {
  test('every preset produces a valid ordered range', () => {
    for (const { value } of PRESETS.filter((p) => p.value !== 'custom')) {
      const { from, to } = presetRange(value);
      expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(from <= to).toBe(true);
    }
  });

  test('last month covers the whole previous month', () => {
    const { from, to } = presetRange('last_month');
    expect(from.endsWith('-01')).toBe(true);
    expect(Number(to.slice(8))).toBeGreaterThanOrEqual(28);
  });

  test('bucket labels', () => {
    expect(bucketLabel('2026-09-01', 'month', true)).toBe('September 2026');
    expect(bucketLabel('2026-09-07', 'week', true)).toBe('Week of 07 Sep 2026');
    expect(bucketLabel('2026-01-01', 'year')).toBe('2026');
  });
});
