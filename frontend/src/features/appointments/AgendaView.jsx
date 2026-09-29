import { CalendarX2, CheckCircle2 } from 'lucide-react';
import { EmptyState, StatusBadge } from '../../components/ui';
import { cn } from '../../utils/cn';
import { formatDuration, formatMoney, formatTime, todayISO } from '../../utils/format';
import { dt, localDateOf } from './calendarUtils';

/** Horizontal strip of dates for phones. */
export function DateStrip({ date, onChange }) {
  const start = dt(date).minus({ days: 3 });
  const today = todayISO();
  return (
    <div className="scrollbar-thin flex gap-1.5 overflow-x-auto pb-1">
      {Array.from({ length: 7 }, (_, i) => start.plus({ days: i })).map((d) => {
        const iso = d.toISODate();
        const active = iso === date;
        return (
          <button
            key={iso}
            type="button"
            onClick={() => onChange(iso)}
            aria-pressed={active}
            className={cn(
              'flex min-w-12 flex-1 flex-col items-center rounded-xl border px-2 py-1.5',
              active ? 'border-gold-500 bg-gold-500 text-ink-950' : 'border-line bg-surface text-fg',
            )}
          >
            <span className={cn('text-[10px] uppercase', active ? 'text-ink-950/70' : 'text-muted')}>{d.toFormat('ccc')}</span>
            <span className="text-base font-semibold">{d.day}</span>
            {iso === today && !active ? <span className="size-1 rounded-full bg-gold-500" aria-label="Today" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Chronological list of one day's appointments (phone-friendly calendar). */
export function AgendaView({ date, events, onEventClick, onCreate, canCreate }) {
  const list = events.filter((e) => localDateOf(e.startTime) === date).sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  if (!list.length) {
    return (
      <EmptyState
        icon={CalendarX2}
        title="No appointments this day"
        description="Enjoy the calm — or book someone in."
        action={canCreate ? <button type="button" onClick={onCreate} className="rounded-xl bg-gold-500 px-4 py-2 text-sm font-medium text-ink-950">New appointment</button> : null}
      />
    );
  }
  return (
    <ul className="divide-y divide-line">
      {list.map((e) => (
        <li key={e.id}>
          <button type="button" onClick={() => onEventClick(e)} className="flex w-full gap-3 px-4 py-3.5 text-left active:bg-surface-2">
            <div className="w-14 shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums">{formatTime(e.startTime)}</p>
              <p className="text-xs text-muted">{formatDuration(Math.round((new Date(e.endTime) - new Date(e.startTime)) / 60_000))}</p>
            </div>
            <span className="w-1 shrink-0 rounded-full" style={{ background: e.employeeColor }} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 truncate font-medium">
                {e.customerName}
                {e.checkedInAt && e.status !== 'completed' ? <CheckCircle2 className="size-3.5 text-success" aria-label="Checked in" /> : null}
              </p>
              <p className="truncate text-sm text-muted">{e.services}</p>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span>{e.employeeName}</span>·<span>{formatMoney(e.totalPrice)}</span>
              </p>
            </div>
            <div className="shrink-0"><StatusBadge status={e.status} /></div>
          </button>
        </li>
      ))}
    </ul>
  );
}
