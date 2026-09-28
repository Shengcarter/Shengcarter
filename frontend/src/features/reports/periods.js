import { DateTime } from 'luxon';
import { nowInBusinessZone } from '../../utils/format';

/** Date-range presets, calculated in the business time zone. */
export const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This week' },
  { value: 'last_7', label: 'Last 7 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30', label: 'Last 30 days' },
  { value: 'last_90', label: 'Last 90 days' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'this_year', label: 'This year' },
  { value: 'last_year', label: 'Last year' },
  { value: 'custom', label: 'Custom range' },
];

export function presetRange(preset) {
  const today = nowInBusinessZone().startOf('day');
  const iso = (d) => d.toISODate();
  switch (preset) {
    case 'today':
      return { from: iso(today), to: iso(today) };
    case 'yesterday':
      return { from: iso(today.minus({ days: 1 })), to: iso(today.minus({ days: 1 })) };
    case 'this_week':
      return { from: iso(today.startOf('week')), to: iso(today) };
    case 'last_7':
      return { from: iso(today.minus({ days: 6 })), to: iso(today) };
    case 'last_month': {
      const start = today.minus({ months: 1 }).startOf('month');
      return { from: iso(start), to: iso(start.endOf('month')) };
    }
    case 'last_30':
      return { from: iso(today.minus({ days: 29 })), to: iso(today) };
    case 'last_90':
      return { from: iso(today.minus({ days: 89 })), to: iso(today) };
    case 'this_quarter':
      return { from: iso(today.startOf('quarter')), to: iso(today) };
    case 'this_year':
      return { from: iso(today.startOf('year')), to: iso(today) };
    case 'last_year': {
      const start = today.minus({ years: 1 }).startOf('year');
      return { from: iso(start), to: iso(start.endOf('year')) };
    }
    default:
      return { from: iso(today.startOf('month')), to: iso(today) };
  }
}

/** Axis / tooltip label for a series bucket. */
export function bucketLabel(value, groupBy, long = false) {
  const dt = DateTime.fromISO(value);
  if (!dt.isValid) return value;
  if (groupBy === 'month') return dt.toFormat(long ? 'LLLL yyyy' : 'LLL yy');
  if (groupBy === 'year') return dt.toFormat('yyyy');
  if (groupBy === 'week') return long ? `Week of ${dt.toFormat('dd LLL yyyy')}` : dt.toFormat('dd LLL');
  return dt.toFormat(long ? 'ccc dd LLL yyyy' : 'dd LLL');
}
