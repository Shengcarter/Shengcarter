import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, History, Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Input, Modal, QueryState, Segmented, Switch } from '../../components/ui';
import { cn } from '../../utils/cn';
import { formatDateTime, formatMoney } from '../../utils/format';
import { useDebounce, usePermission } from '../../hooks';
import { serviceApi, serviceKeys, useFinancialRule } from './api';

/**
 * A service's financial rule: how its price is split between the cost of
 * products used, operations, the staff pool and salon profit. Saving adds a
 * new version; sales already made keep the version they were calculated with.
 * The server checks every rule (parts must add up) — nothing is guessed.
 */

const PART_TYPES = {
  operations: [
    { value: 'fixed', label: 'Fixed amount' },
    { value: 'percent', label: '% of price after products' },
    { value: 'none', label: 'Nothing' },
  ],
  staff: [
    { value: 'fixed', label: 'Fixed amount' },
    { value: 'percent', label: '% of what is left' },
    { value: 'remainder', label: 'The rest' },
    { value: 'none', label: 'Nothing' },
  ],
  profit: [
    { value: 'fixed', label: 'Fixed amount' },
    { value: 'percent', label: '% of what is left' },
    { value: 'remainder', label: 'The rest' },
    { value: 'none', label: 'Nothing' },
  ],
};
const PART_LABELS = { operations: 'Operations', staff: 'Staff pool', profit: 'Salon profit' };
const METHOD_LABELS = { general: 'General formula', bands: 'Price bands', unconfigured: 'Not configured' };

const blankBand = (price = '') => ({
  min: price, max: price, label: '', general: false,
  operations: { type: 'fixed', value: '' }, staff: { type: 'remainder' }, profit: { type: 'none' },
});

/** Draft (strings while typing) → the rule the API expects. */
function toRule(draft) {
  const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));
  const part = (p) => (p.type === 'fixed' || p.type === 'percent' ? { type: p.type, value: num(p.value) } : { type: p.type });
  return {
    method: draft.method,
    productCost: draft.productCost,
    productsIncluded: draft.productsIncluded,
    staffSplit: 'equal',
    bands: draft.method === 'bands'
      ? draft.bands.map((b) => (b.general
        ? { min: num(b.min), max: num(b.max), ...(b.label ? { label: b.label } : {}), general: true }
        : { min: num(b.min), max: num(b.max), ...(b.label ? { label: b.label } : {}), operations: part(b.operations), staff: part(b.staff), profit: part(b.profit) }))
      : [],
  };
}

function fromRule(rule) {
  const part = (p) => ({ type: p?.type || 'none', value: p?.value ?? '' });
  return {
    method: rule?.method || 'general',
    productCost: rule?.productCost || 'deduct',
    productsIncluded: rule?.productsIncluded !== false,
    bands: (rule?.bands || []).map((b) => ({
      min: b.min, max: b.max, label: b.label || '', general: Boolean(b.general),
      operations: part(b.operations), staff: part(b.staff), profit: part(b.profit),
    })),
  };
}

function PartInput({ name, part, onChange, disabled }) {
  const withValue = part.type === 'fixed' || part.type === 'percent';
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium text-muted">{PART_LABELS[name]}</p>
      <div className="flex gap-1">
        <select
          aria-label={`${PART_LABELS[name]}: how it is worked out`}
          value={part.type}
          disabled={disabled}
          onChange={(e) => onChange({ type: e.target.value, value: part.value })}
          className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-surface px-1.5 text-xs"
        >
          {PART_TYPES[name].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {withValue ? (
          <input
            aria-label={`${PART_LABELS[name]} ${part.type === 'percent' ? 'percentage' : 'amount'}`}
            type="number"
            min="0"
            step="any"
            disabled={disabled}
            value={part.value}
            placeholder={part.type === 'percent' ? '%' : '0'}
            onChange={(e) => onChange({ type: part.type, value: e.target.value })}
            className="h-8 w-20 rounded-lg border border-line bg-surface px-1.5 text-right text-xs tabular-nums"
          />
        ) : null}
      </div>
    </div>
  );
}

function BandEditor({ band, index, onChange, onRemove, disabled }) {
  const set = (patch) => onChange({ ...band, ...patch });
  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input label="Lowest price" type="number" min="0" step="any" className="w-28" disabled={disabled} value={band.min} onChange={(e) => set({ min: e.target.value })} />
        <Input label="Highest price" type="number" min="0" step="any" className="w-28" disabled={disabled} value={band.max} onChange={(e) => set({ max: e.target.value })} />
        <Input label="Label (optional)" className="min-w-28 flex-1" disabled={disabled} maxLength={60} value={band.label} onChange={(e) => set({ label: e.target.value })} />
        {!disabled ? <Button variant="ghost" size="sm" icon={Trash2} onClick={onRemove} aria-label={`Remove band ${index + 1}`} /> : null}
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs">
        <input type="checkbox" className="size-4 accent-brand-500" disabled={disabled} checked={band.general} onChange={(e) => set({ general: e.target.checked })} />
        Use the general formula in this band (Settings → Financial)
      </label>
      {!band.general ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {['operations', 'staff', 'profit'].map((key) => (
            <PartInput key={key} name={key} part={band[key]} disabled={disabled} onChange={(part) => set({ [key]: part })} />
          ))}
        </div>
      ) : null}
    </li>
  );
}

function Preview({ draft, service, canEdit }) {
  const [price, setPrice] = useState('');
  const [staff, setStaff] = useState(1);
  const [result, setResult] = useState(null);
  const rule = useMemo(() => toRule(draft), [draft]);
  const input = useDebounce({ rule, price, staff }, 300);

  useEffect(() => {
    if (!canEdit || input.price === '' || !(Number(input.price) >= 0)) {
      setResult(null);
      return undefined;
    }
    let cancelled = false;
    serviceApi.previewRule({ rule: input.rule, price: Number(input.price), staffCount: Number(input.staff) || 1 })
      .then((r) => !cancelled && setResult(r))
      .catch((e) => !cancelled && setResult({ ok: false, error: e.errors?.[0]?.message || e.message }));
    return () => {
      cancelled = true;
    };
  }, [input, canEdit]);

  if (!canEdit) return null;
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-3">
      <p className="text-sm font-medium">Try it</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Input label="Price charged" type="number" min="0" step="any" className="w-32" value={price} placeholder={String(service?.price ?? '')} onChange={(e) => setPrice(e.target.value)} />
        <Input label="Staff on it" type="number" min="1" max="20" className="w-28" value={staff} onChange={(e) => setStaff(e.target.value)} />
      </div>
      {result?.ok ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
          {draft.method !== 'unconfigured' && result.productCostDeducted ? <div><dt className="text-xs text-muted">Products</dt><dd className="tabular-nums">{formatMoney(result.productCost)}</dd></div> : null}
          <div><dt className="text-xs text-muted">Operations</dt><dd className="tabular-nums">{formatMoney(result.operations)}</dd></div>
          <div>
            <dt className="text-xs text-muted">Staff pool</dt>
            <dd className="tabular-nums">{formatMoney(result.staffPool)}{result.staffShares.length > 1 ? <span className="text-xs text-muted"> ({result.staffShares.map((s) => formatMoney(s)).join(' + ')})</span> : null}</dd>
          </div>
          <div><dt className="text-xs text-muted">Salon profit</dt><dd className="tabular-nums">{formatMoney(result.salonProfit)}</dd></div>
          <div><dt className="text-xs text-muted">Allocated</dt><dd className="tabular-nums">{formatMoney(result.totalAllocated)} of {formatMoney(result.price)}</dd></div>
          <div><dt className="text-xs text-muted">How</dt><dd>{result.method === 'general' || result.method === 'band_general' ? 'General formula' : `Band ${result.band?.label}`}</dd></div>
        </dl>
      ) : result ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-danger" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{result.error}</p>
      ) : (
        <p className="mt-2 text-xs text-muted">Enter a price to see how it would be split.</p>
      )}
    </div>
  );
}

export function FinancialRuleModal({ open, onClose, service }) {
  const can = usePermission();
  const canEdit = can('services.rules');
  const qc = useQueryClient();
  const query = useFinancialRule(open ? service?.id : null);
  const [draft, setDraft] = useState(fromRule(null));
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (open && query.data) {
      setDraft(fromRule(query.data.rule));
      setNotes('');
      setErrors([]);
    }
  }, [open, query.data]);

  const setBand = (index, band) => setDraft((d) => ({ ...d, bands: d.bands.map((b, i) => (i === index ? band : b)) }));
  const fixedOnly = draft.method === 'bands' && draft.bands.length && draft.bands.every((b) => !b.general && ['staff', 'profit'].every((k) => b[k].type !== 'remainder'));

  const save = async () => {
    setSaving(true);
    setErrors([]);
    try {
      const res = await serviceApi.saveRule(service.id, { rule: toRule(draft), notes: notes || undefined });
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['services', service.id, 'financial-rule'] });
      qc.invalidateQueries({ queryKey: serviceKeys.all });
      onClose();
    } catch (error) {
      setErrors(error.errors?.length ? error.errors.map((e) => e.message) : [error.message]);
    } finally {
      setSaving(false);
    }
  };

  const data = query.data;
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Financial rule — ${service?.name || ''}`}
      description="How this service's price is split: products used, operations, the staff pool (shared equally) and salon profit. Past sales keep the rule they were sold with."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</Button>
          {canEdit ? <Button onClick={save} loading={saving}>Save as version {(data?.current?.version || 0) + 1}</Button> : null}
        </>
      }
    >
      <QueryState query={query}>
        {() => (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted">In force:</span>
              <Badge tone={data.rule.method === 'unconfigured' ? 'warning' : 'brand'}>{METHOD_LABELS[data.rule.method]}</Badge>
              {data.current ? <span className="text-xs text-muted">version {data.current.version}{data.current.createdBy ? ` · ${data.current.createdBy}` : ''} · {formatDateTime(data.current.createdAt)}</span> : null}
              <span className="text-xs text-muted">· Price {formatMoney(data.price)}{data.maxPrice ? ` to ${formatMoney(data.maxPrice)}` : ''}</span>
            </div>
            {data.warnings.length ? (
              <ul className="space-y-1">
                {data.warnings.map((w) => <li key={w} className="flex items-start gap-2 text-sm text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />{w}</li>)}
              </ul>
            ) : null}

            <div className="space-y-3">
              <Segmented
                options={[{ value: 'general', label: 'General formula' }, { value: 'bands', label: 'Price bands' }, { value: 'unconfigured', label: 'Not configured' }]}
                value={draft.method}
                onChange={(method) => canEdit && setDraft((d) => ({ ...d, method, bands: method === 'bands' && !d.bands.length ? [blankBand(data.price)] : d.bands }))}
              />
              <p className="text-xs text-muted">
                {draft.method === 'general'
                  ? `The salon's general formula: price − products → ${data.generalRates.operations}% operations → ${data.generalRates.employee}% staff / ${data.generalRates.profit}% salon profit of the rest.`
                  : draft.method === 'bands'
                    ? 'A rule for each price or price range. Operations come first; staff and salon profit share what is left. A band needs one part that takes "the rest", or it must be a single price whose amounts add up exactly.'
                    : 'Nothing is decided yet: this service cannot be sold or imported until its rule is set.'}
              </p>
            </div>

            {draft.method !== 'unconfigured' ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Switch
                  label="The price includes the products used"
                  description="Off: products for this service are sold separately, so their cost is not taken from it."
                  checked={draft.productsIncluded}
                  disabled={!canEdit}
                  onChange={(v) => setDraft((d) => ({ ...d, productsIncluded: v }))}
                />
                <Switch
                  label="Deduct the cost of products used first"
                  description="Off: no product cost is taken from the price (products used are still recorded and taken from stock)."
                  checked={draft.productCost === 'deduct'}
                  disabled={!canEdit || !draft.productsIncluded}
                  onChange={(v) => setDraft((d) => ({ ...d, productCost: v ? 'deduct' : 'none' }))}
                />
              </div>
            ) : null}

            {draft.method === 'bands' ? (
              <div>
                <ul className="space-y-2">
                  {draft.bands.map((band, i) => (
                    <BandEditor key={i} band={band} index={i} disabled={!canEdit} onChange={(b) => setBand(i, b)} onRemove={() => setDraft((d) => ({ ...d, bands: d.bands.filter((_, j) => j !== i) }))} />
                  ))}
                </ul>
                {canEdit ? (
                  <Button variant="secondary" size="sm" icon={Plus} className="mt-2" onClick={() => setDraft((d) => ({ ...d, bands: [...d.bands, blankBand()] }))}>Add price band</Button>
                ) : null}
                {fixedOnly && draft.productCost === 'deduct' && draft.productsIncluded ? (
                  <p className="mt-2 text-xs text-warning">Bands with only fixed amounts need product cost set to “not deducted”.</p>
                ) : null}
              </div>
            ) : null}

            <Preview draft={draft} service={service} canEdit={canEdit} />

            {canEdit ? (
              <Input label="Why is it changing? (kept in the history)" maxLength={255} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Confirmed by the owner on 1 October" />
            ) : null}

            {errors.length ? (
              <ul className="space-y-1 rounded-xl border border-red-500/30 bg-red-500/10 p-3" role="alert">
                {errors.map((e) => <li key={e} className="text-sm text-danger">{e}</li>)}
              </ul>
            ) : null}

            <div>
              <button type="button" onClick={() => setShowHistory((v) => !v)} className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-fg" aria-expanded={showHistory}>
                <History className="size-4" aria-hidden />Versions ({data.history.length})
              </button>
              {showHistory ? (
                <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
                  {data.history.map((v) => (
                    <li key={v.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2', v.id === data.current?.id && 'bg-brand-500/5')}>
                      <span className="font-medium">v{v.version}</span>
                      <span>{METHOD_LABELS[v.method]}</span>
                      <span className="text-xs text-muted">{formatDateTime(v.createdAt)}{v.createdBy ? ` · ${v.createdBy}` : ''}</span>
                      <span className="text-xs text-muted">{v.salesCount} sale{v.salesCount === 1 ? '' : 's'}</span>
                      {v.notes ? <span className="w-full text-xs text-muted">{v.notes}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        )}
      </QueryState>
    </Modal>
  );
}
