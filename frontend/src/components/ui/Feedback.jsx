import { AlertTriangle, Inbox, Loader2, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../utils/cn';
import { Button } from './Button';

export function Spinner({ className, label = 'Loading' }) {
  return (
    <span role="status" className={cn('inline-flex items-center gap-2 text-muted', className)}>
      <Loader2 className="size-5 animate-spin text-gold-500" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function PageLoader() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner label="Loading page" />
    </div>
  );
}

export function Skeleton({ className, style }) {
  return <div className={cn('skeleton h-4', className)} style={style} aria-hidden />;
}

export function SkeletonRows({ rows = 5, className }) {
  return (
    <div className={cn('space-y-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}
    >
      <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-gold-500/10 text-accent ring-1 ring-gold-500/20">
        <Icon className="size-6" aria-hidden />
      </div>
      <h3 className="font-display text-lg font-semibold text-fg">{title}</h3>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </motion.div>
  );
}

export function ErrorState({ error, onRetry, className }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-red-500/10 text-danger">
        <AlertTriangle className="size-6" aria-hidden />
      </div>
      <h3 className="font-semibold text-fg">Something went wrong</h3>
      <p className="mt-1 max-w-sm text-sm text-muted">{error?.message || 'The data could not be loaded.'}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" icon={RefreshCw} onClick={onRetry} className="mt-4">
          Try again
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Render the right state for a TanStack Query result: loading skeleton,
 * error with retry, empty state, or the content.
 */
export function QueryState({ query, isEmpty, empty, loading, children }) {
  if (query.isPending) return loading || <SkeletonRows />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  if (isEmpty?.(query.data)) return empty;
  return children(query.data);
}
