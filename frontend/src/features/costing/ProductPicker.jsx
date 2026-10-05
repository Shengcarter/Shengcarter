import { useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../utils/cn';
import { formatNumber } from '../../utils/format';

/** "SHAMPOO 500ML · HC-SHA-001": how a product is named everywhere at the till. */
export function productLabel(product) {
  if (!product) return '';
  return product.sku ? `${product.name} · ${product.sku}` : product.name;
}

/** Does a product match what was typed (name, SKU, barcode or category)? */
export function matchesProduct(product, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [product.name, product.sku, product.barcode, product.category]
    .filter(Boolean)
    .some((field) => String(field).toLowerCase().includes(q));
}

/**
 * Searchable product chooser: type part of the name, the SKU, the barcode (a
 * scanner types it and presses Enter) or the category. Each option shows the
 * name with its SKU, its category and what is in stock.
 */
export function ProductPicker({ products = [], onSelect, placeholder = 'Add product used — search name, SKU or barcode', className, label = 'Add a product used' }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const found = products.filter((p) => matchesProduct(p, q));
    // An exact SKU or barcode (e.g. scanned) comes first.
    found.sort((a, b) => {
      const exact = (p) => (q && [p.sku, p.barcode].some((v) => v && String(v).toLowerCase() === q) ? 0 : 1);
      return exact(a) - exact(b);
    });
    return found.slice(0, 30);
  }, [products, query]);

  const choose = (product) => {
    if (!product) return;
    onSelect(product);
    setQuery('');
    setActive(0);
    setOpen(false);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (open || query) choose(matches[active]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  if (!products.length) return null;

  return (
    <div className={cn('relative min-w-0 flex-1', className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={label}
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && matches[active] ? `${listId}-${matches[active].id}` : undefined}
          value={query}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className="h-7 w-full min-w-0 rounded-lg border border-dashed border-line bg-surface pr-2 pl-7 text-xs placeholder:text-muted"
        />
      </div>
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-60 w-full min-w-64 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
          {matches.length ? matches.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${p.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('cursor-pointer rounded-lg px-2 py-1.5', i === active ? 'bg-brand-500/10' : '')}
            >
              <p className="truncate text-xs font-medium">
                {p.name}
                {p.sku ? <span className="ml-1.5 font-mono text-[11px] text-muted">{p.sku}</span> : null}
              </p>
              <p className="truncate text-[11px] text-muted">
                {[p.category, `${formatNumber(p.inStock, { maximumFractionDigits: 3 })} ${p.unit} in stock`, p.isRetail ? null : 'salon use'].filter(Boolean).join(' · ')}
              </p>
            </li>
          )) : <li className="px-2 py-1.5 text-xs text-muted">No product matches “{query}”</li>}
        </ul>
      ) : null}
    </div>
  );
}
