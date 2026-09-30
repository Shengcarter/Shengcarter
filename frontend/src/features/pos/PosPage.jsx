import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, ArrowDown, CalendarCheck, ChevronDown, FileUp, Gift, History, Loader2, Minus, NotebookPen, Package, Plus, ShoppingBag, Trash2, Users, X } from 'lucide-react';
import { Badge, Button, ButtonLink, Card, Drawer, EmptyState, IconButton, Input, Segmented, Textarea } from '../../components/ui';
import { http } from '../../api/client';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../utils/format';
import { useDebounce, useDocumentTitle, useMediaQuery, usePermission } from '../../hooks';
import { useAuthStore } from '../../store/authStore';
import { CustomerPicker } from '../customers/CustomerPicker';
import { useEmployeeOptions } from '../services/api';
import { ProductsUsedEditor, cleanUsage } from '../costing/ProductsUsedEditor';
import { MarginBadge, SplitBreakdown } from '../costing/SplitBreakdown';
import { useUsableProducts } from '../costing/api';
import { Catalog } from './Catalog';
import { PaymentModal } from './PaymentModal';
import { ReceiptModal } from './ReceiptModal';
import { salesApi } from './api';

const EMPTY_CART = { customer: null, appointment: null, items: [], discount: { type: 'none', value: '' }, loyaltyPoints: '', notes: '' };
let keySeq = 0;
const nextKey = () => `line-${(keySeq += 1)}`;

function cartReducer(state, action) {
  switch (action.type) {
    case 'customer':
      return { ...state, customer: action.customer, loyaltyPoints: '' };
    case 'addService':
      return { ...state, items: [...state.items, serviceLine(action.service, action.employeeIds || [])] };
    case 'addProduct': {
      const existing = state.items.find((i) => i.type === 'product' && i.productId === action.product.id);
      if (existing) {
        return { ...state, items: state.items.map((i) => (i === existing ? { ...i, quantity: Math.min(i.quantity + 1, action.product.quantity) } : i)) };
      }
      return { ...state, items: [...state.items, { key: nextKey(), type: 'product', productId: action.product.id, name: action.product.name, price: action.product.sellingPrice, stock: action.product.quantity, employeeId: null, quantity: 1 }] };
    }
    case 'quantity':
      return { ...state, items: state.items.map((i) => (i.key === action.key ? { ...i, quantity: Math.max(1, Math.min(action.quantity, i.stock ?? 20)) } : i)) };
    case 'staff':
      return { ...state, items: state.items.map((i) => (i.key === action.key ? { ...i, employeeIds: action.employeeIds } : i)) };
    case 'consumption':
      return { ...state, items: state.items.map((i) => (i.key === action.key ? { ...i, consumption: action.consumption, usageSource: 'edited' } : i)) };
    case 'price':
      return { ...state, items: state.items.map((i) => (i.key === action.key ? { ...i, price: action.price } : i)) };
    case 'remove':
      return { ...state, items: state.items.filter((i) => i.key !== action.key) };
    case 'discount':
      return { ...state, discount: { ...state.discount, ...action.discount } };
    case 'loyalty':
      return { ...state, loyaltyPoints: action.points };
    case 'notes':
      return { ...state, notes: action.notes };
    case 'load':
      return { ...EMPTY_CART, ...action.cart };
    case 'reset':
      return EMPTY_CART;
    default:
      return state;
  }
}

/**
 * A service line starts with the products the service normally uses (its
 * recipe), or what the stylist recorded on the appointment; the cashier
 * confirms or changes them, and the money split uses what is sent.
 */
function serviceLine(service, employeeIds, usage = null) {
  const products = usage ? usage.products : service.recipe || [];
  return {
    key: nextKey(),
    type: 'service',
    serviceId: service.id,
    name: service.name,
    price: service.price,
    priceRange: service.maxPrice ? { min: service.price, max: service.maxPrice } : null,
    employeeIds,
    quantity: 1,
    consumption: products.map((p) => ({ productId: p.productId, quantity: String(p.quantity), name: p.name, unit: p.unit })),
    usageSource: usage?.source === 'recorded' ? `Recorded by ${usage.recordedBy || 'the stylist'}` : products.length ? 'Usual amounts for this service' : null,
  };
}

function toPayload(cart) {
  return {
    customerId: cart.customer?.id,
    appointmentId: cart.appointment?.id,
    items: cart.items.map((i) => (i.type === 'service'
      ? {
          type: 'service', serviceId: i.serviceId, employeeIds: i.employeeIds, quantity: i.quantity, consumption: cleanUsage(i.consumption),
          ...(i.priceRange && Number(i.price) !== Number(i.priceRange.min) ? { price: Number(i.price) || i.priceRange.min } : {}),
        }
      : { type: 'product', productId: i.productId, employeeId: i.employeeId || undefined, quantity: i.quantity })),
    discount: cart.discount.type === 'none' || !Number(cart.discount.value) ? { type: 'none', value: 0 } : { type: cart.discount.type, value: Number(cart.discount.value) },
    loyaltyPoints: Number(cart.loyaltyPoints) || 0,
    notes: cart.notes || undefined,
  };
}

/**
 * Keeps every cart line findable on short screens: shows the newest line when
 * one is added (and keeps it in view while the totals below load), and counts
 * the lines hidden below the visible area.
 */
function useCartScroll(itemCount) {
  const listRef = useRef(null);
  const previousCount = useRef(itemCount);
  const pinnedToEnd = useRef(true);
  const [hiddenBelow, setHiddenBelow] = useState(0);

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const visibleBottom = list.scrollTop + list.clientHeight;
    const lines = [...list.querySelectorAll('[data-cart-line]')];
    // A line counts until it is fully visible (2px tolerance for rounding).
    setHiddenBelow(lines.filter((el) => el.offsetTop + el.offsetHeight > visibleBottom + 2).length);
  }, []);

  const scrollToEnd = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    pinnedToEnd.current = true;
    list.scrollTop = list.scrollHeight;
    measure();
  }, [measure]);

  const onScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    pinnedToEnd.current = list.scrollHeight - list.scrollTop - list.clientHeight < 4;
    measure();
  }, [measure]);

  useEffect(() => {
    if (itemCount > previousCount.current) scrollToEnd();
    else measure();
    previousCount.current = itemCount;
  }, [itemCount, measure, scrollToEnd]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;
    // The list shrinks when the discount, loyalty and totals rows appear.
    const observer = new ResizeObserver(() => (pinnedToEnd.current ? scrollToEnd() : measure()));
    observer.observe(list);
    return () => observer.disconnect();
  }, [measure, scrollToEnd]);

  return { listRef, hiddenBelow, onScroll, showAll: scrollToEnd };
}

/**
 * Who performed a service: one person, or several who did it together (the
 * commission is then shared equally). Chips for the chosen people, and a
 * list to add someone.
 */
function StaffPicker({ item, employees, onChange }) {
  const selected = item.employeeIds.map((id) => employees.find((e) => e.id === id)).filter(Boolean);
  const options = employees.filter((e) => !item.employeeIds.includes(e.id));
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
      {selected.map((e) => (
        <span key={e.id} className="inline-flex h-7 items-center gap-0.5 rounded-lg bg-brand-500/10 pr-0.5 pl-2 text-xs font-medium text-accent">
          {e.fullName.split(' ')[0]}
          <button type="button" aria-label={`Remove ${e.fullName} from ${item.name}`} onClick={() => onChange(item.employeeIds.filter((id) => id !== e.id))} className="rounded p-0.5 hover:bg-brand-500/20">
            <X className="size-3" />
          </button>
        </span>
      ))}
      {selected.length < 6 && options.length ? (
        <select
          aria-label={selected.length ? `Add another person to ${item.name}` : `Staff for ${item.name}`}
          value=""
          onChange={(e) => {
            const id = Number(e.target.value);
            if (id) onChange([...item.employeeIds, id]);
          }}
          className={cn('h-7 min-w-24 flex-1 rounded-lg border bg-surface px-2 text-xs', selected.length ? 'border-line text-muted' : 'border-amber-500/60 text-warning')}
        >
          <option value="">{selected.length ? '+ Add person' : 'Who performed it?'}</option>
          {options.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
        </select>
      ) : null}
    </div>
  );
}

/**
 * Products used on a service line, with a margin warning; people who see
 * costs also get the live money split worked out by the server.
 */
function ServiceUsage({ item, line, dispatch, products, employees, showCosts }) {
  const [open, setOpen] = useState(false);
  const count = cleanUsage(item.consumption).length;
  const cost = line?.split?.productCost;
  const flagged = line?.marginStatus && line.marginStatus !== 'positive';
  const names = item.employeeIds.map((id) => employees.find((e) => e.id === id)?.fullName || 'Staff');
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full min-w-0 items-center gap-1.5 text-left text-[11px] text-muted hover:text-fg">
        <Package className="size-3 shrink-0" aria-hidden />
        <span className="shrink-0">{count ? `${count} product${count === 1 ? '' : 's'} used` : 'No products used'}{showCosts && cost ? ` · ${formatMoney(cost)}` : ''}</span>
        {item.usageSource && !flagged ? <span className="truncate">· {item.usageSource}</span> : null}
        {flagged ? <MarginBadge status={line.marginStatus} /> : null}
        <ChevronDown className={cn('ml-auto size-3.5 shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open ? (
        <div className="mt-2 space-y-3 rounded-xl border border-line p-2.5">
          <ProductsUsedEditor
            value={item.consumption}
            onChange={(consumption) => dispatch({ type: 'consumption', key: item.key, consumption })}
            products={products}
            showCosts={showCosts}
            idPrefix={item.key}
            emptyText="Record the hair, jelly, gel and other products used, or leave empty if none."
          />
          {showCosts && line?.split ? (
            <SplitBreakdown compact split={line.split} staff={line.split.staffShares.map((amount, i) => ({ name: names[i] || 'Staff', amount }))} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CartPanel({ cart, dispatch, employees, products, showCosts, quote, onCharge, onClose }) {
  const q = quote.data;
  const missingStaff = cart.items.some((i) => i.type === 'service' && !i.employeeIds.length);
  const loyalty = q?.loyalty;
  const { listRef, hiddenBelow, onScroll, showAll } = useCartScroll(cart.items.length);
  const itemCount = cart.items.reduce((n, i) => n + i.quantity, 0);
  // The notes box opens on demand so the item list keeps more room.
  const [notesOpen, setNotesOpen] = useState(false);
  const showNotes = notesOpen || Boolean(cart.notes);
  useEffect(() => {
    if (!cart.items.length) setNotesOpen(false);
  }, [cart.items.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 font-semibold">
            Current sale
            {itemCount ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span> : null}
          </h2>
          <div className="flex items-center gap-1">
            {cart.items.length ? <Button size="xs" variant="ghost" icon={Trash2} onClick={() => dispatch({ type: 'reset' })}>Clear</Button> : null}
            {onClose ? <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted" aria-label="Close cart"><X className="size-4" /></button> : null}
          </div>
        </div>
        {cart.appointment ? (
          <Badge tone="brand"><CalendarCheck className="size-3" />Checking out {cart.appointment.code}</Badge>
        ) : null}
        <CustomerPicker label="" value={cart.customer} onChange={(customer) => dispatch({ type: 'customer', customer })} />
        {!cart.customer ? <p className="text-xs text-muted">No customer selected — this will be a walk-in sale (paid in full, no loyalty points).</p> : null}
      </div>

      <div className="relative flex min-h-24 flex-1 flex-col">
        <div ref={listRef} onScroll={onScroll} className="scrollbar-thin relative min-h-0 flex-1 overflow-y-auto">
          {!cart.items.length ? (
            <EmptyState icon={ShoppingBag} title="Cart is empty" description="Tap a service or product to add it." className="py-10" />
          ) : (
            <ul className="divide-y divide-line">
              {cart.items.map((item, index) => {
                // Quote lines follow the cart order; ignore a stale quote of a different cart.
                const line = q?.lines?.length === cart.items.length ? q.lines[index] : null;
                return (
                  <li key={item.key} data-cart-line className="px-4 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-medium">{item.name}</p>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-sm font-semibold">{formatMoney(line?.lineTotal ?? item.price * item.quantity)}</span>
                        <button type="button" onClick={() => dispatch({ type: 'remove', key: item.key })} className="rounded-md p-1 text-muted hover:bg-red-500/10 hover:text-danger" aria-label={`Remove ${item.name}`}>
                          <X className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      {item.priceRange ? (
                        <input
                          aria-label={`Price for ${item.name} (${formatMoney(item.priceRange.min)} to ${formatMoney(item.priceRange.max)})`}
                          title={`${formatMoney(item.priceRange.min)} – ${formatMoney(item.priceRange.max)}`}
                          type="number"
                          min={item.priceRange.min}
                          max={item.priceRange.max}
                          step="any"
                          value={item.price}
                          onChange={(e) => dispatch({ type: 'price', key: item.key, price: e.target.value })}
                          className="h-7 w-24 shrink-0 rounded-lg border border-line bg-surface px-2 text-xs tabular-nums"
                        />
                      ) : (
                        <span className="shrink-0 text-xs text-muted tabular-nums">{formatMoney(item.price)}{item.type === 'product' ? ` × ${item.quantity}` : ''}</span>
                      )}
                      {item.type === 'service' ? (
                        <StaffPicker item={item} employees={employees} onChange={(employeeIds) => dispatch({ type: 'staff', key: item.key, employeeIds })} />
                      ) : (
                        <div className="ml-auto flex items-center rounded-lg border border-line">
                          <button type="button" className="p-1.5 text-muted hover:text-fg" onClick={() => dispatch({ type: 'quantity', key: item.key, quantity: item.quantity - 1 })} aria-label="Decrease quantity"><Minus className="size-3.5" /></button>
                          <span className="w-8 text-center text-sm tabular-nums">{item.quantity}</span>
                          <button type="button" className="p-1.5 text-muted hover:text-fg" disabled={item.quantity >= item.stock} onClick={() => dispatch({ type: 'quantity', key: item.key, quantity: item.quantity + 1 })} aria-label="Increase quantity"><Plus className="size-3.5" /></button>
                        </div>
                      )}
                    </div>
                    {item.type === 'service' && item.employeeIds.length > 1 ? (
                      <p className="mt-1 flex items-center gap-1 text-[11px] text-muted"><Users className="size-3" aria-hidden />Done together · staff share split equally between {item.employeeIds.length}</p>
                    ) : null}
                    {item.type === 'service' ? (
                      <ServiceUsage item={item} line={line} dispatch={dispatch} products={products} employees={employees} showCosts={showCosts} />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {/* Outside the scrolling content so showing it never changes the list height. */}
        {hiddenBelow ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-surface via-surface/80 to-transparent pt-6 pb-2">
            <button type="button" onClick={showAll} className="pointer-events-auto flex items-center gap-1 rounded-full bg-brand-500 px-3 py-1 text-xs font-semibold text-black shadow-lg">
              <ArrowDown className="size-3.5" aria-hidden />
              {hiddenBelow} more {hiddenBelow === 1 ? 'item' : 'items'}
            </button>
          </div>
        ) : null}
      </div>

      {cart.items.length ? (
        <div className="space-y-3 border-t border-line p-4">
          <div className="flex items-center gap-2">
            <Segmented
              size="sm"
              options={[
                { value: 'none', label: 'No discount' },
                { value: 'amount', label: 'Amount' },
                { value: 'percentage', label: '%' },
              ]}
              value={cart.discount.type}
              onChange={(type) => dispatch({ type: 'discount', discount: { type, value: type === 'none' ? '' : cart.discount.value } })}
            />
            {cart.discount.type !== 'none' ? (
              <Input
                aria-label="Discount value"
                className="flex-1"
                type="number"
                min="0"
                max={cart.discount.type === 'percentage' ? 100 : undefined}
                value={cart.discount.value}
                onChange={(e) => dispatch({ type: 'discount', discount: { value: e.target.value } })}
                placeholder={cart.discount.type === 'percentage' ? '10' : '5000'}
              />
            ) : null}
            {!showNotes ? <IconButton icon={NotebookPen} label="Add a note to this sale" size="sm" className="ml-auto" onClick={() => setNotesOpen(true)} /> : null}
          </div>

          {loyalty?.enabled && loyalty.balance > 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-brand-500/25 bg-brand-500/5 px-3 py-2">
              <span className="flex shrink-0 flex-col text-sm leading-tight">
                <span className="flex items-center gap-1.5 font-medium"><Gift className="size-4 text-accent" />{loyalty.balance} pts</span>
                <span className="text-xs text-muted">+{loyalty.pointsToEarn} this sale</span>
              </span>
              {loyalty.maxRedeemable >= loyalty.minRedeemPoints ? (
                <>
                  <Input aria-label="Points to redeem" type="number" min="0" max={loyalty.maxRedeemable} className="min-w-0 flex-1" value={cart.loyaltyPoints} onChange={(e) => dispatch({ type: 'loyalty', points: e.target.value })} placeholder={`Redeem up to ${loyalty.maxRedeemable}`} />
                  <Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'loyalty', points: String(loyalty.maxRedeemable) })}>Max</Button>
                </>
              ) : (
                <p className="text-xs text-muted">{loyalty.minRedeemPoints} points needed to redeem.</p>
              )}
            </div>
          ) : null}

          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{q ? formatMoney(q.subtotal) : '—'}</dd></div>
            {q?.discountAmount ? <div className="flex justify-between"><dt className="text-muted">Discount</dt><dd className="text-success">−{formatMoney(q.discountAmount)}</dd></div> : null}
            {q?.loyaltyDiscount ? <div className="flex justify-between"><dt className="text-muted">Loyalty</dt><dd className="text-success">−{formatMoney(q.loyaltyDiscount)}</dd></div> : null}
            {q && q.taxMode !== 'none' && q.taxRate > 0 ? (
              <div className="flex justify-between"><dt className="text-muted">Tax {q.taxRate}%{q.taxMode === 'inclusive' ? ' (incl.)' : ''}</dt><dd>{formatMoney(q.taxAmount)}</dd></div>
            ) : null}
            <div className="flex items-center justify-between pt-1 text-lg font-semibold">
              <dt>Total</dt>
              <dd className="flex items-center gap-2">{quote.isFetching ? <Loader2 className="size-4 animate-spin text-muted" /> : null}{q ? formatMoney(q.total) : '—'}</dd>
            </div>
          </dl>
          {quote.isError ? <p className="flex items-start gap-2 text-sm text-danger" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{quote.error.errors?.[0]?.message || quote.error.message}</p> : null}
          {showNotes ? (
            <Textarea aria-label="Sale notes" rows={1} compact autoFocus={notesOpen && !cart.notes} placeholder="Notes (optional)" value={cart.notes} onChange={(e) => dispatch({ type: 'notes', notes: e.target.value })} onBlur={() => setNotesOpen(false)} />
          ) : null}
          <Button size="lg" className="w-full" disabled={!q || quote.isError || quote.isFetching || missingStaff} onClick={onCharge}>
            {missingStaff ? 'Choose staff for each service' : q ? `Charge ${formatMoney(q.total)}` : 'Calculating…'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default function PosPage() {
  useDocumentTitle('Point of sale');
  const can = usePermission();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const ownEmployeeId = useAuthStore((s) => s.user?.employeeId);
  const [cart, dispatch] = useReducer(cartReducer, EMPTY_CART);
  const [cartOpen, setCartOpen] = useState(false);
  const [paying, setPaying] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [completedSale, setCompletedSale] = useState(null);
  const employeesQuery = useEmployeeOptions({ includeInactive: false });
  const employees = employeesQuery.data || [];
  const usable = useUsableProducts();
  const showCosts = can('reports.financial') || can('sales.correct');

  // Hand-off from an appointment or a customer profile.
  useEffect(() => {
    const appointmentId = Number(params.get('appointment'));
    const customerId = Number(params.get('customer'));
    if (!appointmentId && !customerId) return;
    (async () => {
      try {
        if (appointmentId) {
          const checkout = await salesApi.appointmentCheckout(appointmentId);
          if (checkout.billedSale) {
            toast.error(`${checkout.code} was already billed on ${checkout.billedSale.invoiceNumber}`);
          } else {
            const [customer, services] = await Promise.all([
              http.get(`/customers/${checkout.customerId}`).then((r) => r.data),
              http.get('/services', { status: 'active' }).then((r) => r.data),
            ]);
            dispatch({
              type: 'load',
              cart: {
                customer,
                appointment: { id: checkout.id, code: checkout.code },
                items: checkout.serviceIds
                  .map((sid) => services.find((s) => s.id === sid))
                  .filter(Boolean)
                  // Everyone on the appointment performed its services, with the products the
                  // stylist recorded (or the usual ones); the cashier can change a line.
                  .map((s) => serviceLine(s, checkout.employeeIds || [checkout.employeeId], checkout.usage?.find((u) => u.serviceId === s.id))),
              },
            });
          }
        } else if (customerId) {
          dispatch({ type: 'customer', customer: await http.get(`/customers/${customerId}`).then((r) => r.data) });
        }
      } catch (e) {
        toast.error(e.message);
      } finally {
        setParams({}, { replace: true });
      }
    })();
  }, [params, setParams]);

  const payload = useMemo(() => toPayload(cart), [cart]);
  const debouncedPayload = useDebounce(payload, 250);
  const quote = useQuery({
    queryKey: ['sales', 'quote', debouncedPayload],
    queryFn: () => salesApi.quote(debouncedPayload),
    enabled: debouncedPayload.items.length > 0,
    placeholderData: (p) => p,
    retry: false,
    staleTime: 0,
  });

  const inCart = useMemo(() => Object.fromEntries(cart.items.filter((i) => i.type === 'product').map((i) => [i.productId, i.quantity])), [cart.items]);

  // A new service line starts with the staff of the previous one (or the signed-in stylist).
  const defaultStaff = () => {
    const last = [...cart.items].reverse().find((i) => i.type === 'service' && i.employeeIds.length);
    if (last) return [...last.employeeIds];
    return employees.some((e) => e.id === ownEmployeeId) ? [ownEmployeeId] : [];
  };

  const completeSale = async (payments) => {
    setSubmitting(true);
    try {
      const res = await salesApi.create({ ...payload, payments });
      setPaying(false);
      setCartOpen(false);
      setCompletedSale(res.data);
      dispatch({ type: 'reset' });
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      qc.invalidateQueries({ queryKey: ['appointments'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    } catch (error) {
      toast.error(error.errors?.[0]?.message || error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const cartPanel = (
    <CartPanel
      cart={cart}
      dispatch={dispatch}
      employees={employees}
      products={usable.data || []}
      showCosts={showCosts}
      quote={quote}
      onCharge={() => setPaying(true)}
      onClose={isDesktop ? undefined : () => setCartOpen(false)}
    />
  );

  const itemCount = cart.items.reduce((s, i) => s + i.quantity, 0);

  return (
    <div className="-mx-4 -mt-6 sm:-mx-6 lg:-mb-12 lg:flex lg:h-[calc(100dvh-4rem)] lg:flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
        <h1 className="font-display text-2xl font-semibold">Point of sale</h1>
        <div className="flex items-center gap-2">
          {can('sales.import') ? (
            <ButtonLink to="/pos/sales?import=1" variant="ghost" size="sm" icon={FileUp}>Import past sales</ButtonLink>
          ) : null}
          {can('sales.view') ? (
            <ButtonLink to="/pos/sales" variant="secondary" size="sm" icon={History}>Sales history</ButtonLink>
          ) : null}
        </div>
      </div>
      <div className="grid lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_24rem] xl:grid-cols-[1fr_27rem]">
        <div className="min-h-[60vh] min-w-0 lg:h-full">
          <Catalog
            inCart={inCart}
            onAddService={(service) => {
              dispatch({ type: 'addService', service, employeeIds: defaultStaff() });
              if (!isDesktop) toast.success(`${service.name} added`, { duration: 1200 });
            }}
            onAddProduct={(product) => {
              if (product.quantity - (inCart[product.id] || 0) <= 0) {
                toast.error(`${product.name} is out of stock`);
                return;
              }
              dispatch({ type: 'addProduct', product });
              if (!isDesktop) toast.success(`${product.name} added`, { duration: 1200 });
            }}
          />
        </div>
        {isDesktop ? <Card as="aside" className="m-3 ml-0 overflow-hidden lg:h-[calc(100%-1.5rem)]">{cartPanel}</Card> : null}
      </div>

      {!isDesktop ? (
        <>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="fixed inset-x-4 bottom-20 z-30 flex items-center justify-between rounded-2xl bg-brand-500 px-5 py-3.5 font-semibold text-white shadow-xl shadow-black/30"
          >
            <span className="flex items-center gap-2"><ShoppingBag className="size-5" />Cart · {itemCount} item{itemCount === 1 ? '' : 's'}</span>
            <span>{quote.data && cart.items.length ? formatMoney(quote.data.total) : formatMoney(0)}</span>
          </button>
          <Drawer open={cartOpen} onClose={() => setCartOpen(false)} title="Cart" width="max-w-md">
            <div className="-mx-5 -my-5 h-[calc(100dvh-4.5rem)]">{cartPanel}</div>
          </Drawer>
        </>
      ) : null}

      <PaymentModal
        open={paying}
        onClose={() => setPaying(false)}
        total={quote.data?.total || 0}
        canLeaveBalance={Boolean(cart.customer) && Boolean(quote.data?.allowPartial)}
        onConfirm={completeSale}
        submitting={submitting}
      />
      <ReceiptModal sale={completedSale} onClose={() => setCompletedSale(null)} onNewSale={() => setCompletedSale(null)} />
    </div>
  );
}
