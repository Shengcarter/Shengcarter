import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Banknote, Download, FileText, Printer, RotateCcw } from 'lucide-react';
import { Badge, Button, Card, Detail, ErrorState, Input, Modal, Select, SkeletonRows, StatusBadge, Textarea } from '../../components/ui';
import { usePrint } from '../../components/print/usePrint';
import { downloadFile } from '../../api/client';
import { formatDateTime, formatMoney, titleCase } from '../../utils/format';
import { usePermission, useDocumentTitle } from '../../hooks';
import { ServiceCostingCard } from '../costing/ServiceCostingCard';
import { A4Invoice, ThermalReceipt } from './Documents';
import { PAYMENT_METHODS, salesApi, salesKeys, useSale } from './api';

function PaymentForm({ sale, open, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ method: 'cash', amount: String(sale.balanceDue), reference: '' });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await salesApi.addPayment(sale.id, { method: form.method, amount: Number(form.amount), reference: form.reference || undefined });
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: salesKeys.all });
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Record payment" description={`Balance due: ${formatMoney(sale.balanceDue)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!Number(form.amount)}>Record payment</Button></>}>
      <div className="space-y-4">
        <Select label="Method" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })} options={PAYMENT_METHODS} />
        <Input label="Amount" type="number" min="0" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} hint="Cash above the balance is returned as change." />
        {form.method !== 'cash' ? <Input label="Reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /> : null}
      </div>
    </Modal>
  );
}

function RefundForm({ sale, open, onClose }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      await salesApi.refund(sale.id, reason);
      toast.success(`${sale.invoiceNumber} refunded`);
      qc.invalidateQueries({ queryKey: salesKeys.all });
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title={`Refund ${sale.invoiceNumber}?`}
      description="Products sold are returned to stock (products used on services stay used), staff pay reversed, loyalty points adjusted and the money recorded as refunded. This cannot be undone."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" onClick={submit} loading={busy} disabled={!reason.trim()}>Refund {formatMoney(sale.amountPaid)}</Button></>}>
      <Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus />
    </Modal>
  );
}

export default function SaleDetailPage() {
  const { id } = useParams();
  const can = usePermission();
  const sale = useSale(id);
  useDocumentTitle(sale.data?.invoiceNumber || 'Sale');
  const { print, portal } = usePrint();
  const [paying, setPaying] = useState(false);
  const [refunding, setRefunding] = useState(false);

  if (sale.isPending) return <SkeletonRows rows={8} />;
  if (sale.isError) return <ErrorState error={sale.error} onRetry={sale.refetch} />;
  const s = sale.data;

  return (
    <div className="mx-auto max-w-5xl">
      <Link to="/pos/sales" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Sales history</Link>
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl font-semibold">{s.invoiceNumber}</h1>
            <StatusBadge status={s.status === 'refunded' ? 'refunded' : s.paymentStatus} />
            {s.isImported ? <Badge tone="info">Imported</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted">Receipt {s.receiptNumber} · {formatDateTime(s.soldAt)} · {s.branchName}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={Printer} onClick={() => print(<ThermalReceipt sale={s} />, { format: 'thermal' })}>Receipt</Button>
          <Button variant="secondary" size="sm" icon={FileText} onClick={() => print(<A4Invoice sale={s} />, { format: 'a4' })}>Invoice</Button>
          <Button variant="ghost" size="sm" icon={Download} onClick={() => downloadFile(`/sales/${s.id}/document`, { format: 'a4', download: true }, `invoice-${s.invoiceNumber}.pdf`)}>PDF</Button>
          {s.status === 'completed' && s.balanceDue > 0 && can('pos.create') ? <Button size="sm" icon={Banknote} onClick={() => setPaying(true)}>Record payment</Button> : null}
          {s.status === 'completed' && can('pos.refund') ? <Button size="sm" variant="danger-ghost" icon={RotateCcw} onClick={() => setRefunding(true)}>Refund</Button> : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="px-4 py-3 font-medium">Staff</th>
                <th className="px-4 py-3 text-right font-medium">Qty</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">Amount</th>
              </tr>
            </thead>
            <tbody>
              {s.items.map((item) => (
                <tr key={item.id} className="border-b border-line/60">
                  <td className="px-4 py-3"><p className="font-medium">{item.description}</p><p className="text-xs text-muted">{titleCase(item.itemType)}{item.commissionAmount > 0 ? ` · staff ${formatMoney(item.commissionAmount)}` : ''}</p></td>
                  <td className="px-4 py-3 text-muted">
                    {item.staff?.length > 1 ? (
                      <ul className="space-y-0.5">
                        {item.staff.map((m) => (
                          <li key={m.id}>
                            {m.fullName}
                            {m.commissionAmount > 0 ? <span className="block text-xs whitespace-nowrap">earns {formatMoney(m.commissionAmount)}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : item.employeeName || '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{item.quantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatMoney(item.unitPrice)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">{formatMoney(item.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="ml-auto max-w-sm space-y-1.5 p-4 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{formatMoney(s.subtotal)}</dd></div>
            {s.discountAmount > 0 ? <div className="flex justify-between"><dt className="text-muted">Discount{s.discountType === 'percentage' ? ` (${s.discountValue}%)` : ''}</dt><dd>−{formatMoney(s.discountAmount)}</dd></div> : null}
            {s.loyaltyDiscount > 0 ? <div className="flex justify-between"><dt className="text-muted">Loyalty ({s.loyaltyPointsRedeemed} pts)</dt><dd>−{formatMoney(s.loyaltyDiscount)}</dd></div> : null}
            {s.taxMode !== 'none' && s.taxRate > 0 ? <div className="flex justify-between"><dt className="text-muted">Tax {s.taxRate}%{s.taxMode === 'inclusive' ? ' (incl.)' : ''}</dt><dd>{formatMoney(s.taxAmount)}</dd></div> : null}
            <div className="flex justify-between border-t border-line pt-2 text-lg font-semibold"><dt>Total</dt><dd className="text-accent">{formatMoney(s.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd>{formatMoney(s.amountPaid)}</dd></div>
            {s.changeDue > 0 ? <div className="flex justify-between"><dt className="text-muted">Change given</dt><dd>{formatMoney(s.changeDue)}</dd></div> : null}
            <div className="flex justify-between"><dt className="text-muted">Balance due</dt><dd className={s.balanceDue > 0 ? 'font-semibold text-warning' : ''}>{formatMoney(s.balanceDue)}</dd></div>
          </dl>
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <dl className="grid grid-cols-2 gap-4">
              <Detail label="Customer" className="col-span-2">
                {s.customerId ? <Link to={`/customers/${s.customerId}`} className="text-accent hover:underline">{s.customerName}</Link> : 'Walk-in customer'}
              </Detail>
              <Detail label="Cashier">{s.cashierName}</Detail>
              <Detail label="Appointment">{s.appointmentCode || '—'}</Detail>
              {s.loyaltyPointsEarned ? <Detail label="Points earned">{s.loyaltyPointsEarned}</Detail> : null}
              {s.costOfGoods !== undefined ? <Detail label="Cost of goods">{formatMoney(s.costOfGoods)}</Detail> : null}
              {s.notes ? <Detail label="Notes" className="col-span-2">{s.notes}</Detail> : null}
              {s.status === 'refunded' ? <Detail label="Refund" className="col-span-2">{formatDateTime(s.refundedAt)} by {s.refundedByName}: {s.refundReason}</Detail> : null}
            </dl>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Payments</h2>
            <ul className="space-y-2">
              {s.payments.map((p) => (
                <li key={p.id} className="flex items-center justify-between text-sm">
                  <span>
                    <span className="font-medium">{titleCase(p.method)}</span> {p.type === 'refund' ? <Badge tone="danger">Refund</Badge> : null}
                    <span className="block text-xs text-muted">{formatDateTime(p.paidAt)}{p.reference ? ` · ${p.reference}` : ''}</span>
                  </span>
                  <span className={p.amount < 0 ? 'text-danger' : 'font-medium'}>{formatMoney(p.amount)}</span>
                </li>
              ))}
              {!s.payments.length ? <li className="text-sm text-muted">No payments yet.</li> : null}
            </ul>
          </Card>
        </div>
      </div>
      <div className="mt-6"><ServiceCostingCard sale={s} /></div>
      {can('pos.create') && s.balanceDue > 0 ? <PaymentForm key={`pay-${s.balanceDue}`} sale={s} open={paying} onClose={() => setPaying(false)} /> : null}
      <RefundForm sale={s} open={refunding} onClose={() => setRefunding(false)} />
      {portal}
    </div>
  );
}
