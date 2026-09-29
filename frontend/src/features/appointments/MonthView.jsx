import { cn } from '../../utils/cn';
import { formatTime, todayISO } from '../../utils/format';
import { dt, localDateOf, rangeForView } from './calendarUtils';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Month overview. Clicking a day opens it in the day view. */
export function MonthView({ date, events, onDayClick, onEventClick }) {
  const { from } = rangeForView('month', date);
  const month = dt(date).month;
  const today = todayISO();
  const days = Array.from({ length: 42 }, (_, i) => dt(from).plus({ days: i }).toISODate());
  const byDay = new Map();
  for (const e of events) {
    const key = localDateOf(e.startTime);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(e);
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[42rem] grid-cols-7 border-b border-line text-xs font-medium tracking-wide text-muted uppercase">
        {WEEKDAYS.map((d) => <div key={d} className="px-2 py-2 text-center">{d}</div>)}
      </div>
      <div className="grid min-w-[42rem] grid-cols-7">
        {days.map((day) => {
          const list = (byDay.get(day) || []).filter((e) => e.status !== 'cancelled');
          const inMonth = dt(day).month === month;
          return (
            <div key={day} className={cn('min-h-28 border-r border-b border-line p-1.5 last:border-r-0', !inMonth && 'bg-surface-2/40')}>
              <button
                type="button"
                onClick={() => onDayClick(day)}
                className={cn(
                  'mb-1 flex size-7 items-center justify-center rounded-full text-sm',
                  day === today ? 'bg-brand-500 font-semibold text-white' : inMonth ? 'text-fg hover:bg-surface-2' : 'text-muted',
                )}
                aria-label={`Open ${dt(day).toFormat('cccc dd LLLL')}`}
              >
                {dt(day).day}
              </button>
              <div className="space-y-0.5">
                {list.slice(0, 3).map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onEventClick(e)}
                    className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[11px] hover:bg-surface-2"
                  >
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: e.employeeColor }} aria-hidden />
                    <span className="text-muted tabular-nums">{formatTime(e.startTime)}</span>
                    <span className="truncate">{e.customerName}</span>
                  </button>
                ))}
                {list.length > 3 ? (
                  <button type="button" onClick={() => onDayClick(day)} className="px-1 text-[11px] font-medium text-accent hover:underline">
                    +{list.length - 3} more
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
