import { useEffect, useMemo, useReducer, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CalendarCheck, Gift, History, Loader2, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react';
import { Badge, Button, ButtonLink, Card, Drawer, EmptyState, Input, Segmented, Textarea } from '../../components/ui';
import { http } from '../../api/client';
import { cn } from '../../utils/cn';
import { formatMoney } from '../../utils/format';
import { useDebounce, useDocumentTitle, useMediaQuery, usePermission } from '../../hooks';
import { useAuthStore } from '../../store/authStore';
import { CustomerPicker } from '../customers/CustomerPicker';
import { useEmployeeOptions } from '../services/api';
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
      return { ...state, items: [...state.items, { key: nextKey(), type: 'service', serviceId: action.service.id, name: action.service.name, price: action.service.price, employeeId: action.employeeId || null, quantity: 1 }] };
    case 'addProduct': {
      const existing = state.items.find((i) => i.type === 'product' && i.productId === action.product.id);
      if (existing) {
        return { ...state, items: state.items.map((i) => (i === existing ? { ...i, quantity: Math.min(i.quantity + 1, action.product.quantity) } : i)) };
      }
      return { ...state, items: [...state.items, { key: nextKey(), type: 'product', productId: action.product.id, name: action.product.name, price: action.product.sellingPrice, stock: action.product.quantity, employeeId: null, quantity: 1 }] };
    }
    case 'quantity':
      return { ...state, items: state.items.map((i) => (i.key === action.key ? { ...i, quantity: Math.max(1, Math.min(action.quantity, i.stock ?? 20)) } : i)) };
    case 'employee':
      return { ...state, items: state.items.map((i) => (i.key === action.key ? { ...i, employeeId: action.employeeId } : i)) };
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

function toPayload(cart) {
  return {
    customerId: cart.customer?.id,
    appointmentId: cart.appointment?.id,
    items: cart.items.map((i) => (i.type === 'service'
      ? { type: 'service', serviceId: i.serviceId, employeeId: i.employeeId || undefined, quantity: i.quantity }
      : { type: 'product', productId: i.productId, employeeId: i.employeeId || undefined, quantity: i.quantity })),
    discount: cart.discount.type === 'none' || !Number(cart.discount.value) ? { type: 'none', value: 0 } : { type: cart.discount.type, value: Number(cart.discount.value) },
    loyaltyPoints: Number(cart.loyaltyPoints) || 0,
    notes: cart.notes || undefined,
  };
}

function CartPanel({ cart, dispatch, employees, quote, onCharge, onClose }) {
  const q = quote.data;
  const missingStaff = cart.items.some((i) => i.type === 'service' && !i.employeeId);
  const loyalty = q?.loyalty;

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Current sale</h2>
          <div className="flex items-center gap-1">
            {cart.items.length ? <Button size="xs" variant="ghost" icon={Trash2} onClick={() => dispatch({ type: 'reset' })}>Clear</Button> : null}
            {onClose ? <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-muted" aria-label="Close cart"><X className="size-4" /></button> : null}
          </div>
        </div>
        {cart.appointment ? (
          <Badge tone="gold"><CalendarCheck className="size-3" />Checking out {cart.appointment.code}</Badge>
        ) : null}
        <CustomerPicker label="" value={cart.customer} onChange={(customer) => dispatch({ type: 'customer', customer })} />
        {!cart.customer ? <p className="text-xs text-muted">No customer selected — this will be a walk-in sale (paid in full, no loyalty points).</p> : null}
      </div>

      <div className="scrollbar-thin flex-1 overflow-y-auto">
        {!cart.items.length ? (
          <EmptyState icon={ShoppingBag} title="Cart is empty" description="Tap a service or product to add it." className="py-10" />
        ) : (
          <ul className="divide-y divide-line">
            {cart.items.map((item, index) => {
              // Quote lines follow the cart order; ignore a stale quote of a different cart.
              const line = q?.lines?.length === cart.items.length ? q.lines[index] : null;
              return (
                <li key={item.key} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted">{formatMoney(item.price)}{item.type === 'product' ? ` × ${item.quantity}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{formatMoney(line?.lineTotal ?? item.price * item.quantity)}</span>
                      <button type="button" onClick={() => dispatch({ type: 'remove', key: item.key })} className="rounded-md p-1 text-muted hover:bg-red-500/10 hover:text-danger" aria-label={`Remove ${item.name}`}>
                        <X className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    {item.type === 'service' ? (
                      <select
                        aria-label={`Staff for ${item.name}`}
                        value={item.employeeId || ''}
                        onChange={(e) => dispatch({ type: 'employee', key: item.key, employeeId: Number(e.target.value) || null })}
                        className={cn('h-8 flex-1 rounded-lg border bg-surface px-2 text-xs', item.employeeId ? 'border-line' : 'border-amber-500/60 text-warning')}
                      >
                        <option value="">Who performed it?</option>
                        {employees.map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
                      </select>
                    ) : (
                      <div className="flex items-center rounded-lg border border-line">
                        <button type="button" className="p-1.5 text-muted hover:text-fg" onClick={() => dispatch({ type: 'quantity', key: item.key, quantity: item.quantity - 1 })} aria-label="Decrease quantity"><Minus className="size-3.5" /></button>
                        <span className="w-8 text-center text-sm tabular-nums">{item.quantity}</span>
                        <button type="button" className="p-1.5 text-muted hover:text-fg" disabled={item.quantity >= item.stock} onClick={() => dispatch({ type: 'quantity', key: item.key, quantity: item.quantity + 1 })} aria-label="Increase quantity"><Plus className="size-3.5" /></button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
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
          </div>

          {loyalty?.enabled && loyalty.balance > 0 ? (
            <div className="rounded-xl border border-gold-500/25 bg-gold-500/5 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-medium"><Gift className="size-4 text-accent" />{loyalty.balance} points</span>
                <span className="text-xs text-muted">+{loyalty.pointsToEarn} this sale</span>
              </div>
              {loyalty.maxRedeemable >= loyalty.minRedeemPoints ? (
                <div className="mt-2 flex items-center gap-2">
                  <Input aria-label="Points to redeem" type="number" min="0" max={loyalty.maxRedeemable} className="flex-1" value={cart.loyaltyPoints} onChange={(e) => dispatch({ type: 'loyalty', points: e.target.value })} placeholder={`Redeem up to ${loyalty.maxRedeemable}`} />
                  <Button size="sm" variant="secondary" onClick={() => dispatch({ type: 'loyalty', points: String(loyalty.maxRedeemable) })}>Max</Button>
                </div>
              ) : (
                <p className="mt-1 text-xs text-muted">{loyalty.minRedeemPoints} points needed to redeem.</p>
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
          <Textarea aria-label="Sale notes" rows={1} compact placeholder="Notes (optional)" value={cart.notes} onChange={(e) => dispatch({ type: 'notes', notes: e.target.value })} />
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
                  .map((s) => ({ key: nextKey(), type: 'service', serviceId: s.id, name: s.name, price: s.price, employeeId: checkout.employeeId, quantity: 1 })),
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

  const defaultEmployee = () => {
    const last = [...cart.items].reverse().find((i) => i.type === 'service' && i.employeeId);
    return last?.employeeId || (employees.some((e) => e.id === ownEmployeeId) ? ownEmployeeId : null);
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
        {can('sales.view') ? (
          <ButtonLink to="/pos/sales" variant="secondary" size="sm" icon={History}>Sales history</ButtonLink>
        ) : null}
      </div>
      <div className="grid lg:min-h-0 lg:flex-1 lg:grid-cols-[1fr_24rem] xl:grid-cols-[1fr_27rem]">
        <div className="min-h-[60vh] min-w-0 lg:h-full">
          <Catalog
            inCart={inCart}
            onAddService={(service) => {
              dispatch({ type: 'addService', service, employeeId: defaultEmployee() });
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
            className="fixed inset-x-4 bottom-20 z-30 flex items-center justify-between rounded-2xl bg-gold-500 px-5 py-3.5 font-semibold text-ink-950 shadow-xl shadow-black/30"
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
