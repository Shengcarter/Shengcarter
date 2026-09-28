import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Search, UserPlus, X } from 'lucide-react';
import { Avatar, Badge } from '../../components/ui';
import { useCustomers } from './api';
import { CustomerFormModal } from './CustomerFormModal';
import { useDebounce, usePermission } from '../../hooks';
import { cn } from '../../utils/cn';

/**
 * Searchable customer selector (combobox) with inline "add new customer".
 * value: selected customer object or null.
 */
export function CustomerPicker({ value, onChange, label = 'Customer', error, className }) {
  const can = usePermission();
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const debounced = useDebounce(term.trim(), 250);
  const rootRef = useRef(null);
  const results = useCustomers({ search: debounced, limit: 8, sortBy: 'name', sortOrder: 'asc' }, { enabled: open });
  const rows = results.data?.data || [];
  // True once the list on screen matches what is typed; a fast Enter waits for it.
  const settled = debounced === term.trim() && !results.isPending && !results.isPlaceholderData;
  const [pendingEnter, setPendingEnter] = useState(false);

  useEffect(() => {
    const onPointer = (e) => rootRef.current && !rootRef.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onPointer);
    return () => document.removeEventListener('mousedown', onPointer);
  }, []);
  useEffect(() => setActive(0), [debounced]);

  const choose = (customer) => {
    onChange(customer);
    setOpen(false);
    setTerm('');
    setPendingEnter(false);
  };

  useEffect(() => {
    if (!pendingEnter || !settled) return;
    setPendingEnter(false);
    if (rows[active]) choose(rows[active]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEnter, settled]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, rows.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (settled) {
        if (rows[active]) choose(rows[active]);
      } else {
        setPendingEnter(true);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  if (value) {
    return (
      <div className={className}>
        {label ? <p className="mb-1.5 text-sm font-medium">{label}</p> : null}
        <div className="flex items-center gap-3 rounded-xl border border-gold-500/40 bg-gold-500/5 px-3 py-2.5">
          <Avatar name={value.fullName} src={value.photo} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{value.fullName}</p>
            <p className="truncate text-xs text-muted">{value.phone} · {value.code}{value.tier ? ` · ${value.tier.name}` : ''}</p>
          </div>
          {value.loyaltyPoints ? <Badge tone="gold">{value.loyaltyPoints} pts</Badge> : null}
          <button type="button" onClick={() => onChange(null)} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label="Change customer">
            <X className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      {label ? <label htmlFor="customer-picker" className="mb-1.5 block text-sm font-medium">{label}</label> : null}
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          id="customer-picker"
          role="combobox"
          aria-expanded={open}
          aria-controls="customer-picker-list"
          aria-autocomplete="list"
          autoComplete="off"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search by name, phone or code…"
          className={cn(
            'h-10 w-full rounded-xl border bg-surface pr-9 pl-9 text-sm focus:border-gold-500 focus:ring-2 focus:ring-gold-500/25 focus:outline-none',
            error ? 'border-danger/70' : 'border-line',
          )}
        />
        {results.isFetching ? <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted" /> : null}
      </div>
      {error ? <p className="mt-1 text-xs text-danger" role="alert">{error}</p> : null}

      {open ? (
        <div id="customer-picker-list" role="listbox" className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface shadow-xl">
          <div className={cn('scrollbar-thin max-h-72 overflow-y-auto p-1 transition-opacity', !settled && 'opacity-60')}>
            {rows.map((c, i) => (
              <button
                key={c.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(c)}
                className={cn('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === active && 'bg-surface-2')}
              >
                <Avatar name={c.fullName} src={c.photo} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{c.fullName}</span>
                  <span className="block truncate text-xs text-muted">{c.phone} · {c.code}</span>
                </span>
                {i === active ? <Check className="size-4 text-accent" /> : null}
              </button>
            ))}
            {!results.isPending && !rows.length ? <p className="px-3 py-4 text-center text-sm text-muted">No customers found</p> : null}
          </div>
          {can('customers.create') ? (
            <button type="button" onClick={() => setCreating(true)} className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-sm font-medium text-accent hover:bg-gold-500/5">
              <UserPlus className="size-4" /> Add new customer{term ? ` “${term}”` : ''}
            </button>
          ) : null}
        </div>
      ) : null}

      <CustomerFormModal open={creating} onClose={() => setCreating(false)} initialName={term} onSaved={(c) => choose(c)} />
    </div>
  );
}
