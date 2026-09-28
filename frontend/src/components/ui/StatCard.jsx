import { motion } from 'framer-motion';
import { TrendingDown, TrendingUp } from 'lucide-react';
import { cn } from '../../utils/cn';
import { Skeleton } from './Feedback';

/** KPI tile: label, headline value, optional trend and caption. */
export function StatCard({ label, value, icon: Icon, caption, trend, tone = 'gold', loading, onClick, className, index = 0 }) {
  const Tag = onClick ? motion.button : motion.div;
  const toneClass = {
    gold: 'bg-gold-500/12 text-accent ring-gold-500/20',
    pink: 'bg-blush-200/40 text-blush-500 ring-blush-300/30 dark:bg-blush-200/10 dark:text-blush-200',
    success: 'bg-green-500/10 text-success ring-green-500/20',
    warning: 'bg-amber-500/10 text-warning ring-amber-500/20',
    danger: 'bg-red-500/10 text-danger ring-red-500/20',
    neutral: 'bg-surface-3 text-muted ring-line',
  }[tone];

  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
      className={cn(
        'card flex w-full flex-col gap-3 p-4 text-left sm:p-5',
        onClick && 'transition-colors hover:border-gold-500/40',
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
        <div className="text-2xl font-semibold tracking-tight text-fg sm:text-[1.65rem]">{value}</div>
      )}
      {caption || trend !== undefined ? (
        <div className="flex items-center gap-2 text-xs text-muted">
          {trend !== undefined && trend !== null ? (
            <span className={cn('inline-flex items-center gap-0.5 font-medium', trend >= 0 ? 'text-success' : 'text-danger')}>
              {trend >= 0 ? <TrendingUp className="size-3.5" /> : <TrendingDown className="size-3.5" />}
              {Math.abs(trend).toFixed(1)}%
            </span>
          ) : null}
          {caption ? <span className="truncate">{caption}</span> : null}
        </div>
      ) : null}
    </Tag>
  );
}
