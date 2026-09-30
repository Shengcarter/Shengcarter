import { AlertTriangle, X } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatMoney, formatNumber } from '../../utils/format';

const quantityOf = (row) => Number(row.quantity) || 0;

/** Rows ready for the API: numbers, and nothing left at zero. */
export function cleanUsage(rows = []) {
  return rows
    .filter((r) => quantityOf(r) > 0)
    .map((r) => ({ productId: r.productId, quantity: quantityOf(r), ...(r.unitCost !== undefined && r.unitCost !== '' ? { unitCost: Number(r.unitCost) } : {}) }));
}

/** Expected cost of rows, from each product's cost per unit (people who see costs only). */
export function usageCost(rows = [], products = []) {
  return rows.reduce((sum, r) => {
    const product = products.find((p) => p.id === r.productId);
    const unitCost = r.unitCost !== undefined && r.unitCost !== '' ? Number(r.unitCost) : product?.unitCost ?? 0;
    return sum + Math.round(quantityOf(r) * unitCost);
  }, 0);
}

/**
 * The products used on one service: which product, how much in the unit it is
 * used in (packs, ml, grams…), and what that cost when costs may be shown.
 * value: [{ productId, quantity, unitCost? }]; `products` from /products/usable.
 * `editCost` adds a unit cost field (corrections of a recorded cost).
 */
export function ProductsUsedEditor({ value = [], onChange, products = [], showCosts = false, editCost = false, label, emptyText = 'No products used', className, idPrefix = 'usage' }) {
  const chosen = new Set(value.map((r) => r.productId));
  const options = products.filter((p) => !chosen.has(p.id));
  const update = (index, patch) => onChange(value.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const total = usageCost(value, products);

  return (
    <div className={cn('space-y-1.5', className)}>
      {label ? <p className="text-xs font-medium text-muted">{label}</p> : null}
      {!value.length ? <p className="text-xs text-muted">{emptyText}</p> : null}
      <ul className="space-y-1.5">
        {value.map((row, index) => {
          const product = products.find((p) => p.id === row.productId);
          const name = product?.name || row.name || 'Product';
          const unit = product?.unit || row.unit || '';
          const unitCost = row.unitCost !== undefined && row.unitCost !== '' ? Number(row.unitCost) : product?.unitCost;
          const short = product && quantityOf(row) > product.inStock;
          return (
            <li key={row.productId} className="rounded-lg bg-surface-2/60 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium" title={name}>{name}</span>
                <input
                  id={`${idPrefix}-${row.productId}`}
                  aria-label={`Quantity of ${name} (${unit})`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="any"
                  value={row.quantity}
                  onChange={(e) => update(index, { quantity: e.target.value })}
                  className={cn('h-7 w-16 rounded-md border bg-surface px-1.5 text-right text-xs tabular-nums', short ? 'border-amber-500/70' : 'border-line')}
                />
                <span className="w-9 shrink-0 truncate text-xs text-muted" title={unit}>{unit}</span>
                {editCost ? (
                  <input
                    aria-label={`Cost per ${unit} of ${name}`}
                    type="number"
                    min="0"
                    step="any"
                    value={row.unitCost ?? ''}
                    placeholder={product?.unitCost !== undefined ? String(product.unitCost) : 'cost'}
                    onChange={(e) => update(index, { unitCost: e.target.value })}
                    className="h-7 w-20 rounded-md border border-line bg-surface px-1.5 text-right text-xs tabular-nums"
                  />
                ) : null}
                {showCosts ? <span className="w-20 shrink-0 text-right text-xs tabular-nums">{unitCost !== undefined ? formatMoney(Math.round(quantityOf(row) * unitCost)) : '—'}</span> : null}
                <button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))} className="rounded p-0.5 text-muted hover:text-danger" aria-label={`Remove ${name}`}>
                  <X className="size-3.5" />
                </button>
              </div>
              {short ? (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-warning">
                  <AlertTriangle className="size-3" aria-hidden />Only {formatNumber(product.inStock, { maximumFractionDigits: 3 })} {unit} in stock
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="flex items-center gap-2">
        {options.length ? (
          <select
            aria-label="Add a product used"
            value=""
            onChange={(e) => {
              const id = Number(e.target.value);
              if (id) onChange([...value, { productId: id, quantity: '1' }]);
            }}
            className="h-7 min-w-0 flex-1 rounded-lg border border-dashed border-line bg-surface px-2 text-xs text-muted"
          >
            <option value="">+ Add product used</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.unit}){p.isRetail ? '' : ' · salon use'}</option>
            ))}
          </select>
        ) : <span className="flex-1" />}
        {showCosts && value.length ? <span className="text-xs text-muted">Products: <span className="font-semibold text-fg tabular-nums">{formatMoney(total)}</span></span> : null}
      </div>
    </div>
  );
}
