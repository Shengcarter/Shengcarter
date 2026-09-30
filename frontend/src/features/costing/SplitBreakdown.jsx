import { AlertTriangle, CircleCheck } from 'lucide-react';
import { Badge } from '../../components/ui';
import { ShareBar } from '../../components/charts/Charts';
import { cn } from '../../utils/cn';
import { formatMoney, formatDateTime } from '../../utils/format';

/** Zero or negative margin: products cost as much as, or more than, the price. */
export function MarginBadge({ status, reviewStatus }) {
  if (!status || status === 'positive') return null;
  const reviewed = reviewStatus === 'reviewed';
  return (
    <Badge tone={reviewed ? 'neutral' : status === 'negative' ? 'danger' : 'warning'}>
      {reviewed ? <CircleCheck className="size-3" aria-hidden /> : <AlertTriangle className="size-3" aria-hidden />}
      {status === 'negative' ? 'Negative margin' : 'Zero margin'}
      {reviewed ? ' · reviewed' : reviewStatus === 'pending' ? ' · needs review' : ''}
    </Badge>
  );
}

/**
 * Where the money from one service went, in the order it is worked out:
 * price → products used → operations → staff (shared equally) → salon profit.
 * The bar uses one fixed colour per part, the same on every screen.
 *
 * split: { price, productCost, operations, staffPool, salonProfit, rates: { operations, employee|staff, profit } }
 * staff: [{ name, amount }] shares of the staff pool
 */
export function SplitBreakdown({ split, staff = [], className, compact = false }) {
  if (!split) return null;
  const rates = split.rates || { operations: split.operationsRate, employee: split.staffRate, profit: split.profitRate };
  const staffRate = rates.employee ?? rates.staff;
  const afterProducts = split.amountAfterProducts ?? split.price - split.productCost;
  const loss = afterProducts < 0;
  const rows = [
    { key: 'price', label: 'Customer paid', value: split.price, strong: true },
    { key: 'productCost', label: 'Products used', value: -split.productCost },
    { key: 'after', label: 'Left after products', value: afterProducts, muted: true },
    { key: 'operations', label: `Operations (${rates.operations}%)`, value: -split.operations },
    { key: 'staffPool', label: `Staff (${staffRate}% of the rest)`, value: split.staffPool },
    { key: 'salonProfit', label: loss ? 'Salon loss' : `Salon profit (${rates.profit}% of the rest)`, value: split.salonProfit, strong: true },
  ];

  return (
    <div className={cn('space-y-3', className)}>
      {!loss && split.price > 0 && !compact ? (
        <ShareBar
          formatValue={formatMoney}
          segments={[
            { key: 'productCost', label: 'Products used', value: split.productCost },
            { key: 'operations', label: 'Operations', value: split.operations },
            { key: 'staffPool', label: 'Staff', value: split.staffPool },
            { key: 'salonProfit', label: 'Salon profit', value: split.salonProfit },
          ]}
        />
      ) : null}
      {compact || loss ? (
        <dl className="space-y-1 text-sm">
          {rows.map((r) => (
            <div key={r.key} className={cn('flex justify-between gap-3', r.muted && 'text-muted')}>
              <dt className={cn(r.strong ? 'font-medium' : 'text-muted')}>{r.label}</dt>
              <dd className={cn('tabular-nums', r.strong && 'font-semibold', r.key === 'salonProfit' && loss && 'text-danger')}>
                {r.value < 0 && r.key !== 'salonProfit' && r.key !== 'after' ? `−${formatMoney(-r.value)}` : formatMoney(r.value)}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {staff.length > 1 ? (
        <p className="text-xs text-muted">
          Staff share, equally: {staff.map((s) => `${s.name.split(' ')[0]} ${formatMoney(s.amount)}`).join(' · ')}
        </p>
      ) : null}
      {loss ? (
        <p className="flex items-start gap-1.5 text-xs text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The products cost more than the price, so staff and operations get nothing and the salon carries a {formatMoney(-split.salonProfit)} loss.
        </p>
      ) : null}
    </div>
  );
}

/** Earlier figures of a corrected service, newest first. */
export function RevisionList({ revisions }) {
  if (!revisions?.length) return null;
  return (
    <ol className="space-y-2">
      {revisions.map((r) => (
        <li key={r.revision} className="rounded-lg border border-line px-3 py-2 text-xs">
          <p className="font-medium text-fg">Correction {r.revision}: {r.reason}</p>
          <p className="text-muted">{r.changedBy || 'Someone'} · {formatDateTime(r.changedAt)}</p>
          <p className="mt-1 text-muted tabular-nums">
            Products {formatMoney(r.before.productCost)} → {formatMoney(r.after.productCost)} · Staff {formatMoney(r.before.staffPool)} → {formatMoney(r.after.staffPool)} · Salon {formatMoney(r.before.salonProfit)} → {formatMoney(r.after.salonProfit)}
            {r.before.price !== r.after.price ? ` · Price ${formatMoney(r.before.price)} → ${formatMoney(r.after.price)}` : ''}
          </p>
        </li>
      ))}
    </ol>
  );
}
