import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Modal, Select, Switch, Textarea } from '../../components/ui';
import { formatMoney, todayISO } from '../../utils/format';
import { PAYMENT_METHODS } from '../pos/api';
import { useProductList, useSupplierOptions } from '../inventory/api';
import { http } from '../../api/client';

const emptyLine = () => ({ productId: '', quantity: '1', unitCost: '' });

/** Create a purchase order; optionally receive the stock and pay immediately. */
export function PurchaseFormModal({ open, onClose, supplierId, onSaved }) {
  const qc = useQueryClient();
  const suppliers = useSupplierOptions({ enabled: open });
  const products = useProductList({ limit: 100, sortBy: 'name', sortOrder: 'asc' });
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    if (open) {
      setForm({
        supplierId: supplierId ? String(supplierId) : '',
        purchaseDate: todayISO(),
        supplierInvoiceNo: '',
        items: [emptyLine()],
        discountAmount: '',
        taxAmount: '',
        notes: '',
        receiveNow: true,
        payNow: false,
        payment: { amount: '', paymentMethod: 'cash', reference: '' },
      });
      setErrors([]);
    }
  }, [open, supplierId]);

  const productList = products.data?.data || [];
  const subtotal = useMemo(() => (form?.items || []).reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0), [form]);
  if (!form) return null;
  const total = subtotal - (Number(form.discountAmount) || 0) + (Number(form.taxAmount) || 0);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setLine = (index, patch) => setForm((f) => ({ ...f, items: f.items.map((l, i) => (i === index ? { ...l, ...patch } : l)) }));

  const submit = async () => {
    setBusy(true);
    setErrors([]);
    try {
      const body = {
        supplierId: Number(form.supplierId),
        purchaseDate: form.purchaseDate,
        supplierInvoiceNo: form.supplierInvoiceNo || null,
        items: form.items.filter((l) => l.productId).map((l) => ({ productId: Number(l.productId), quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
        discountAmount: Number(form.discountAmount) || 0,
        taxAmount: Number(form.taxAmount) || 0,
        notes: form.notes || null,
        receiveNow: form.receiveNow,
        ...(form.payNow && Number(form.payment.amount) > 0
          ? { initialPayment: { amount: Number(form.payment.amount), paymentMethod: form.payment.paymentMethod, reference: form.payment.reference || null } }
          : {}),
      };
      const res = await http.post('/purchases', body);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['purchases'] });
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onSaved?.(res.data);
      onClose();
    } catch (e) {
      setErrors(e.errors?.length ? e.errors.map((x) => x.message) : [e.message]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="New purchase"
      description="Record stock bought from a supplier."
      footer={
        <>
          <span className="mr-auto hidden text-sm sm:block">Total <span className="font-semibold">{formatMoney(total)}</span></span>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!form.supplierId || !form.items.some((l) => l.productId)}>Save purchase</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Select label="Supplier" required placeholder="Choose supplier" value={form.supplierId} onChange={(e) => set({ supplierId: e.target.value })} options={(suppliers.data || []).map((s) => ({ value: String(s.id), label: s.name }))} />
        <Input label="Purchase date" type="date" value={form.purchaseDate} max={todayISO()} onChange={(e) => set({ purchaseDate: e.target.value })} />
        <Input label="Supplier invoice no." value={form.supplierInvoiceNo} onChange={(e) => set({ supplierInvoiceNo: e.target.value })} />
      </div>

      <div className="mt-5">
        <p className="mb-2 text-sm font-medium">Items</p>
        <div className="space-y-2">
          {form.items.map((line, index) => (
            <div key={index} className="grid grid-cols-[1fr_5rem_7rem_auto] items-end gap-2">
              <Select
                aria-label="Product"
                placeholder="Choose product"
                value={line.productId}
                onChange={(e) => {
                  const product = productList.find((p) => p.id === Number(e.target.value));
                  setLine(index, { productId: e.target.value, unitCost: product ? String(product.purchasePrice) : line.unitCost });
                }}
                options={productList.map((p) => ({ value: String(p.id), label: `${p.name} (${p.quantity} ${p.unit})`, disabled: form.items.some((l, i) => i !== index && l.productId === String(p.id)) }))}
              />
              <Input aria-label="Quantity" type="number" min="1" value={line.quantity} onChange={(e) => setLine(index, { quantity: e.target.value })} />
              <Input aria-label="Unit cost" type="number" min="0" placeholder="Unit cost" value={line.unitCost} onChange={(e) => setLine(index, { unitCost: e.target.value })} />
              <button type="button" className="mb-1 rounded-lg p-2 text-muted hover:bg-red-500/10 hover:text-danger disabled:opacity-30" disabled={form.items.length === 1} onClick={() => set({ items: form.items.filter((_, i) => i !== index) })} aria-label="Remove line">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <Button variant="ghost" size="sm" icon={Plus} className="mt-2" onClick={() => set({ items: [...form.items, emptyLine()] })}>Add item</Button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        <Input label="Discount" type="number" min="0" value={form.discountAmount} onChange={(e) => set({ discountAmount: e.target.value })} />
        <Input label="Tax" type="number" min="0" value={form.taxAmount} onChange={(e) => set({ taxAmount: e.target.value })} />
        <div className="rounded-xl bg-surface-2/60 px-4 py-2.5 text-sm">
          <p className="flex justify-between"><span className="text-muted">Subtotal</span><span>{formatMoney(subtotal)}</span></p>
          <p className="flex justify-between font-semibold"><span>Total</span><span>{formatMoney(total)}</span></p>
        </div>
      </div>

      <div className="mt-5 space-y-3 rounded-2xl border border-line p-4">
        <Switch label="Stock received now" description="Adds the quantities to inventory immediately. Turn off for an order you will receive later." checked={form.receiveNow} onChange={(v) => set({ receiveNow: v })} />
        <Switch label="Record a payment now" checked={form.payNow} onChange={(v) => set({ payNow: v, payment: { ...form.payment, amount: v ? String(total) : '' } })} />
        {form.payNow ? (
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Amount" type="number" min="0" value={form.payment.amount} onChange={(e) => set({ payment: { ...form.payment, amount: e.target.value } })} />
            <Select label="Method" value={form.payment.paymentMethod} onChange={(e) => set({ payment: { ...form.payment, paymentMethod: e.target.value } })} options={PAYMENT_METHODS} />
            <Input label="Reference" value={form.payment.reference} onChange={(e) => set({ payment: { ...form.payment, reference: e.target.value } })} />
          </div>
        ) : null}
      </div>
      <Textarea label="Notes" rows={2} className="mt-4" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      {errors.length ? <ul className="mt-3 space-y-1 text-sm text-danger" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
    </Modal>
  );
}
