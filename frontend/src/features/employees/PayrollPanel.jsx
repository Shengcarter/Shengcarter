import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Banknote, CalendarRange, Trash2, Users } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, Input, Modal, Pagination, Select, StatCard, StatusBadge } from '../../components/ui';
import { http } from '../../api/client';
import { formatDate, formatDateTime, formatMoney, titleCase, todayISO, nowInBusinessZone } from '../../utils/format';
import { PAYMENT_METHODS } from '../pos/api';

const clean = (p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined && v !== null));

function lastMonthRange() {
  const start = nowInBusinessZone().minus({ months: 1 }).startOf('month');
  return { periodStart: start.toISODate(), periodEnd: start.endOf('month').toISODate() };
}

function GenerateModal({ open, onClose, employeeId }) {
  const qc = useQueryClient();
  const [range, setRange] = useState(lastMonthRange);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await http.post('/payroll/payouts/generate', { ...range, ...(employeeId ? { employeeIds: [employeeId] } : {}) });
      if (res.data.created) toast.success(res.message);
      else toast.info(res.message);
      qc.invalidateQueries({ queryKey: ['payroll'] });
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Prepare commission payouts" description="Gathers each person's unpaid commission earned in the period into one payout. Staff with no commission in the period get none."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Prepare</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Input label="From" type="date" value={range.periodStart} onChange={(e) => setRange((r) => ({ ...r, periodStart: e.target.value }))} />
        <Input label="To" type="date" value={range.periodEnd} onChange={(e) => setRange((r) => ({ ...r, periodEnd: e.target.value }))} />
      </div>
    </Modal>
  );
}

function PayModal({ payout, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ bonus: '', deductions: '', paymentMethod: 'mobile_money', paidDate: todayISO() });
  const [busy, setBusy] = useState(false);
  if (!payout) return null;
  const bonus = form.bonus === '' ? Number(payout.bonus) : Number(form.bonus) || 0;
  const deductions = form.deductions === '' ? Number(payout.deductions) : Number(form.deductions) || 0;
  const net = Number(payout.commissionAmount) + bonus - deductions;
  const submit = async () => {
    setBusy(true);
    try {
      if (form.bonus !== '' || form.deductions !== '') {
        await http.patch(`/payroll/payouts/${payout.id}`, { bonus, deductions });
      }
      const res = await http.post(`/payroll/payouts/${payout.id}/pay`, { paymentMethod: form.paymentMethod, paidDate: form.paidDate });
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['payroll'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={Boolean(payout)} onClose={onClose} size="sm" title={`Pay ${payout.employeeName}`} description={`Commission earned ${formatDate(payout.periodStart)} – ${formatDate(payout.periodEnd)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button icon={Banknote} onClick={submit} loading={busy} disabled={net < 0}>Pay {formatMoney(net)}</Button></>}>
      <dl className="mb-4 space-y-1 rounded-xl bg-surface-2/60 p-3 text-sm">
        <div className="flex justify-between"><dt className="text-muted">Commission ({payout.commissionCount} services)</dt><dd className="font-medium">{formatMoney(payout.commissionAmount)}</dd></div>
      </dl>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Bonus / tips" type="number" min="0" placeholder={String(payout.bonus)} value={form.bonus} onChange={(e) => setForm({ ...form, bonus: e.target.value })} />
        <Input label="Deductions" hint="e.g. an advance already paid" type="number" min="0" placeholder={String(payout.deductions)} value={form.deductions} onChange={(e) => setForm({ ...form, deductions: e.target.value })} />
        <Select label="Paid with" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} options={PAYMENT_METHODS} />
        <Input label="Payment date" type="date" value={form.paidDate} onChange={(e) => setForm({ ...form, paidDate: e.target.value })} />
      </div>
      <p className="mt-3 text-xs text-muted">The payment is recorded as a “Staff commissions” expense and the commission is marked paid.</p>
    </Modal>
  );
}

/**
 * Commission payouts and commission records. The salon pays commission only.
 * With `employee` it shows one person (employee profile); without it, the
 * whole branch (Employees → Commission payouts).
 */
export function PayrollPanel({ employee }) {
  const qc = useQueryClient();
  const employeeId = employee?.id;
  const [payoutPage, setPayoutPage] = useState(1);
  const [commissionParams, setCommissionParams] = useState({ page: 1, status: '' });
  const payouts = useQuery({ queryKey: ['payroll', 'payouts', employeeId, payoutPage], queryFn: () => http.get('/payroll/payouts', clean({ employeeId, page: payoutPage, limit: 10 })), placeholderData: (p) => p });
  const commissions = useQuery({ queryKey: ['payroll', 'commissions', employeeId, commissionParams], queryFn: () => http.get('/payroll/commissions', clean({ employeeId, ...commissionParams, limit: 10 })), placeholderData: (p) => p });
  const [generating, setGenerating] = useState(false);
  const [paying, setPaying] = useState(null);

  const remove = async (payout) => {
    try {
      await http.delete(`/payroll/payouts/${payout.id}`);
      toast.success('Payout deleted');
      qc.invalidateQueries({ queryKey: ['payroll'] });
    } catch (e) {
      toast.error(e.message);
    }
  };

  const summary = commissions.data?.summary;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Unpaid commission" value={formatMoney(summary?.unpaid)} loading={commissions.isPending} tone="warning" />
        <StatCard label="Paid commission" value={formatMoney(summary?.paid)} loading={commissions.isPending} tone="success" />
        <StatCard label="Reversed (refunds)" value={formatMoney(summary?.reversed)} loading={commissions.isPending} tone="neutral" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-semibold">Commission payouts</h2>
            <p className="text-xs text-muted">Staff are paid the commission they earn; there is no fixed salary.</p>
          </div>
          <Button size="sm" icon={CalendarRange} onClick={() => setGenerating(true)}>Prepare payouts</Button>
        </div>
        <DataTable
          rows={payouts.data?.data}
          loading={payouts.isPending}
          error={payouts.error}
          onRetry={payouts.refetch}
          empty={<EmptyState icon={Banknote} title="No payouts yet" description="Prepare payouts for a period to pay staff the commission they earned." />}
          columns={[
            ...(employeeId ? [] : [{ key: 'employeeName', header: 'Employee', primary: true, render: (r) => <div><p className="font-medium">{r.employeeName}</p><p className="text-xs text-muted">{r.jobTitle}</p></div> }]),
            { key: 'period', header: 'Period', render: (r) => `${formatDate(r.periodStart, 'dd LLL')} – ${formatDate(r.periodEnd, 'dd LLL yyyy')}` },
            { key: 'commissionAmount', header: 'Commission', align: 'right', render: (r) => formatMoney(r.commissionAmount) },
            {
              key: 'adjust',
              header: 'Bonus / deductions',
              align: 'right',
              hideOnMobile: true,
              render: (r) => {
                const parts = [r.bonus > 0 ? `+${formatMoney(r.bonus)}` : null, r.deductions > 0 ? `−${formatMoney(r.deductions)}` : null].filter(Boolean);
                return (
                  <div>
                    {parts.length ? <p>{parts.join(' / ')}</p> : null}
                    {r.earlierSalary > 0 ? <p className="text-xs whitespace-nowrap text-muted">+{formatMoney(r.earlierSalary)} old fixed salary</p> : null}
                    {!parts.length && !(r.earlierSalary > 0) ? '—' : null}
                  </div>
                );
              },
            },
            { key: 'netPay', header: 'To pay', align: 'right', render: (r) => <span className="font-semibold">{formatMoney(r.netPay)}</span> },
            { key: 'status', header: 'Status', render: (r) => <div><StatusBadge status={r.status} />{r.paidAt ? <p className="mt-0.5 text-[11px] text-muted">{formatDateTime(r.paidAt)} · {titleCase(r.paymentMethod)}</p> : null}</div> },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (r) => (r.status === 'pending' ? (
                <div className="flex justify-end gap-1">
                  <Button size="xs" onClick={() => setPaying(r)}>Pay</Button>
                  <button type="button" onClick={() => remove(r)} className="rounded-lg p-1.5 text-muted hover:bg-red-500/10 hover:text-danger" aria-label="Delete payout"><Trash2 className="size-4" /></button>
                </div>
              ) : null),
            },
          ]}
        />
        <Pagination pagination={payouts.data?.pagination} onPageChange={setPayoutPage} />
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-semibold">Commission records</h2>
          <select aria-label="Commission status" className="h-9 rounded-lg border border-line bg-surface px-3 text-sm" value={commissionParams.status} onChange={(e) => setCommissionParams({ page: 1, status: e.target.value })}>
            <option value="">All</option>
            <option value="earned">Unpaid</option>
            <option value="paid">Paid</option>
            <option value="reversed">Reversed</option>
          </select>
        </div>
        <DataTable
          rows={commissions.data?.data}
          loading={commissions.isPending}
          error={commissions.error}
          onRetry={commissions.refetch}
          empty={<EmptyState title="No commissions yet" description="Commissions are created automatically for services sold at the POS." />}
          columns={[
            { key: 'earnedAt', header: 'Date', render: (c) => formatDateTime(c.earnedAt) },
            ...(employeeId ? [] : [{ key: 'employeeName', header: 'Employee', primary: true }]),
            {
              key: 'serviceName',
              header: 'Service',
              render: (c) => (
                <div>
                  <p>{c.serviceName}</p>
                  <p className="flex items-center gap-1 text-xs text-muted">
                    {c.invoiceNumber}
                    {c.staffCount > 1 ? <span className="inline-flex items-center gap-0.5" title="Shared equally between the staff who did it"><Users className="size-3" aria-hidden />shared by {c.staffCount}</span> : null}
                  </p>
                </div>
              ),
            },
            { key: 'baseAmount', header: 'Their share', align: 'right', hideOnMobile: true, render: (c) => formatMoney(c.baseAmount) },
            { key: 'rate', header: 'Rate', align: 'right', render: (c) => `${c.rate}%` },
            { key: 'amount', header: 'Commission', align: 'right', render: (c) => <span className="font-medium">{formatMoney(c.amount)}</span> },
            { key: 'status', header: 'Status', render: (c) => <StatusBadge status={c.status} label={c.status === 'earned' ? 'Unpaid' : undefined} /> },
          ]}
        />
        <Pagination pagination={commissions.data?.pagination} onPageChange={(page) => setCommissionParams((p) => ({ ...p, page }))} />
      </Card>

      <GenerateModal open={generating} onClose={() => setGenerating(false)} employeeId={employeeId} />
      <PayModal key={paying?.id || 'none'} payout={paying} onClose={() => setPaying(null)} />
    </div>
  );
}
