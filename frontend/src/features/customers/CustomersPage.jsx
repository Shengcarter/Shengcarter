import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileUp, Plus, Users } from 'lucide-react';
import { Avatar, Button, Card, DataTable, EmptyState, PageHeader, Pagination, SearchInput } from '../../components/ui';
import { formatDate, formatMoney, formatNumber } from '../../utils/format';
import { usePermission, useDocumentTitle } from '../../hooks';
import { useCustomers } from './api';
import { CustomerFormModal } from './CustomerFormModal';
import { ImportDialog } from '../../components/ImportDialog';

const FILTERS = [
  { value: '', label: 'All customers' },
  { value: 'returning', label: 'Returning' },
  { value: 'never', label: 'Never visited' },
];

export default function CustomersPage() {
  useDocumentTitle('Customers');
  const can = usePermission();
  const navigate = useNavigate();
  const [params, setParams] = useState({ page: 1, limit: 20, search: '', sortBy: 'createdAt', sortOrder: 'desc', visited: '', gender: '' });
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const customers = useCustomers(params);
  const [searchParams, setSearchParams] = useSearchParams();

  // Deep link from the dashboard: /customers?new=1 opens the form.
  useEffect(() => {
    if (!searchParams.get('new')) return;
    if (can('customers.create')) setCreating(true);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, can]);

  const columns = [
    {
      key: 'name',
      header: 'Customer',
      sortable: true,
      primary: true,
      render: (c) => (
        <div className="flex items-center gap-3">
          <Avatar name={c.fullName} src={c.photo} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium">{c.fullName}</p>
            <p className="truncate text-xs text-muted">{c.code}{c.isDemo ? ' · demo' : ''}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', render: (c) => c.phone },
    {
      key: 'loyalty',
      header: 'Loyalty',
      sortable: true,
      render: (c) => (
        <span className="inline-flex items-center gap-2">
          {c.tier ? <span className="size-2 rounded-full" style={{ background: c.tier.color }} aria-hidden /> : null}
          <span>{c.tier?.name || '—'}</span>
          <span className="text-xs text-muted">{formatNumber(c.loyaltyPoints)} pts</span>
        </span>
      ),
    },
    { key: 'visits', header: 'Visits', sortable: true, align: 'right', render: (c) => formatNumber(c.visitCount) },
    { key: 'totalSpent', header: 'Total spent', sortable: true, align: 'right', render: (c) => formatMoney(c.totalSpent) },
    { key: 'lastVisit', header: 'Last visit', sortable: true, hideOnMobile: true, render: (c) => (c.lastVisitAt ? formatDate(c.lastVisitAt) : <span className="text-muted">Never</span>) },
    { key: 'createdAt', header: 'Registered', sortable: true, hideOnMobile: true, render: (c) => formatDate(c.createdAt) },
  ];

  const set = (patch) => setParams((p) => ({ ...p, page: 1, ...patch }));
  const filtered = params.search || params.visited || params.gender;

  return (
    <div>
      <PageHeader
        title="Customers"
        description={customers.data ? `${formatNumber(customers.data.pagination.total)} customer${customers.data.pagination.total === 1 ? '' : 's'}` : 'Your client base'}
        actions={
          <div className="flex flex-wrap gap-2">
            {can('customers.import') ? <Button variant="secondary" icon={FileUp} onClick={() => setImporting(true)}>Import</Button> : null}
            {can('customers.create') ? <Button icon={Plus} onClick={() => setCreating(true)}>New customer</Button> : null}
          </div>
        }
      />
      <ImportDialog
        open={importing}
        onClose={() => setImporting(false)}
        type="customers"
        title="Import customers"
        noun={['customer', 'customers']}
        intro={<p>Add many customers at once from an Excel sheet or CSV file. Each row is checked like the “New customer” form; phone numbers that are already registered are skipped, so nobody is added twice.</p>}
        columns={[
          { key: 'fullName', header: 'Name' },
          { key: 'phone', header: 'Phone' },
          { key: 'email', header: 'Email' },
        ]}
        invalidate={[['customers']]}
      />
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
          <SearchInput placeholder="Search name, phone, email or code…" className="lg:w-80" onChange={(search) => set({ search })} />
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => set({ visited: f.value })}
                className={`rounded-full border px-3 py-1.5 text-sm ${params.visited === f.value ? 'border-brand-500/50 bg-brand-500/10 text-fg' : 'border-line text-muted hover:text-fg'}`}
              >
                {f.label}
              </button>
            ))}
            <select aria-label="Filter by gender" className="h-9 rounded-full border border-line bg-surface px-3 text-sm" value={params.gender} onChange={(e) => set({ gender: e.target.value })}>
              <option value="">Any gender</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={customers.data?.data}
          loading={customers.isPending}
          error={customers.error}
          onRetry={customers.refetch}
          onRowClick={(c) => navigate(`/customers/${c.id}`)}
          sort={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
          onSortChange={(sort) => set(sort)}
          empty={
            <EmptyState
              icon={Users}
              title={filtered ? 'No customers found' : 'No customers yet'}
              description={filtered ? 'Try a different search or filter.' : 'Register your first customer to start booking appointments.'}
              action={!filtered && can('customers.create') ? <Button icon={Plus} onClick={() => setCreating(true)}>New customer</Button> : null}
            />
          }
        />
        <Pagination pagination={customers.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
      </Card>
      <CustomerFormModal open={creating} onClose={() => setCreating(false)} onSaved={(c) => navigate(`/customers/${c.id}`)} />
    </div>
  );
}
