import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Loader2, Package, ReceiptText, Scissors, Search, UserRoundCheck, Users } from 'lucide-react';
import { Modal } from '../ui';
import { http } from '../../api/client';
import { useDebounce } from '../../hooks';
import { cn } from '../../utils/cn';

const GROUPS = [
  { key: 'customers', label: 'Customers', icon: Users },
  { key: 'appointments', label: 'Appointments', icon: CalendarDays },
  { key: 'sales', label: 'Invoices', icon: ReceiptText },
  { key: 'products', label: 'Products', icon: Package },
  { key: 'services', label: 'Services', icon: Scissors },
  { key: 'employees', label: 'Employees', icon: UserRoundCheck },
];

/** Command palette (Ctrl/⌘ + K) searching across the whole system. */
export function GlobalSearch({ open, onClose }) {
  const [term, setTerm] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounce(term.trim(), 250);
  const navigate = useNavigate();
  const listRef = useRef(null);

  const query = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => http.get('/search', { q: debounced }).then((r) => r.data),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });

  const flat = useMemo(() => {
    const data = query.data || {};
    return GROUPS.flatMap((g) => (data[g.key] || []).map((item) => ({ ...item, group: g })));
  }, [query.data]);

  useEffect(() => setActive(0), [debounced]);
  useEffect(() => {
    if (!open) setTerm('');
  }, [open]);

  const go = (item) => {
    onClose();
    navigate(item.link);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      go(flat[active]);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <Modal open={open} onClose={onClose} size="lg" className="sm:mt-[-12vh]">
      <div className="-mx-5 -mt-5 border-b border-line px-5 sm:-mx-6 sm:px-6">
        <div className="relative flex items-center">
          <Search className="absolute left-0 size-5 text-muted" aria-hidden />
          <input
            data-autofocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search customers, appointments, invoices, products…"
            aria-label="Search everything"
            role="combobox"
            aria-expanded={flat.length > 0}
            aria-controls="global-search-results"
            aria-activedescendant={flat[active] ? `search-item-${active}` : undefined}
            className="h-14 w-full bg-transparent pl-8 text-base text-fg placeholder:text-muted focus:outline-none"
          />
          {query.isFetching ? <Loader2 className="absolute right-0 size-4 animate-spin text-muted" /> : null}
        </div>
      </div>

      <div ref={listRef} id="global-search-results" role="listbox" className="-mx-2 mt-3 min-h-40">
        {debounced.length < 2 ? (
          <p className="px-3 py-10 text-center text-sm text-muted">Type at least 2 characters. Use ↑ ↓ and Enter to open a result.</p>
        ) : query.isError ? (
          <p className="px-3 py-10 text-center text-sm text-danger">{query.error.message}</p>
        ) : !query.isPending && !flat.length ? (
          <p className="px-3 py-10 text-center text-sm text-muted">No results for “{debounced}”.</p>
        ) : (
          GROUPS.map((group) => {
            const items = flat.filter((i) => i.group.key === group.key);
            if (!items.length) return null;
            return (
              <div key={group.key} className="mb-3">
                <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{group.label}</p>
                {items.map((item) => {
                  const index = flat.indexOf(item);
                  return (
                    <button
                      key={`${group.key}-${item.id}`}
                      id={`search-item-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={index === active}
                      type="button"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => go(item)}
                      className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', index === active ? 'bg-surface-2' : '')}
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-500/10 text-accent">
                        <group.icon className="size-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{item.title}</span>
                        {item.subtitle ? <span className="block truncate text-xs text-muted">{item.subtitle}</span> : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </Modal>
  );
}
