import { AlertCircle, CalendarDays, CreditCard, Package, UserPlus } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatRelative } from '../../utils/format';

const CATEGORY = {
  appointment: { icon: CalendarDays, className: 'bg-blue-500/10 text-info' },
  inventory: { icon: Package, className: 'bg-amber-500/10 text-warning' },
  payment: { icon: CreditCard, className: 'bg-green-500/10 text-success' },
  customer: { icon: UserPlus, className: 'bg-blush-200/40 text-blush-500 dark:bg-blush-200/10 dark:text-blush-200' },
  system: { icon: AlertCircle, className: 'bg-brand-500/10 text-accent' },
};

export function NotificationItem({ notification, onClick, compact }) {
  const meta = CATEGORY[notification.category] || CATEGORY.system;
  const unread = !notification.readAt;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-surface-2',
        unread && 'bg-brand-500/[0.04]',
      )}
    >
      <span className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', meta.className)}>
        <meta.icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn('truncate text-sm', unread ? 'font-semibold text-fg' : 'font-medium text-fg/90')}>{notification.title}</span>
          {unread ? <span className="size-2 shrink-0 rounded-full bg-brand-500" aria-label="Unread" /> : null}
        </span>
        <span className={cn('block text-sm text-muted', compact && 'line-clamp-2')}>{notification.message}</span>
        <span className="mt-1 block text-xs text-muted/80">{formatRelative(notification.createdAt)}</span>
      </span>
    </button>
  );
}
