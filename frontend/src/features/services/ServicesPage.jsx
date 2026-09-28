import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Layers, Plus, Scissors } from 'lucide-react';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, PageHeader, SearchInput, SkeletonRows } from '../../components/ui';
import { formatDuration, formatMoney } from '../../utils/format';
import { usePermission, useDocumentTitle } from '../../hooks';
import { cn } from '../../utils/cn';
import { useServiceCategories, useServices } from './api';
import { ServiceFormModal } from './ServiceFormModal';
import { CategoriesModal } from './CategoriesModal';

export default function ServicesPage() {
  useDocumentTitle('Services');
  const can = usePermission();
  const manage = can('services.manage');
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState({ search: '', categoryId: '', status: manage ? '' : 'active' });
  const services = useServices(filters);
  const categories = useServiceCategories();
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  // Deep link from global search: /services?service=12
  useEffect(() => {
    const id = Number(searchParams.get('service'));
    if (id && services.data) {
      const found = services.data.find((s) => s.id === id);
      if (found && manage) {
        setEditing(found);
        setFormOpen(true);
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, services.data, manage, setSearchParams]);

  const grouped = useMemo(() => {
    const map = new Map();
    for (const s of services.data || []) {
      if (!map.has(s.categoryName)) map.set(s.categoryName, []);
      map.get(s.categoryName).push(s);
    }
    return [...map.entries()];
  }, [services.data]);

  const open = (service) => {
    if (!manage) return;
    setEditing(service);
    setFormOpen(true);
  };

  return (
    <div>
      <PageHeader
        title="Services"
        description="Your salon menu — prices, durations, commissions and who performs each service."
        actions={
          manage ? (
            <>
              <Button variant="secondary" icon={Layers} onClick={() => setCategoriesOpen(true)}>Categories</Button>
              <Button icon={Plus} onClick={() => open(null)}>New service</Button>
            </>
          ) : null
        }
      />

      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <SearchInput placeholder="Search services…" className="lg:w-72" onChange={(search) => setFilters((f) => ({ ...f, search }))} />
        <div className="scrollbar-thin -mx-4 flex gap-2 overflow-x-auto px-4 lg:mx-0 lg:flex-wrap lg:px-0">
          {[{ id: '', name: 'All' }, ...(categories.data || []).filter((c) => c.serviceCount > 0)].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setFilters((f) => ({ ...f, categoryId: c.id }))}
              className={cn('shrink-0 rounded-full border px-3 py-1.5 text-sm', String(filters.categoryId) === String(c.id) ? 'border-gold-500/50 bg-gold-500/10 text-fg' : 'border-line text-muted hover:text-fg')}
            >
              {c.name}
            </button>
          ))}
        </div>
        {manage ? (
          <select aria-label="Status" className="h-9 rounded-full border border-line bg-surface px-3 text-sm lg:ml-auto" value={filters.status} onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}>
            <option value="">Active & inactive</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        ) : null}
      </div>

      {services.isPending ? (
        <SkeletonRows rows={8} />
      ) : services.isError ? (
        <ErrorState error={services.error} onRetry={services.refetch} />
      ) : !grouped.length ? (
        <Card>
          <EmptyState
            icon={Scissors}
            title="No services found"
            description={filters.search || filters.categoryId ? 'Try another search or category.' : 'Add the services your salon offers.'}
            action={manage && !filters.search ? <Button icon={Plus} onClick={() => open(null)}>New service</Button> : null}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([category, items]) => (
            <section key={category}>
              <h2 className="mb-3 text-xs font-semibold tracking-[0.18em] text-muted uppercase">{category}</h2>
              <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {items.map((s) => (
                  <Card
                    key={s.id}
                    as={manage ? 'button' : 'div'}
                    type={manage ? 'button' : undefined}
                    onClick={() => open(s)}
                    className={cn('flex flex-col p-4 text-left', manage && 'transition-colors hover:border-gold-500/40', !s.isActive && 'opacity-60')}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium text-fg">{s.name}</p>
                        {s.description ? <p className="mt-0.5 line-clamp-2 text-sm text-muted">{s.description}</p> : null}
                      </div>
                      <p className="shrink-0 text-base font-semibold text-accent">{formatMoney(s.price)}</p>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Badge><Clock className="size-3" aria-hidden />{formatDuration(s.durationMinutes)}</Badge>
                      {s.commissionRate !== null ? <Badge tone="gold">{s.commissionRate}% commission</Badge> : null}
                      {!s.isActive ? <Badge tone="danger">Inactive</Badge> : null}
                      <div className="ml-auto flex -space-x-2">
                        {s.employees.slice(0, 4).map((e) => <Avatar key={e.id} name={e.fullName} size="xs" className="ring-2 ring-surface" />)}
                        {s.employees.length > 4 ? <span className="flex size-7 items-center justify-center rounded-full bg-surface-3 text-[10px] ring-2 ring-surface">+{s.employees.length - 4}</span> : null}
                        {!s.employees.length ? <span className="text-xs text-warning">No staff assigned</span> : null}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <ServiceFormModal open={formOpen} onClose={() => setFormOpen(false)} service={editing} />
      <CategoriesModal open={categoriesOpen} onClose={() => setCategoriesOpen(false)} />
    </div>
  );
}
