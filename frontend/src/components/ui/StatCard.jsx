import { motion } from 'framer-motion';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Skeleton } from './Feedback';

/** KPI tile: label, headline value, optional trend and caption. */
export function StatCard({ label, value, icon: Icon, caption, trend, tone = 'brand', loading, onClick, className, index = 0 }) {
  const Tag = onClick ? motion.button : motion.div;
  // Icon badge colour, and the thin card border in the same hue.
  const [toneClass, borderClass] = {
    brand: ['bg-brand-500/12 text-accent ring-brand-500/20', 'border-brand-500/30'],
    pink: ['bg-blush-200/40 text-blush-500 ring-blush-300/30 dark:bg-blush-200/10 dark:text-blush-200', 'border-blush-400/40'],
    blue: ['bg-sky-500/10 text-info ring-sky-500/20', 'border-sky-500/35'],
    purple: ['bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300', 'border-violet-500/35'],
    teal: ['bg-teal-500/10 text-teal-700 ring-teal-500/20 dark:text-teal-300', 'border-teal-500/35'],
    success: ['bg-green-500/10 text-success ring-green-500/20', 'border-green-500/35'],
    warning: ['bg-amber-500/10 text-warning ring-amber-500/20', 'border-amber-500/40'],
    danger: ['bg-red-500/10 text-danger ring-red-500/20', 'border-red-500/35'],
    neutral: ['bg-surface-3 text-muted ring-line', ''],
  }[tone];

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className={cn(
        'card @container flex w-full min-w-0 flex-col gap-3 p-4 text-left sm:p-5',
        borderClass,
        onClick && 'transition-colors hover:border-brand-500/60',
        className,
      )}
    >
      <div className="flex min-h-9 items-center justify-between gap-3">
        <span className="text-sm font-medium text-muted">{label}</span>
        {Icon ? (
          <span className={cn('flex size-9 items-center justify-center rounded-xl ring-1', toneClass)}>
            <Icon className="size-4.5" aria-hidden />
          </span>
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-28" />
      ) : (
        <div className="text-lg font-semibold tracking-tight break-words text-fg @[10rem]:text-xl @[13rem]:text-2xl @[16rem]:text-[1.65rem]">{value}</div>
      )}
      {caption || trend !== undefined ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
          {trend !== undefined && trend !== null ? (
            <span className={cn('inline-flex items-center gap-0.5 font-medium', trend >= 0 ? 'text-success' : 'text-danger')}>
              {trend >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
              {Math.abs(trend).toFixed(1)}%
            </span>
          ) : null}
          {caption ? <span className="min-w-0">{caption}</span> : null}
        </div>
      ) : null}
    </Tag>
  );
}
