import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { initials, titleCase } from '../../utils/format';
import { useDebounce } from '../../hooks';

export function Card({ className, children, as: Tag = 'section', ...props }) {
  return (
    <Tag className={cn('card', className)} {...props}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, description, action, className, icon: Icon }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 px-5 pt-5 pb-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-accent">
            <Icon className="size-4" aria-hidden />
          </div>
        ) : null}
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-fg">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

const TONES = {
  neutral: 'bg-surface-3 text-muted',
  brand: 'bg-brand-500/15 text-accent ring-1 ring-brand-500/25',
  pink: 'bg-blush-200/60 text-blush-500 dark:bg-blush-200/15 dark:text-blush-200',
  success: 'bg-green-500/12 text-success',
  warning: 'bg-amber-500/12 text-warning',
  danger: 'bg-red-500/12 text-danger',
  info: 'bg-blue-500/12 text-info',
};

export function Badge({ tone = 'neutral', children, className, dot = false }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', TONES[tone], className)}>
      {dot ? <span className="size-1.5 rounded-full bg-current" aria-hidden /> : null}
      {children}
    </span>
  );
}

const STATUS_TONES = {
  pending: 'warning',
  confirmed: 'info',
  in_progress: 'brand',
  completed: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
  paid: 'success',
  partial: 'warning',
  unpaid: 'danger',
  refunded: 'neutral',
  voided: 'danger',
  active: 'success',
  inactive: 'neutral',
  on_leave: 'warning',
  terminated: 'danger',
  discontinued: 'neutral',
  ordered: 'info',
  received: 'success',
  approved: 'success',
  rejected: 'danger',
  present: 'success',
  late: 'warning',
  absent: 'danger',
  half_day: 'info',
  queued: 'info',
  sent: 'success',
  failed: 'danger',
  skipped: 'neutral',
  earned: 'brand',
  reversed: 'neutral',
  running: 'info',
};

export function StatusBadge({ status, label }) {
  return (
    <Badge tone={STATUS_TONES[status] || 'neutral'} dot>
      {label || titleCase(status)}
    </Badge>
  );
}

export function Avatar({ name = '', src, size = 'md', className }) {
  const dims = { xs: 'size-7 text-[10px]', sm: 'size-8 text-xs', md: 'size-10 text-sm', lg: 'size-14 text-base', xl: 'size-20 text-xl' }[size];
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    return <img src={src} alt={name} onError={() => setFailed(true)} className={cn('shrink-0 rounded-full object-cover ring-1 ring-line', dims, className)} />;
  }
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 font-semibold text-white', dims, className)}
      aria-hidden={!name}
      title={name}
    >
      {initials(name) || '?'}
    </span>
  );
}

export function PageHeader({ title, description, actions, children }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Search box that reports its value after the user stops typing. */
export function SearchInput({ value: initial = '', onChange, placeholder = 'Search…', className, delay = 300, autoFocus }) {
  const [value, setValue] = useState(initial);
  const debounced = useDebounce(value, delay);
  useEffect(() => {
    if (debounced !== initial) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-10 w-full rounded-xl border border-line bg-surface pr-9 pl-9 text-sm text-fg placeholder:text-muted/70 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value ? (
        <button
          type="button"
          onClick={() => setValue('')}
          className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1 text-muted hover:text-fg"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** Accessible tabs (roving focus with arrow keys). */
export function Tabs({ tabs, value, onChange, className }) {
  const onKeyDown = (event, index) => {
    if (!['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[next].value);
    document.getElementById(`tab-${tabs[next].value}`)?.focus();
  };
  return (
    <div role="tablist" className={cn('scrollbar-thin -mx-1 flex gap-1 overflow-x-auto px-1 pb-1', className)}>
      {tabs.map((tab, index) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            id={`tab-${tab.value}`}
            role="tab"
            type="button"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, index)}
            onClick={() => onChange(tab.value)}
            className={cn(
              'relative flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
              active ? 'text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
            )}
          >
            {active ? (
              <motion.span layoutId={`tabs-indicator-${tabs[0].value}`} className="absolute inset-0 rounded-lg bg-surface-2 ring-1 ring-line" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
            ) : null}
            <span className="relative flex items-center gap-2">
              {tab.icon ? <tab.icon className="size-4" aria-hidden /> : null}
              {tab.label}
              {tab.count !== undefined ? <span className="rounded-full bg-surface-3 px-1.5 text-[11px] text-muted">{tab.count}</span> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Label/value pair used in detail panels. */
export function Detail({ label, children, className }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs font-medium tracking-wide text-muted uppercase">{label}</dt>
      <dd className="mt-1 text-sm break-words text-fg">{children ?? '—'}</dd>
    </div>
  );
}

/** Segmented control for small option sets (e.g. Day / Week / Month). */
export function Segmented({ options, value, onChange, className, size = 'md' }) {
  return (
    <div role="radiogroup" className={cn('inline-flex rounded-xl border border-line bg-surface-2 p-1', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'rounded-lg font-medium transition-colors',
            size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm',
            value === option.value ? 'bg-surface text-fg shadow-sm ring-1 ring-line' : 'text-muted hover:text-fg',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
