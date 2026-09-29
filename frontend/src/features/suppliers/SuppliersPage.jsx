import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Ban, Banknote, PackageCheck, Pencil, Plus, Truck } from 'lucide-react';
import {
  Badge, Button, Card, DataTable, Detail, Drawer, EmptyState, Input, Modal, PageHeader, Pagination, SearchInput, Select, SkeletonRows,
  StatusBadge, Switch, Tabs, Textarea, applyServerErrors, ConfirmDialog,
} from '../../components/ui';
import { http } from '../../api/client';
import { formatDate, formatMoney, formatNumber, titleCase, todayISO } from '../../utils/format';
import { usePermission, useDocumentTitle } from '../../hooks';
import { PAYMENT_METHODS } from '../pos/api';
import { PurchaseFormModal } from './PurchaseFormModal';

const clean = (p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined));

function SupplierForm({ open, onClose, supplier }) {
  const qc = useQueryClient();
  const { register, handleSubmit, reset, watch, setValue, setError, formState: { errors, isSubmitting } } = useForm();
  useEffect(() => {
    if (open) reset({ name: supplier?.name || '', contactPerson: supplier?.contactPerson || '', phone: supplier?.phone || '', email: supplier?.email || '', address: supplier?.address || '', taxNumber: supplier?.taxNumber || '', notes: supplier?.notes || '', isActive: supplier ? supplier.isActive : true });
  }, [open, supplier, reset]);
  const onSubmit = handleSubmit(async (values) => {
    try {
      const res = supplier ? await http.patch(`/suppliers/${supplier.id}`, values) : await http.post('/suppliers', values);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    } catch (e) {
      if (!applyServerErrors(e, setError)) toast.error(e.message);
    }
  });
  return (
    <Modal open={open} onClose={onClose} title={supplier ? 'Edit supplier' : 'New supplier'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} loading={isSubmitting}>{supplier ? 'Save changes' : 'Create supplier'}</Button></>}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Supplier name" required className="sm:col-span-2" error={errors.name?.message} {...register('name')} />
        <Input label="Contact person" error={errors.contactPerson?.message} {...register('contactPerson')} />
        <Input label="Phone" error={errors.phone?.message} {...register('phone')} />
        <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <Input label="TIN / tax number" error={errors.taxNumber?.message} {...register('taxNumber')} />
        <Input label="Address" className="sm:col-span-2" error={errors.address?.message} {...register('address')} />
        <Textarea label="Notes" rows={2} className="sm:col-span-2" {...register('notes')} />
        <Switch className="sm:col-span-2" label="Active" checked={watch('isActive')} onChange={(v) => setValue('isActive', v)} />
      </form>
    </Modal>
  );
}

function PaymentModal({ purchase, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ amount: '', paymentMethod: 'bank_transfer', paymentDate: todayISO(), reference: '' });
  useEffect(() => {
    if (purchase) setForm((f) => ({ ...f, amount: String(purchase.balance) }));
  }, [purchase]);
  const [busy, setBusy] = useState(false);
  if (!purchase) return null;
  const submit = async () => {
    setBusy(true);
    try {
      const res = await http.post(`/purchases/${purchase.id}/payments`, { ...form, amount: Number(form.amount), reference: form.reference || null });
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={Boolean(purchase)} onClose={onClose} size="sm" title={`Pay ${purchase.code}`} description={`Balance: ${formatMoney(purchase.balance)}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!Number(form.amount)}>Record payment</Button></>}>
      <div className="space-y-4">
        <Input label="Amount" type="number" min="0" max={purchase.balance} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
        <Select label="Method" value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })} options={PAYMENT_METHODS} />
        <Input label="Date" type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} />
        <Input label="Reference" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
      </div>
    </Modal>
  );
}

function PurchaseDrawer({ purchaseId, onClose, onPay }) {
  const can = usePermission();
  const qc = useQueryClient();
  const purchase = useQuery({ queryKey: ['purchases', 'detail', purchaseId], queryFn: () => http.get(`/purchases/${purchaseId}`).then((r) => r.data), enabled: Boolean(purchaseId) });
  const [busy, setBusy] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const p = purchase.data;
  const act = async (label, url) => {
    setBusy(label);
    try {
      const res = await http.post(url);
      toast.success(res.message);
      ['purchases', 'suppliers', 'products', 'inventory'].forEach((key) => qc.invalidateQueries({ queryKey: [key] }));
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(null);
      setConfirmCancel(false);
    }
  };
  return (
    <Drawer
      open={Boolean(purchaseId)}
      onClose={onClose}
      title={p?.code || 'Purchase'}
      footer={p && can('purchases.manage') ? (
        <>
          {p.status === 'ordered' ? <Button variant="danger-ghost" icon={Ban} onClick={() => setConfirmCancel(true)}>Cancel order</Button> : null}
          {p.status !== 'cancelled' && p.balance > 0 ? <Button variant="secondary" icon={Banknote} onClick={() => onPay(p)}>Record payment</Button> : null}
          {p.status === 'ordered' ? <Button icon={PackageCheck} loading={busy === 'receive'} onClick={() => act('receive', `/purchases/${p.id}/receive`)}>Receive stock</Button> : null}
        </>
      ) : null}
    >
      {purchase.isPending ? <SkeletonRows rows={6} /> : p ? (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2"><StatusBadge status={p.status} /><StatusBadge status={p.paymentStatus} /></div>
          <dl className="grid grid-cols-2 gap-4">
            <Detail label="Supplier">{p.supplierName}</Detail>
            <Detail label="Date">{formatDate(p.purchaseDate)}</Detail>
            <Detail label="Supplier invoice">{p.supplierInvoiceNo || '—'}</Detail>
            <Detail label="Created by">{p.createdByName || '—'}</Detail>
            {p.receivedAt ? <Detail label="Received">{formatDate(p.receivedAt)} by {p.receivedByName}</Detail> : null}
          </dl>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {p.items.map((i) => (
              <li key={i.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span><span className="font-medium">{i.productName}</span><span className="block text-xs text-muted">{i.quantity} {i.unit} × {formatMoney(i.unitCost)}</span></span>
                <span className="font-medium">{formatMoney(i.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{formatMoney(p.subtotal)}</dd></div>
            {p.discountAmount > 0 ? <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd>−{formatMoney(p.discountAmount)}</dd></div> : null}
            {p.taxAmount > 0 ? <div className="flex justify-between"><dt className="text-muted">Tax</dt><dd>{formatMoney(p.taxAmount)}</dd></div> : null}
            <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{formatMoney(p.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Paid</dt><dd>{formatMoney(p.amountPaid)}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Balance</dt><dd className={p.balance > 0 ? 'font-semibold text-warning' : ''}>{formatMoney(p.balance)}</dd></div>
          </dl>
          {p.payments.length ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Payments</h3>
              <ul className="space-y-1.5 text-sm">
                {p.payments.map((pay) => (
                  <li key={pay.id} className="flex justify-between"><span>{formatDate(pay.paymentDate)} · {titleCase(pay.paymentMethod)}{pay.reference ? ` · ${pay.reference}` : ''}</span><span className="font-medium">{formatMoney(pay.amount)}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
          {p.notes ? <Detail label="Notes">{p.notes}</Detail> : null}
        </div>
      ) : null}
      <ConfirmDialog open={confirmCancel} onClose={() => setConfirmCancel(false)} danger title={`Cancel ${p?.code}?`} message="The order will be marked cancelled. No stock is affected." confirmLabel="Cancel order" loading={busy === 'cancel'} onConfirm={() => act('cancel', `/purchases/${p.id}/cancel`)} />
    </Drawer>
  );
}

function SupplierDrawer({ supplierId, onClose, onEdit, onNewPurchase, onOpenPurchase }) {
  const can = usePermission();
  const supplier = useQuery({ queryKey: ['suppliers', 'detail', supplierId], queryFn: () => http.get(`/suppliers/${supplierId}`).then((r) => r.data), enabled: Boolean(supplierId) });
  const purchases = useQuery({ queryKey: ['purchases', 'list', { supplierId }], queryFn: () => http.get('/purchases', { supplierId, limit: 10 }), enabled: Boolean(supplierId) && can('purchases.view') });
  const s = supplier.data;
  return (
    <Drawer
      open={Boolean(supplierId)}
      onClose={onClose}
      title={s?.name || 'Supplier'}
      footer={s ? (
        <>
          {can('suppliers.manage') ? <Button variant="secondary" icon={Pencil} onClick={() => onEdit(s)}>Edit</Button> : null}
          {can('purchases.manage') ? <Button icon={Plus} onClick={() => onNewPurchase(s)}>New purchase</Button> : null}
        </>
      ) : null}
    >
      {supplier.isPending ? <SkeletonRows rows={6} /> : s ? (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-xl bg-surface-2/60 p-3"><p className="text-xs text-muted">Purchased</p><p className="font-semibold">{formatMoney(s.totals.totalPurchased)}</p></div>
            <div className="rounded-xl bg-surface-2/60 p-3"><p className="text-xs text-muted">Paid</p><p className="font-semibold">{formatMoney(s.totals.totalPaid)}</p></div>
            <div className="rounded-xl bg-surface-2/60 p-3"><p className="text-xs text-muted">Outstanding</p><p className={`font-semibold ${s.outstandingBalance > 0 ? 'text-warning' : ''}`}>{formatMoney(s.outstandingBalance)}</p></div>
          </div>
          <dl className="grid grid-cols-2 gap-4">
            <Detail label="Contact">{s.contactPerson || '—'}</Detail>
            <Detail label="Phone">{s.phone || '—'}</Detail>
            <Detail label="Email">{s.email || '—'}</Detail>
            <Detail label="TIN">{s.taxNumber || '—'}</Detail>
            <Detail label="Address" className="col-span-2">{s.address || '—'}</Detail>
            {s.notes ? <Detail label="Notes" className="col-span-2">{s.notes}</Detail> : null}
          </dl>
          {purchases.data ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Recent purchases</h3>
              <ul className="divide-y divide-line rounded-2xl border border-line">
                {purchases.data.data.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => onOpenPurchase(p.id)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-surface-2">
                      <span><span className="font-medium">{p.code}</span><span className="block text-xs text-muted">{formatDate(p.purchaseDate)} · {p.itemCount} item(s)</span></span>
                      <span className="text-right"><span className="block font-medium">{formatMoney(p.total)}</span><StatusBadge status={p.paymentStatus} /></span>
                    </button>
                  </li>
                ))}
                {!purchases.data.data.length ? <li className="px-4 py-3 text-sm text-muted">No purchases yet.</li> : null}
              </ul>
            </div>
          ) : null}
          {s.payments.length ? (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Payment history</h3>
              <ul className="space-y-1.5 text-sm">
                {s.payments.map((p) => (
                  <li key={p.id} className="flex justify-between"><span>{formatDate(p.paymentDate)} · {p.purchaseCode} · {titleCase(p.paymentMethod)}</span><span className="font-medium">{formatMoney(p.amount)}</span></li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}

export default function SuppliersPage() {
  useDocumentTitle('Suppliers');
  const can = usePermission();
  const tabs = [...(can('suppliers.view') ? [{ value: 'suppliers', label: 'Suppliers' }] : []), ...(can('purchases.view') ? [{ value: 'purchases', label: 'Purchases' }] : [])];
  const [tab, setTab] = useState(tabs[0]?.value || 'suppliers');
  const [supplierParams, setSupplierParams] = useState({ page: 1, limit: 20, search: '', withBalance: '' });
  const [purchaseParams, setPurchaseParams] = useState({ page: 1, limit: 20, search: '', status: '', paymentStatus: '' });
  const suppliers = useQuery({ queryKey: ['suppliers', 'list', clean(supplierParams)], queryFn: () => http.get('/suppliers', clean(supplierParams)), enabled: tab === 'suppliers', placeholderData: (p) => p });
  const purchases = useQuery({ queryKey: ['purchases', 'list', clean(purchaseParams)], queryFn: () => http.get('/purchases', clean(purchaseParams)), enabled: tab === 'purchases', placeholderData: (p) => p });
  const [supplierForm, setSupplierForm] = useState({ open: false, supplier: null });
  const [purchaseForm, setPurchaseForm] = useState({ open: false, supplierId: null });
  const [supplierId, setSupplierId] = useState(null);
  const [purchaseId, setPurchaseId] = useState(null);
  const [paying, setPaying] = useState(null);

  return (
    <div>
      <PageHeader
        title="Suppliers"
        description="Suppliers, purchase orders, stock receiving and supplier payments."
        actions={
          <>
            {can('suppliers.manage') ? <Button variant="secondary" icon={Plus} onClick={() => setSupplierForm({ open: true, supplier: null })}>New supplier</Button> : null}
            {can('purchases.manage') ? <Button icon={Truck} onClick={() => setPurchaseForm({ open: true, supplierId: null })}>New purchase</Button> : null}
          </>
        }
      />
      <Tabs className="mb-5" tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'suppliers' ? (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
            <SearchInput placeholder="Search suppliers…" className="sm:w-72" onChange={(search) => setSupplierParams((p) => ({ ...p, search, page: 1 }))} />
            <label className="flex items-center gap-2 text-sm text-muted">
              <input type="checkbox" className="size-4 accent-gold-500" checked={Boolean(supplierParams.withBalance)} onChange={(e) => setSupplierParams((p) => ({ ...p, withBalance: e.target.checked ? 'true' : '', page: 1 }))} />
              With outstanding balance
            </label>
          </div>
          <DataTable
            rows={suppliers.data?.data}
            loading={suppliers.isPending}
            error={suppliers.error}
            onRetry={suppliers.refetch}
            onRowClick={(s) => setSupplierId(s.id)}
            empty={<EmptyState icon={Truck} title="No suppliers yet" description="Add the companies you buy stock from." />}
            columns={[
              { key: 'name', header: 'Supplier', primary: true, render: (s) => <div><p className="font-medium">{s.name} {!s.isActive ? <Badge>Inactive</Badge> : null}</p><p className="text-xs text-muted">{s.contactPerson || '—'}</p></div> },
              { key: 'phone', header: 'Phone', render: (s) => s.phone || '—' },
              { key: 'purchaseCount', header: 'Purchases', align: 'right', render: (s) => formatNumber(s.purchaseCount) },
              { key: 'lastPurchaseDate', header: 'Last purchase', hideOnMobile: true, render: (s) => (s.lastPurchaseDate ? formatDate(s.lastPurchaseDate) : '—') },
              { key: 'outstandingBalance', header: 'Outstanding', align: 'right', render: (s) => (s.outstandingBalance > 0 ? <span className="font-medium text-warning">{formatMoney(s.outstandingBalance)}</span> : '—') },
            ]}
          />
          <Pagination pagination={suppliers.data?.pagination} onPageChange={(page) => setSupplierParams((p) => ({ ...p, page }))} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
            <SearchInput placeholder="PO number, invoice or supplier…" className="sm:w-72" onChange={(search) => setPurchaseParams((p) => ({ ...p, search, page: 1 }))} />
            <select aria-label="Status" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={purchaseParams.status} onChange={(e) => setPurchaseParams((p) => ({ ...p, status: e.target.value, page: 1 }))}>
              <option value="">Any status</option>
              <option value="ordered">Ordered</option>
              <option value="received">Received</option>
              <option value="cancelled">Cancelled</option>
            </select>
            <select aria-label="Payment" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={purchaseParams.paymentStatus} onChange={(e) => setPurchaseParams((p) => ({ ...p, paymentStatus: e.target.value, page: 1 }))}>
              <option value="">Any payment</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partially paid</option>
              <option value="paid">Paid</option>
            </select>
          </div>
          <DataTable
            rows={purchases.data?.data}
            loading={purchases.isPending}
            error={purchases.error}
            onRetry={purchases.refetch}
            onRowClick={(p) => setPurchaseId(p.id)}
            empty={<EmptyState icon={Truck} title="No purchases yet" />}
            columns={[
              { key: 'code', header: 'Purchase', primary: true, render: (p) => <div><p className="font-medium">{p.code}</p><p className="text-xs text-muted">{formatDate(p.purchaseDate)}</p></div> },
              { key: 'supplierName', header: 'Supplier' },
              { key: 'itemCount', header: 'Items', align: 'right' },
              { key: 'total', header: 'Total', align: 'right', render: (p) => formatMoney(p.total) },
              { key: 'balance', header: 'Balance', align: 'right', render: (p) => (p.balance > 0 && p.status !== 'cancelled' ? <span className="text-warning">{formatMoney(p.balance)}</span> : '—') },
              { key: 'status', header: 'Status', render: (p) => <div className="flex flex-wrap gap-1"><StatusBadge status={p.status} />{p.status !== 'cancelled' ? <StatusBadge status={p.paymentStatus} /> : null}</div> },
            ]}
          />
          <Pagination pagination={purchases.data?.pagination} onPageChange={(page) => setPurchaseParams((p) => ({ ...p, page }))} />
        </Card>
      )}

      <SupplierForm open={supplierForm.open} supplier={supplierForm.supplier} onClose={() => setSupplierForm({ open: false, supplier: null })} />
      <PurchaseFormModal open={purchaseForm.open} supplierId={purchaseForm.supplierId} onClose={() => setPurchaseForm({ open: false, supplierId: null })} onSaved={(p) => setPurchaseId(p.id)} />
      <SupplierDrawer
        supplierId={supplierId}
        onClose={() => setSupplierId(null)}
        onEdit={(s) => { setSupplierId(null); setSupplierForm({ open: true, supplier: s }); }}
        onNewPurchase={(s) => { setSupplierId(null); setPurchaseForm({ open: true, supplierId: s.id }); }}
        onOpenPurchase={(id) => { setSupplierId(null); setPurchaseId(id); }}
      />
      <PurchaseDrawer purchaseId={purchaseId} onClose={() => setPurchaseId(null)} onPay={(p) => setPaying(p)} />
      <PaymentModal purchase={paying} onClose={() => setPaying(null)} />
    </div>
  );
}
