import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal } from '../../components/ui';
import { cn } from '../../utils/cn';
import { formatNumber } from '../../utils/format';
import { inventoryApi } from './api';

const TYPES = [
  { value: 'stock_in', label: 'Stock in', hint: 'Units received (not via a purchase order)' },
  { value: 'stock_out', label: 'Stock out', hint: 'Units removed for another reason' },
  { value: 'adjustment', label: 'Stock count', hint: 'Enter the counted quantity; the difference is recorded' },
  { value: 'damage', label: 'Damaged', hint: 'Broken, spoiled or expired units' },
  { value: 'internal_use', label: 'Salon use', hint: 'Used during services' },
];

export function AdjustStockModal({ product, onClose }) {
  const qc = useQueryClient();
  const [type, setType] = useState('stock_in');
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (product) {
      setType('stock_in');
      setQuantity('');
      setUnitCost(String(product.purchasePrice ?? ''));
      setReason('');
    }
  }, [product]);

  if (!product) return null;
  const qty = Number(quantity) || 0;
  const after = type === 'adjustment' ? qty : type === 'stock_in' ? product.quantity + qty : product.quantity - qty;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await inventoryApi.adjust({ productId: product.id, type, quantity: qty, unitCost: type === 'stock_in' && unitCost ? Number(unitCost) : undefined, reason });
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={Boolean(product)}
      onClose={onClose}
      title="Adjust stock"
      description={`${product.name} · ${formatNumber(product.quantity)} ${product.unit} in stock`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!reason.trim() || (type !== 'adjustment' && qty <= 0) || after < 0}>Save</Button></>}
    >
      <div role="radiogroup" aria-label="Movement type" className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {TYPES.map((t) => (
          <button key={t.value} type="button" role="radio" aria-checked={type === t.value} onClick={() => setType(t.value)}
            className={cn('rounded-xl border px-3 py-2 text-left text-sm', type === t.value ? 'border-gold-500 bg-gold-500/10' : 'border-line hover:border-gold-500/40')}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-xs text-muted">{TYPES.find((t) => t.value === type).hint}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label={type === 'adjustment' ? 'Counted quantity' : 'Quantity'} type="number" min="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-autofocus />
        {type === 'stock_in' ? <Input label="Unit cost" type="number" min="0" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} hint="Updates the product's purchase price" /> : null}
        <Input label="Reason" className="sm:col-span-2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="E.g. monthly stock count, bottle broken…" />
      </div>
      <div className={cn('mt-4 rounded-xl px-4 py-3 text-sm', after < 0 ? 'bg-red-500/10 text-danger' : 'bg-surface-2')}>
        Stock after this change: <span className="font-semibold">{formatNumber(after)}</span> {product.unit}
        {after < 0 ? ' — not enough stock' : ''}
      </div>
    </Modal>
  );
}
