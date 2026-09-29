import { useEffect, useMemo, useState } from 'react';
import { Banknote, CreditCard, Landmark, Plus, Smartphone, X } from 'lucide-react';
import { Button, Input, Modal } from '../../components/ui';
import { cn } from '../../utils/cn';
import { formatMoney, getFormatSettings } from '../../utils/format';

const METHODS = [
  { value: 'cash', label: 'Cash', icon: Banknote },
  { value: 'mobile_money', label: 'Mobile Money', icon: Smartphone },
  { value: 'card', label: 'Card', icon: CreditCard },
  { value: 'bank_transfer', label: 'Bank', icon: Landmark },
];

/** Round up to a convenient banknote amount for quick-cash buttons. */
function quickAmounts(total) {
  const steps = [1000, 5000, 10000, 20000, 50000];
  const values = new Set([total]);
  for (const step of steps) values.add(Math.ceil(total / step) * step);
  return [...values].filter((v) => v >= total).sort((a, b) => a - b).slice(0, 5);
}

/**
 * Collect one or more payments. The figures shown here are a preview; the
 * server recalculates tendered, change and balance when the sale is saved.
 */
export function PaymentModal({ open, onClose, total, canLeaveBalance, onConfirm, submitting }) {
  const [payments, setPayments] = useState([{ method: 'cash', amount: String(total), reference: '' }]);
  useEffect(() => {
    if (open) setPayments([{ method: 'cash', amount: String(total), reference: '' }]);
  }, [open, total]);

  const decimals = getFormatSettings().decimals;
  const toNumber = (v) => Number(String(v).replace(/,/g, '')) || 0;
  const tendered = payments.reduce((s, p) => s + toNumber(p.amount), 0);
  const cash = payments.filter((p) => p.method === 'cash').reduce((s, p) => s + toNumber(p.amount), 0);
  const nonCash = tendered - cash;
  const change = Math.max(0, tendered - total);
  const balance = Math.max(0, total - tendered);

  const error = useMemo(() => {
    if (nonCash > total + 1e-9) return 'Card, mobile money and bank payments cannot exceed the amount due.';
    if (change > cash + 1e-9) return 'Change can only be given from cash.';
    if (balance > 0 && !canLeaveBalance) return 'Collect the full amount, or select a customer to leave a balance.';
    return null;
  }, [nonCash, total, change, cash, balance, canLeaveBalance]);

  const update = (index, patch) => setPayments((list) => list.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const addLine = () => {
    const used = new Set(payments.map((p) => p.method));
    const method = METHODS.find((m) => !used.has(m.value))?.value || 'mobile_money';
    setPayments((list) => [...list, { method, amount: String(Math.max(0, balance)), reference: '' }]);
  };

  const confirm = () =>
    onConfirm(payments.filter((p) => toNumber(p.amount) > 0).map((p) => ({ method: p.method, amount: toNumber(p.amount), reference: p.reference || undefined })));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Take payment"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>Back</Button>
          <Button onClick={confirm} loading={submitting} disabled={Boolean(error)} size="lg">
            {balance > 0 ? `Complete — leave ${formatMoney(balance)} due` : 'Complete sale'}
          </Button>
        </>
      }
    >
      <div className="mb-5 rounded-2xl bg-navy-850 px-5 py-4 text-center text-white dark:bg-surface-2">
        <p className="text-xs tracking-widest text-white/60 uppercase dark:text-muted">Amount due</p>
        <p className="mt-1 text-3xl font-semibold text-brand-400">{formatMoney(total)}</p>
      </div>

      <div className="space-y-4">
        {payments.map((p, index) => (
          <div key={index} className="rounded-2xl border border-line p-3">
            <div className="mb-3 flex items-center gap-2">
              <div role="radiogroup" aria-label={`Payment ${index + 1} method`} className="grid flex-1 grid-cols-4 gap-1.5">
                {METHODS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    role="radio"
                    aria-checked={p.method === m.value}
                    onClick={() => update(index, { method: m.value })}
                    className={cn('flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-[11px] font-medium', p.method === m.value ? 'border-brand-500 bg-brand-500/10 text-fg' : 'border-line text-muted hover:text-fg')}
                  >
                    <m.icon className="size-4" aria-hidden />
                    {m.label}
                  </button>
                ))}
              </div>
              {payments.length > 1 ? (
                <button type="button" onClick={() => setPayments((list) => list.filter((_, i) => i !== index))} className="rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Remove payment">
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Amount" type="number" min="0" step={decimals ? 1 / 10 ** decimals : 1} inputMode="decimal" value={p.amount} onChange={(e) => update(index, { amount: e.target.value })} />
              {p.method !== 'cash' ? (
                <Input label="Reference" placeholder={p.method === 'mobile_money' ? 'Transaction ID' : 'Optional'} value={p.reference} onChange={(e) => update(index, { reference: e.target.value })} />
              ) : (
                <div className="flex flex-wrap items-end gap-1.5">
                  {quickAmounts(total).map((amount) => (
                    <button key={amount} type="button" onClick={() => update(index, { amount: String(amount) })} className="rounded-lg border border-line px-2 py-1.5 text-xs hover:border-brand-500/50">
                      {formatMoney(amount)}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {payments.length < 4 ? (
          <Button variant="ghost" size="sm" icon={Plus} onClick={addLine}>Split payment</Button>
        ) : null}
      </div>

      <dl className="mt-5 space-y-1.5 rounded-2xl bg-surface-2/60 px-4 py-3 text-sm">
        <div className="flex justify-between"><dt className="text-muted">Tendered</dt><dd className="font-medium">{formatMoney(tendered)}</dd></div>
        {change > 0 ? <div className="flex justify-between text-base"><dt className="font-semibold">Change to give</dt><dd className="font-semibold text-success">{formatMoney(change)}</dd></div> : null}
        {balance > 0 ? <div className="flex justify-between"><dt className="text-muted">Balance left on account</dt><dd className="font-semibold text-warning">{formatMoney(balance)}</dd></div> : null}
      </dl>
      {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
    </Modal>
  );
}
