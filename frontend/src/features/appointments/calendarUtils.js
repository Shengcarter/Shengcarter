import { DateTime } from 'luxon';
import { getFormatSettings, toBusinessZone } from '../../utils/format';

/** Calendar maths — everything is computed in the business time zone. */
export const PX_PER_MIN = 1.4;

export function zone() {
  return getFormatSettings().timezone;
}

export function dt(isoDate) {
  return DateTime.fromISO(isoDate, { zone: zone() });
}

export function startOfWeek(isoDate) {
  const d = dt(isoDate);
  return d.minus({ days: d.weekday - 1 }).toISODate(); // weeks start on Monday
}

export function rangeForView(view, isoDate) {
  if (view === 'day') return { from: isoDate, to: isoDate };
  if (view === 'week') {
    const from = startOfWeek(isoDate);
    return { from, to: dt(from).plus({ days: 6 }).toISODate() };
  }
  // Month grid: whole weeks covering the month.
  const first = dt(isoDate).startOf('month');
  const from = startOfWeek(first.toISODate());
  const last = first.endOf('month');
  const to = dt(startOfWeek(last.toISODate())).plus({ days: 6 }).toISODate();
  return { from, to };
}

export function shiftDate(view, isoDate, direction) {
  const unit = view === 'month' ? { months: direction } : view === 'week' ? { weeks: direction } : { days: direction };
  return dt(isoDate).plus(unit).toISODate();
}

export function titleForView(view, isoDate) {
  const d = dt(isoDate);
  if (view === 'day') return d.toFormat('cccc, dd LLLL yyyy');
  if (view === 'week') {
    const { from, to } = rangeForView('week', isoDate);
    const a = dt(from);
    const b = dt(to);
    return a.month === b.month ? `${a.toFormat('dd')} – ${b.toFormat('dd LLLL yyyy')}` : `${a.toFormat('dd LLL')} – ${b.toFormat('dd LLL yyyy')}`;
  }
  return d.toFormat('LLLL yyyy');
}

/** Minutes since local midnight for an ISO timestamp. */
export function minutesOfDay(iso) {
  const d = toBusinessZone(iso);
  return d.hour * 60 + d.minute;
}

export function localDateOf(iso) {
  return toBusinessZone(iso).toISODate();
}

// A "+N more" chip is 24px tall; hidden events starting closer together than
// that share one chip so chips never cover each other.
const MORE_CHIP_MINUTES = Math.ceil(24 / PX_PER_MIN);

/**
 * Lay out one calendar column: overlapping events sit side by side in lanes,
 * each taking 1/lanes of the width.
 *
 * `fit` keeps cards readable in narrow columns (a week with every stylist):
 * a group of overlapping events that needs more than `maxLanes` lanes keeps
 * only `maxLanesWithMore` of them, marked `reserve` so the grid leaves room
 * on the right, and the rest are gathered into `more` chips
 * ({ startTime, count, events }) that open the day view.
 */
export function layoutDay(events, { maxLanes = Infinity, maxLanesWithMore = maxLanes } = {}) {
  const sorted = [...events].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  const visible = [];
  const hidden = [];
  let cluster = [];
  let clusterEnd = 0;
  const flush = () => {
    const laneEnds = [];
    for (const ev of cluster) {
      const start = new Date(ev.startTime).getTime();
      let lane = laneEnds.findIndex((end) => end <= start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(0);
      }
      laneEnds[lane] = new Date(ev.endTime).getTime();
      ev.lane = lane;
    }
    if (laneEnds.length <= maxLanes) {
      for (const ev of cluster) visible.push({ ...ev, lanes: laneEnds.length, reserve: false });
    } else {
      const keep = Math.max(1, maxLanesWithMore);
      for (const ev of cluster) {
        if (ev.lane < keep) visible.push({ ...ev, lanes: keep, reserve: true });
        else hidden.push(ev);
      }
    }
    cluster = [];
  };
  for (const ev of sorted) {
    const start = new Date(ev.startTime).getTime();
    if (cluster.length && start >= clusterEnd) flush();
    cluster.push({ ...ev });
    clusterEnd = Math.max(clusterEnd, new Date(ev.endTime).getTime());
  }
  if (cluster.length) flush();

  const more = [];
  for (const ev of hidden) {
    const start = new Date(ev.startTime).getTime();
    const last = more[more.length - 1];
    if (last && start < last.start + MORE_CHIP_MINUTES * 60_000) {
      last.count += 1;
      last.events.push(ev);
    } else {
      more.push({ start, startTime: ev.startTime, count: 1, events: [ev] });
    }
  }
  return { events: visible, more };
}

/** Lanes without any width limit (every event visible). */
export function layoutLanes(events) {
  return layoutDay(events).events;
}

/** Visible hour range from the business hours (with sensible bounds). */
export function visibleHours(businessHours) {
  let min = 8;
  let max = 20;
  for (const day of Object.values(businessHours || {})) {
    if (!day?.open) continue;
    min = Math.min(min, Number(day.start.slice(0, 2)));
    max = Math.max(max, Math.ceil(Number(day.end.slice(0, 2)) + Number(day.end.slice(3)) / 60));
  }
  return { start: Math.max(0, min - 1), end: Math.min(24, max + 1) };
}

export const STATUS_STYLES = {
  pending: 'border-l-amber-400',
  confirmed: 'border-l-sky-400',
  in_progress: 'border-l-gold-500',
  completed: 'border-l-green-500',
  cancelled: 'border-l-zinc-400 opacity-50 line-through',
  no_show: 'border-l-red-500 opacity-60',
};

export const EDITABLE_STATUSES = ['pending', 'confirmed'];
