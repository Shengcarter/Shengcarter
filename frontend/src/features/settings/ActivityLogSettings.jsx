import { useState } from 'react';
import { History } from 'lucide-react';
import { Badge, Card, DataTable, Detail, Drawer, EmptyState, Pagination, SearchInput } from '../../components/ui';
import { cn } from '../../utils/cn';
import { formatDateTime } from '../../utils/format';
import { useActivityLogs } from './api';

const ACTION_FILTERS = [
  { value: '', label: 'All activity' },
  { value: 'auth.', label: 'Sign-ins & security' },
  { value: 'customer.', label: 'Customers' },
  { value: 'appointment.', label: 'Appointments' },
  { value: 'sale.', label: 'Sales, refunds, voids & corrections' },
  { value: 'service.', label: 'Services & financial rules' },
  { value: 'product.', label: 'Products' },
  { value: 'inventory.', label: 'Stock movements' },
  { value: 'expense.', label: 'Expenses' },
  { value: 'user.', label: 'Users' },
  { value: 'role.', label: 'Roles & permissions' },
  { value: 'settings.', label: 'Settings' },
  { value: 'backup.', label: 'Backups' },
];

const toneFor = (action) => {
  if (/failed|locked|reuse|deleted|refund|cancel|voided/.test(action)) return 'danger';
  if (/backdated|date_changed|rule_changed|corrected/.test(action)) return 'warning';
  if (/created|login|completed/.test(action)) return 'success';
  if (/updated|changed/.test(action)) return 'info';
  return 'neutral';
};

const show = (value) => {
  if (value === undefined) return '—';
  if (value === null) return 'empty';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
};

/** The previous and new value of each field that an action changed. */
function Changes({ before, after }) {
  if (!before && !after) return null;
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">What changed</p>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left text-muted">
              <th className="px-3 py-2 font-medium">Field</th>
              <th className="px-3 py-2 font-medium">Before</th>
              <th className="px-3 py-2 font-medium">After</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const a = show(before?.[key]);
              const b = show(after?.[key]);
              return (
                <tr key={key} className={cn('border-b border-line/60 align-top', a !== b && 'bg-amber-500/5')}>
                  <td className="px-3 py-2 font-medium">{key}</td>
                  <td className="px-3 py-2"><pre className="font-mono whitespace-pre-wrap text-muted">{a}</pre></td>
                  <td className="px-3 py-2"><pre className="font-mono whitespace-pre-wrap">{b}</pre></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ActivityLogSettings() {
  const [selected, setSelected] = useState(null);
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
        onRowClick={setSelected}
        empty={<EmptyState icon={History} title="No activity found" description="Try a different filter or date range." />}
      />
      <Pagination pagination={logs.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.action || 'Activity'}>
        {selected ? (
          <div className="space-y-5">
            <dl className="grid grid-cols-2 gap-4">
              <Detail label="When">{formatDateTime(selected.createdAt)}</Detail>
              <Detail label="User">{selected.userName || 'System'}</Detail>
              <Detail label="Branch">{selected.branchName || '—'}</Detail>
              <Detail label="IP address"><code className="text-xs">{selected.ipAddress || '—'}</code></Detail>
              <Detail label="Device" className="col-span-2"><span className="text-xs break-words text-muted">{selected.device || '—'}</span></Detail>
              <Detail label="Details" className="col-span-2">{selected.description || '—'}</Detail>
            </dl>
            <Changes before={selected.oldValues} after={selected.newValues} />
            {selected.metadata ? (
              <div>
                <p className="mb-2 text-sm font-semibold">More information</p>
                <pre className="overflow-x-auto rounded-xl border border-line bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap">{JSON.stringify(selected.metadata, null, 2)}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </Drawer>
    </Card>
  );
}
