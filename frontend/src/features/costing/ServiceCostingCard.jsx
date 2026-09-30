import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CircleCheck, History, Package, PencilLine } from 'lucide-react';
import { Button, Card, Input, Modal, Textarea } from '../../components/ui';
import { cn } from '../../utils/cn';
import { formatMoney, formatNumber } from '../../utils/format';
import { usePermission } from '../../hooks';
import { useEmployeeOptions } from '../services/api';
import { salesKeys } from '../pos/api';
import { ProductsUsedEditor, cleanUsage } from './ProductsUsedEditor';
import { MarginBadge, RevisionList, SplitBreakdown } from './SplitBreakdown';
import { costingApi, useUsableProducts } from './api';

/**
 * Correct a completed service: products used (quantity or cost), price or
 * staff, with a reason. The server recalculates the split with the
 * percentages that applied when it was sold and keeps the earlier figures.
 */
function CorrectionModal({ sale, item, open, onClose }) {
  const qc = useQueryClient();
  const products = useUsableProducts({ enabled: open });
  const employees = useEmployeeOptions({ includeInactive: false }, { enabled: open });
  const [price, setPrice] = useState('');
  const [staffIds, setStaffIds] = useState([]);
  const [usage, setUsage] = useState([]);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPrice(String(item.unitPrice));
    setStaffIds(item.staff.map((m) => m.id));
    setUsage(item.productsUsed.map((u) => ({ productId: u.productId, quantity: String(u.quantity), unitCost: String(u.unitCost ?? ''), name: u.name, unit: u.unit })));
    setReason('');
  }, [open, item]);

  const submit = async () => {
    const body = { reason: reason.trim() };
    if (Number(price) !== Number(item.unitPrice)) body.price = Number(price);
    if (staffIds.join(',') !== item.staff.map((m) => m.id).join(',')) body.employeeIds = staffIds;
    const cleaned = cleanUsage(usage);
    const before = item.productsUsed.map((u) => `${u.productId}:${u.quantity}:${u.unitCost}`).join('|');
    if (cleaned.map((u) => `${u.productId}:${u.quantity}:${u.unitCost ?? ''}`).join('|') !== before) body.consumption = cleaned;
    if (Object.keys(body).length === 1) {
      toast.error('Nothing has changed');
      return;
    }
    setBusy(true);
    try {
      const res = await costingApi.correct(sale.id, item.id, body);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: salesKeys.all });
      qc.invalidateQueries({ queryKey: ['products'] });
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  // Staff who worked on it before stay selectable even if they have left since.
  const people = [...(employees.data || [])];
  for (const m of item.staff) if (!people.some((p) => p.id === m.id)) people.push({ id: m.id, fullName: m.fullName });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={`Correct ${item.description}`}
      description="The service is recalculated with the percentages in force when it was sold. Stock, staff pay and any pending payout follow; the earlier figures are kept."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!reason.trim() || !staffIds.length}>Save correction</Button></>}
    >
      <div className="space-y-5">
        <Input label="Price charged" type="number" min="0" step="any" value={price} onChange={(e) => setPrice(e.target.value)} hint="Changing it re-totals the invoice. It cannot go below what the customer has already paid." />
        <div>
          <p className="mb-2 text-sm font-medium">Who performed it</p>
          <div className="flex flex-wrap gap-2">
            {people.map((p) => {
              const on = staffIds.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setStaffIds(on ? staffIds.filter((x) => x !== p.id) : [...staffIds, p.id])}
                  className={cn('rounded-lg border px-2.5 py-1 text-sm', on ? 'border-brand-500/50 bg-brand-500/10 text-accent' : 'border-line text-muted')}
                >
                  {p.fullName}
                </button>
              );
            })}
          </div>
        </div>
        <ProductsUsedEditor
          label="Products actually used (quantity and cost per unit)"
          value={usage}
          onChange={setUsage}
          products={products.data || []}
          showCosts
          editCost
          idPrefix={`fix-${item.id}`}
        />
        <Textarea label="Reason for the correction" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The stylist used a third pack of hair" />
      </div>
    </Modal>
  );
}

function ReviewModal({ sale, item, open, onClose }) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const res = await costingApi.review(sale.id, item.id, note.trim());
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
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Mark as reviewed"
      description="Say why the products cost as much as (or more than) the price, e.g. a special price agreed with the customer. To change figures, use Correct instead."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!note.trim()}>Mark reviewed</Button></>}
    >
      <Textarea label="Note" required rows={3} value={note} onChange={(e) => setNote(e.target.value)} data-autofocus />
    </Modal>
  );
}

/**
 * The products used on each service of a sale and, for people who see costs,
 * where the money went: price → products → operations → staff → salon profit.
 */
export function ServiceCostingCard({ sale }) {
  const can = usePermission();
  const [correcting, setCorrecting] = useState(null);
  const [reviewing, setReviewing] = useState(null);
  const [history, setHistory] = useState(null);
  const services = sale.items.filter((i) => i.itemType === 'service' && (i.hasCosting || i.productsUsed?.length));
  if (!services.length) return null;
  const canCorrect = can('sales.correct') && sale.status === 'completed' && !sale.isImported;

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">Service costs</h2>
      <p className="mb-4 text-xs text-muted">Products used on each service and how the money was split.</p>
      <div className="divide-y divide-line">
        {services.map((item) => (
          <section key={item.id} className="py-4 first:pt-0 last:pb-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="font-medium">{item.description}</h3>
              <MarginBadge status={item.costing?.marginStatus} reviewStatus={item.costing?.reviewStatus} />
              {!item.costing && item.needsReview ? <MarginBadge status="zero" reviewStatus="pending" /> : null}
              <div className="ml-auto flex gap-1.5">
                {item.costing?.revisions?.length ? (
                  <Button size="xs" variant="ghost" icon={History} onClick={() => setHistory(history === item.id ? null : item.id)}>
                    {item.costing.revisions.length} correction{item.costing.revisions.length === 1 ? '' : 's'}
                  </Button>
                ) : null}
                {canCorrect && item.costing?.reviewStatus === 'pending' ? <Button size="xs" variant="secondary" icon={CircleCheck} onClick={() => setReviewing(item)}>Mark reviewed</Button> : null}
                {canCorrect && item.hasCosting ? <Button size="xs" variant="secondary" icon={PencilLine} onClick={() => setCorrecting(item)}>Correct</Button> : null}
              </div>
            </div>

            <div className={cn('grid gap-4', item.costing && 'md:grid-cols-2')}>
              <div>
                <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted"><Package className="size-3.5" aria-hidden />Products used</p>
                {item.productsUsed?.length ? (
                  <ul className="space-y-1 text-sm">
                    {item.productsUsed.map((u) => (
                      <li key={u.productId} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate">{u.name} <span className="text-muted">× {formatNumber(u.quantity, { maximumFractionDigits: 3 })} {u.unit}</span></span>
                        {u.cost !== undefined ? (
                          <span className="shrink-0 text-muted tabular-nums">{formatMoney(u.unitCost, { maxDecimals: 2 })} / {u.unit} = <span className="text-fg">{formatMoney(u.cost)}</span></span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-muted">None</p>}
              </div>
              {item.costing ? (
                <SplitBreakdown
                  split={item.costing}
                  staff={item.staff.map((m) => ({ name: m.fullName, amount: m.commissionAmount }))}
                />
              ) : null}
            </div>
            {item.costing?.reviewStatus === 'reviewed' ? (
              <p className="mt-2 text-xs text-muted">Reviewed by {item.costing.reviewedBy}: {item.costing.reviewNote}</p>
            ) : null}
            {history === item.id ? <div className="mt-3"><RevisionList revisions={item.costing.revisions} /></div> : null}
          </section>
        ))}
      </div>
      {correcting ? <CorrectionModal sale={sale} item={correcting} open onClose={() => setCorrecting(null)} /> : null}
      {reviewing ? <ReviewModal sale={sale} item={reviewing} open onClose={() => setReviewing(null)} /> : null}
    </Card>
  );
}
