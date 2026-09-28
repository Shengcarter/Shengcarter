import { useState } from 'react';
import { History } from 'lucide-react';
import { Badge, Card, DataTable, EmptyState, Pagination, SearchInput } from '../../components/ui';
import { formatDateTime } from '../../utils/format';
import { useActivityLogs } from './api';

const ACTION_FILTERS = [
  { value: '', label: 'All activity' },
  { value: 'auth.', label: 'Sign-ins & security' },
  { value: 'customer.', label: 'Customers' },
  { value: 'appointment.', label: 'Appointments' },
  { value: 'sale.', label: 'Sales & refunds' },
  { value: 'product.', label: 'Products' },
  { value: 'inventory.', label: 'Stock movements' },
  { value: 'expense.', label: 'Expenses' },
  { value: 'user.', label: 'Users' },
  { value: 'role.', label: 'Roles & permissions' },
  { value: 'settings.', label: 'Settings' },
  { value: 'backup.', label: 'Backups' },
];

const toneFor = (action) => {
  if (/failed|locked|reuse|deleted|refund|cancel/.test(action)) return 'danger';
  if (/created|login|completed/.test(action)) return 'success';
  if (/updated|changed/.test(action)) return 'info';
  return 'neutral';
};

export function ActivityLogSettings() {
  const [params, setParams] = useState({ page: 1, limit: 25, search: '', action: '', from: '', to: '' });
  const logs = useActivityLogs(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '')));

  const columns = [
    { key: 'createdAt', header: 'When', render: (l) => <span className="whitespace-nowrap">{formatDateTime(l.createdAt)}</span> },
    { key: 'userName', header: 'User', primary: true, render: (l) => l.userName || <span className="text-muted">System</span> },
    { key: 'action', header: 'Action', render: (l) => <Badge tone={toneFor(l.action)}>{l.action}</Badge> },
    { key: 'description', header: 'Details', render: (l) => <span className="line-clamp-2 max-w-md">{l.description || '—'}</span> },
    { key: 'ipAddress', header: 'IP address', hideOnMobile: true, render: (l) => <code className="text-xs text-muted">{l.ipAddress || '—'}</code> },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
        <SearchInput placeholder="Search details or user…" className="lg:w-72" onChange={(search) => setParams((p) => ({ ...p, search, page: 1 }))} />
        <select aria-label="Filter by activity type" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={params.action} onChange={(e) => setParams((p) => ({ ...p, action: e.target.value, page: 1 }))}>
          {ACTION_FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input type="date" aria-label="From date" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={params.from} onChange={(e) => setParams((p) => ({ ...p, from: e.target.value, page: 1 }))} />
          <span className="text-muted">–</span>
          <input type="date" aria-label="To date" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={params.to} onChange={(e) => setParams((p) => ({ ...p, to: e.target.value, page: 1 }))} />
        </div>
      </div>
      <DataTable
        columns={columns}
        rows={logs.data?.data}
        loading={logs.isPending}
        error={logs.error}
        onRetry={logs.refetch}
        empty={<EmptyState icon={History} title="No activity found" description="Try a different filter or date range." />}
      />
      <Pagination pagination={logs.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
    </Card>
  );
}
