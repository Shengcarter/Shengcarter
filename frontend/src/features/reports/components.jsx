import { Card, CardHeader, DataTable, EmptyState, ErrorState, Skeleton, StatCard } from '../../components/ui';
import { formatMoney, formatNumber } from '../../utils/format';

export const money = (v) => formatMoney(v);
export const compactMoney = (v) => formatMoney(v, { compact: true });
export const count = (v) => formatNumber(v);
export const percent = (v) => (v === null || v === undefined ? '—' : `${formatNumber(v, { maximumFractionDigits: 1 })}%`);

/** Shared loading / error wrapper for a report tab. */
export function ReportState({ query, children }) {
  if (query.isPending) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
        <Skeleton className="h-80" />
      </div>
    );
  }
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  return <div className={query.isFetching ? 'opacity-70 transition-opacity' : 'transition-opacity'}>{children(query.data)}</div>;
}

export function Kpis({ items }) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
      {items.filter(Boolean).map((item, index) => (
        <StatCard key={item.label} index={index} {...item} />
      ))}
    </div>
  );
}

/** A titled table card; `rowKey` defaults to id. */
export function ReportTable({ title, description, columns, rows, rowKey = 'id', empty = 'No data for this period', action, className, onRowClick }) {
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} action={action} />
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={rowKey}
        onRowClick={onRowClick}
        empty={<EmptyState title={empty} className="py-10" />}
      />
    </Card>
  );
}

/** Columns for ChartCard's table view, reusing report table columns. */
export function tableFrom(columns, rows) {
  return {
    columns: columns.map((c) => ({ key: c.key, header: c.header, align: c.align, format: c.render ? (_, row) => c.render(row) : undefined })),
    rows,
  };
}
