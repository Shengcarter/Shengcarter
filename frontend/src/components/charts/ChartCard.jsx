import { useState } from 'react';
import { BarChart3, Table2 } from 'lucide-react';
import { Card, EmptyState, ErrorState, Skeleton } from '../ui';
import { cn } from '../../utils/cn';

/**
 * Card wrapper for every chart:
 *  - chart / table toggle (the table is the accessible twin of the chart)
 *  - keeps the previous render at reduced opacity while refetching
 *  - loading, error and empty states
 *
 * table: { columns: [{ key, header, format?, align? }], rows: [] }
 */
export function ChartCard({ title, description, action, loading, fetching, error, onRetry, empty, isEmpty, table, height = 260, fill = false, children, className }) {
  const [view, setView] = useState('chart');

  let body;
  if (loading) body = <Skeleton className="w-full" style={{ height }} />;
  else if (error) body = <ErrorState error={error} onRetry={onRetry} />;
  else if (isEmpty) body = empty || <EmptyState title="No data for this period" className="py-10" />;
  else if (view === 'table' && table) body = <ChartTable table={table} />;
  // `fill` lets the chart grow with its card (e.g. when a grid row is taller).
  else body = fill ? <div className="h-full" style={{ minHeight: height }}>{children}</div> : <div style={{ height }}>{children}</div>;

  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          {table && !isEmpty && !loading && !error ? (
            <div role="radiogroup" aria-label={`${title} view`} className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
              {[
                { value: 'chart', icon: BarChart3, label: 'Chart view' },
                { value: 'table', icon: Table2, label: 'Table view' },
              ].map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={view === option.value}
                  aria-label={option.label}
                  title={option.label}
                  onClick={() => setView(option.value)}
                  className={cn('rounded-md p-1.5', view === option.value ? 'bg-surface text-fg shadow-sm' : 'text-muted hover:text-fg')}
                >
                  <option.icon className="size-3.5" aria-hidden />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className={cn('flex-1 px-3 pb-4 transition-opacity sm:px-4', fill && 'flex flex-col [&>*]:flex-1', fetching && !loading && 'opacity-60')}>{body}</div>
    </Card>
  );
}

function ChartTable({ table }) {
  return (
    <div className="scrollbar-thin max-h-80 overflow-auto px-2">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
            {table.columns.map((c) => (
              <th key={c.key} scope="col" className={cn('px-2 py-2 font-medium', c.align === 'right' && 'text-right')}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {table.columns.map((c) => (
                <td key={c.key} className={cn('px-2 py-2', c.align === 'right' && 'text-right tabular-nums')}>
                  {c.format ? c.format(row[c.key], row) : row[c.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
