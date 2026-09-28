import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Banknote, Hourglass, ReceiptText, ShoppingBag, TrendingUp } from 'lucide-react';
import { ButtonLink, Card, DataTable, DateRange, EmptyState, FilterGroup, FilterSelect, PageHeader, Pagination, SearchInput, StatCard, StatusBadge } from '../../components/ui';
import { formatDateTime, formatMoney, formatNumber, titleCase, todayISO } from '../../utils/format';
import { usePermission, useDocumentTitle } from '../../hooks';
import { PAYMENT_METHODS, useSales } from './api';

export default function SalesPage() {
  useDocumentTitle('Sales history');
  const can = usePermission();
  const navigate = useNavigate();
  const [params, setParams] = useState({ page: 1, limit: 20, search: '', from: todayISO().slice(0, 8) + '01', to: todayISO(), status: '', paymentStatus: '', method: '' });
  const sales = useSales(params);
  const set = (patch) => setParams((p) => ({ ...p, page: 1, ...patch }));
  const summary = sales.data?.summary;

  return (
    <div>
      <Link to="/pos" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Point of sale</Link>
      <PageHeader
        title="Sales history"
        description="Invoices, receipts, payments and refunds."
        actions={can('pos.create') ? <ButtonLink to="/pos" icon={ShoppingBag}>New sale</ButtonLink> : null}
      />
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Transactions" icon={ReceiptText} value={formatNumber(summary?.count)} loading={sales.isPending} />
        <StatCard label="Sales total" icon={TrendingUp} value={formatMoney(summary?.total)} loading={sales.isPending} caption="Excludes refunds" index={1} />
        <StatCard label="Collected" icon={Banknote} tone="success" value={formatMoney(summary?.paid)} loading={sales.isPending} index={2} />
        <StatCard label="Outstanding" icon={Hourglass} value={formatMoney(summary?.balance)} loading={sales.isPending} tone={summary?.balance > 0 ? 'warning' : 'neutral'} index={3} />
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <SearchInput placeholder="Invoice, receipt or customer…" className="w-full sm:w-72" onChange={(search) => set({ search })} />
          <DateRange from={params.from} to={params.to} onChange={set} />
          <FilterGroup>
            <FilterSelect label="Payment status" value={params.paymentStatus} onChange={(paymentStatus) => set({ paymentStatus })}>
              <option value="">Any payment status</option>
              <option value="paid">Paid</option>
              <option value="partial">Partially paid</option>
              <option value="unpaid">Unpaid</option>
            </FilterSelect>
            <FilterSelect label="Payment method" value={params.method} onChange={(method) => set({ method })}>
              <option value="">Any method</option>
              {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Status" className="col-span-2" value={params.status} onChange={(status) => set({ status })}>
              <option value="">Completed & refunded</option>
              <option value="completed">Completed</option>
              <option value="refunded">Refunded</option>
            </FilterSelect>
          </FilterGroup>
        </div>
        <DataTable
          rows={sales.data?.data}
          loading={sales.isPending}
          error={sales.error}
          onRetry={sales.refetch}
          onRowClick={(s) => navigate(`/pos/sales/${s.id}`)}
          empty={<EmptyState icon={ReceiptText} title="No transactions found" description="Try a wider date range." />}
          columns={[
            { key: 'invoiceNumber', header: 'Invoice', primary: true, render: (s) => <div><p className="font-medium">{s.invoiceNumber}</p><p className="text-xs text-muted">{formatDateTime(s.soldAt)}</p></div> },
            { key: 'customerName', header: 'Customer', render: (s) => s.customerName || <span className="text-muted">Walk-in</span> },
            { key: 'methods', header: 'Paid by', hideOnMobile: true, render: (s) => (s.methods ? s.methods.split(',').map(titleCase).join(', ') : '—') },
            { key: 'cashierName', header: 'Cashier', hideOnMobile: true },
            { key: 'total', header: 'Total', align: 'right', render: (s) => <span className={s.status === 'refunded' ? 'text-muted line-through' : 'font-medium'}>{formatMoney(s.total)}</span> },
            { key: 'balanceDue', header: 'Balance', align: 'right', render: (s) => (s.balanceDue > 0 ? <span className="text-warning">{formatMoney(s.balanceDue)}</span> : '—') },
            { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status === 'refunded' ? 'refunded' : s.paymentStatus} /> },
          ]}
        />
        <Pagination pagination={sales.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
      </Card>
    </div>
  );
}
