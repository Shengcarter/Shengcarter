import { ChevronLeft, ChevronRight, ArrowDown, ArrowUp } from 'lucide-react';
import { cn } from '../../utils/cn';
import { SkeletonRows, EmptyState, ErrorState } from './Feedback';
import { formatNumber } from '../../utils/format';

/**
 * Responsive data table.
 * - md and up: a real <table> with optional sortable headers.
 * - phones: each row becomes a card. Columns marked `primary` form the card
 *   title; `hideOnMobile` columns are omitted.
 *
 * columns: [{ key, header, render?, className?, align?, sortable?, primary?, hideOnMobile? }]
 */
export function DataTable({
  columns,
  rows = [],
  loading,
  error,
  onRetry,
  empty,
  onRowClick,
  rowKey = 'id',
  sort,
  onSortChange,
  className,
}) {
  if (loading) return <SkeletonRows rows={6} className="p-4" />;
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  if (!rows.length) return empty || <EmptyState title="Nothing here yet" />;

  const renderCell = (column, row) => (column.render ? column.render(row) : row[column.key] ?? '—');
  const primary = columns.filter((c) => c.primary);
  const secondary = columns.filter((c) => !c.primary && !c.hideOnMobile);

  const toggleSort = (column) => {
    if (!column.sortable || !onSortChange) return;
    const nextOrder = sort?.sortBy === column.key && sort?.sortOrder === 'asc' ? 'desc' : 'asc';
    onSortChange({ sortBy: column.key, sortOrder: nextOrder });
  };

  return (
    <div className={className}>
      {/* Desktop / tablet */}
      <div className="scrollbar-thin hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line text-xs tracking-wide text-muted uppercase">
              {columns.map((column) => {
                const active = sort?.sortBy === column.key;
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (sort.sortOrder === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('px-4 py-3 font-medium whitespace-nowrap', column.align === 'right' && 'text-right', column.headerClassName)}
                  >
                    {column.sortable && onSortChange ? (
                      <button type="button" onClick={() => toggleSort(column)} className="inline-flex items-center gap-1 tracking-wide uppercase hover:text-fg">
                        {column.header}
                        {active ? (sort.sortOrder === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />) : null}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row[rowKey]}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
                tabIndex={onRowClick ? 0 : undefined}
                className={cn('border-b border-line/60 last:border-0', onRowClick && 'cursor-pointer transition-colors hover:bg-surface-2/60 focus:bg-surface-2/60 focus:outline-none')}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cn('px-4 py-3 align-middle', column.align === 'right' && 'text-right tabular-nums', column.className)}>
                    {renderCell(column, row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Phones */}
      <ul className="divide-y divide-line md:hidden">
        {rows.map((row) => (
          <li key={row[rowKey]}>
            <div
              role={onRowClick ? 'button' : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              onKeyDown={onRowClick ? (e) => e.key === 'Enter' && onRowClick(row) : undefined}
              className={cn('px-4 py-3.5', onRowClick && 'active:bg-surface-2')}
            >
              <div className="font-medium text-fg">
                {primary.length ? primary.map((c) => <div key={c.key}>{renderCell(c, row)}</div>) : renderCell(columns[0], row)}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5">
                {secondary.map((column) => (
                  <div key={column.key} className="min-w-0">
                    <dt className="text-[11px] tracking-wide text-muted uppercase">{column.header}</dt>
                    <dd className="truncate text-sm">{renderCell(column, row)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Pagination({ pagination, onPageChange, className }) {
  if (!pagination || pagination.total === 0) return null;
  const { page, totalPages, total, limit } = pagination;
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  return (
    <nav aria-label="Pagination" className={cn('flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm', className)}>
      <p className="text-muted">
        <span className="font-medium text-fg">{formatNumber(from)}</span>–<span className="font-medium text-fg">{formatNumber(to)}</span> of{' '}
        <span className="font-medium text-fg">{formatNumber(total)}</span>
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="inline-flex size-9 items-center justify-center rounded-lg border border-line hover:bg-surface-2 disabled:opacity-40"
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-2 text-muted tabular-nums">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="inline-flex size-9 items-center justify-center rounded-lg border border-line hover:bg-surface-2 disabled:opacity-40"
          aria-label="Next page"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </nav>
  );
}
