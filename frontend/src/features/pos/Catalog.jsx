import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Package, Scissors, ScanBarcode } from 'lucide-react';
import { http } from '../../api/client';
import { EmptyState, Segmented, Skeleton } from '../../components/ui';
import { cn } from '../../utils/cn';
import { formatDuration, formatMoney } from '../../utils/format';
import { useDebounce } from '../../hooks';
import { useServices } from '../services/api';
import { useProducts } from './api';

/**
 * Services and products to add to the cart. The search box also works with
 * USB/Bluetooth barcode scanners: they type the code and press Enter.
 */
export function Catalog({ onAddService, onAddProduct, inCart }) {
  const [tab, setTab] = useState('services');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const debounced = useDebounce(search.trim(), 200);
  const inputRef = useRef(null);
  const servicesQuery = useServices({ status: 'active' });
  const products = useProducts({ status: 'active', retail: true, search: debounced, limit: 100 }, { enabled: tab === 'products' || Boolean(debounced) });

  const serviceList = useMemo(
    () => (servicesQuery.data || []).filter((s) => (!category || s.categoryName === category) && (!debounced || s.name.toLowerCase().includes(debounced.toLowerCase()))),
    [servicesQuery.data, category, debounced],
  );
  const categories = useMemo(() => [...new Set((servicesQuery.data || []).map((s) => s.categoryName))], [servicesQuery.data]);
  const productList = products.data?.data || [];

  const onKeyDown = async (e) => {
    if (e.key !== 'Enter' || !search.trim()) return;
    e.preventDefault();
    const code = search.trim();
    const exact = (p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase();
    // Scanners type faster than the search debounce, so look the code up
    // directly instead of relying on the list currently on screen.
    let match = productList.find(exact);
    if (!match) {
      try {
        const res = await http.get('/products', { search: code, status: 'active', retail: true, limit: 10 });
        match = res.data.find(exact);
      } catch {
        // Network errors surface elsewhere; fall through to the service search.
      }
    }
    if (match) {
      onAddProduct(match);
      setSearch('');
      return;
    }
    const term = code.toLowerCase();
    const services = (servicesQuery.data || []).filter((s) => (!category || s.categoryName === category) && s.name.toLowerCase().includes(term));
    if (tab === 'services' && services.length === 1) {
      onAddService(services[0]);
      setSearch('');
    } else if (tab === 'products') {
      toast.error(`No active product with barcode or SKU "${code}"`);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <Segmented
          options={[
            { value: 'services', label: 'Services' },
            { value: 'products', label: 'Products' },
          ]}
          value={tab}
          onChange={(v) => {
            setTab(v);
            setCategory('');
          }}
        />
        <div className="relative flex-1">
          <ScanBarcode className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={tab === 'services' ? 'Search services…' : 'Search or scan barcode / SKU…'}
            aria-label="Search catalog or scan barcode"
            className="h-10 w-full rounded-xl border border-line bg-surface pr-3 pl-9 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none"
          />
        </div>
      </div>

      {tab === 'services' && categories.length ? (
        <div className="scrollbar-thin flex gap-2 overflow-x-auto border-b border-line px-4 py-2.5">
          {['', ...categories].map((c) => (
            <button
              key={c || 'all'}
              type="button"
              onClick={() => setCategory(c)}
              className={cn('shrink-0 rounded-full border px-3 py-1 text-xs font-medium', category === c ? 'border-brand-500/50 bg-brand-500/10 text-fg' : 'border-line text-muted hover:text-fg')}
            >
              {c || 'All'}
            </button>
          ))}
        </div>
      ) : null}

      <div className="scrollbar-thin flex-1 overflow-y-auto p-4">
        {tab === 'services' ? (
          servicesQuery.isPending ? (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
          ) : serviceList.length ? (
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
              {serviceList.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onAddService(s)}
                  className="group flex min-h-24 flex-col justify-between rounded-2xl border border-line bg-surface p-3.5 text-left transition-all hover:-translate-y-0.5 hover:border-brand-500/50 hover:shadow-lg active:translate-y-0"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-fg">{s.name}</span>
                    <Scissors className="size-3.5 shrink-0 text-muted group-hover:text-accent" aria-hidden />
                  </span>
                  <span className="mt-2 flex items-end justify-between gap-2">
                    <span className="text-xs text-muted">{formatDuration(s.durationMinutes)}</span>
                    <span className="text-sm font-semibold text-accent">{formatMoney(s.price)}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState icon={Scissors} title="No services found" />
          )
        ) : products.isPending ? (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{Array.from({ length: 9 }).map((_, i) => <Skeleton key={i} className="h-24" />)}</div>
        ) : productList.length ? (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
            {productList.map((p) => {
              const available = p.quantity - (inCart[p.id] || 0);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={available <= 0}
                  onClick={() => onAddProduct(p)}
                  className="group flex min-h-24 flex-col justify-between rounded-2xl border border-line bg-surface p-3.5 text-left transition-all enabled:hover:-translate-y-0.5 enabled:hover:border-brand-500/50 enabled:hover:shadow-lg disabled:opacity-45"
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-fg">{p.name}</span>
                    <Package className="size-3.5 shrink-0 text-muted group-hover:text-accent" aria-hidden />
                  </span>
                  <span className="mt-2 flex items-end justify-between gap-2">
                    <span className={cn('text-xs', available <= 0 ? 'text-danger' : p.isLowStock ? 'text-warning' : 'text-muted')}>
                      {available <= 0 ? 'Out of stock' : `${available} in stock`}
                    </span>
                    <span className="text-sm font-semibold text-accent">{formatMoney(p.sellingPrice)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <EmptyState icon={Package} title="No products found" description="Only active retail products appear here." />
        )}
      </div>
    </div>
  );
}
