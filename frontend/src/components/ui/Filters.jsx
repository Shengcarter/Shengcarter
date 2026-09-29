import { cn } from '../../utils/cn';

const control = 'h-10 min-w-0 rounded-xl border border-line bg-surface px-3 text-sm text-fg focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none';

/** From / to date inputs that share one row, even on phones. */
export function DateRange({ from, to, onChange, className }) {
  return (
    <div className={cn('flex w-full items-center gap-2 sm:w-auto', className)}>
      <input
        type="date"
        aria-label="From"
        max={to || undefined}
        className={cn(control, 'flex-1 sm:flex-none')}
        value={from || ''}
        onChange={(e) => onChange({ from: e.target.value, to })}
      />
      <span className="text-muted" aria-hidden>–</span>
      <input
        type="date"
        aria-label="To"
        min={from || undefined}
        className={cn(control, 'flex-1 sm:flex-none')}
        value={to || ''}
        onChange={(e) => onChange({ from, to: e.target.value })}
      />
    </div>
  );
}

/** Compact select used in list filter bars. */
export function FilterSelect({ label, value, onChange, className, children }) {
  return (
    <select aria-label={label} className={cn(control, className)} value={value} onChange={(e) => onChange(e.target.value)}>
      {children}
    </select>
  );
}

/** Wraps filter selects: two per row on phones, inline from `sm` up. */
export function FilterGroup({ className, children }) {
  return <div className={cn('grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap', className)}>{children}</div>;
}
