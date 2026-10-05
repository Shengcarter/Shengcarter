import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Banknote, Calculator, Coins, HandCoins, Package, Sparkles } from 'lucide-react';
import { Badge, Card, CardHeader } from '../../components/ui';
import { ChartCard } from '../../components/charts/ChartCard';
import { ShareBar, StackedColumnChart } from '../../components/charts/Charts';
import { formatDateTime, formatNumber, titleCase } from '../../utils/format';
import { useReport } from './api';
import { bucketLabel } from './periods';
import { Kpis, ReportState, ReportTable, compactMoney, count, money, percent, tableFrom } from './components';

// The same four parts, in the same order and colours, everywhere the split is shown.
const SOURCES = { pos: 'At the till', backdated: 'Recorded later', import: 'Imported' };
const METHODS = { general: 'General formula', band: 'Service rule — fixed amounts', band_general: 'Service rule — general formula band' };

const PARTS = [
  { key: 'productCost', label: 'Products used' },
  { key: 'operations', label: 'Operations' },
  { key: 'staffEarnings', label: 'Staff' },
  { key: 'salonProfit', label: 'Salon profit' },
];

/**
 * Service costing: each service's price, minus the products actually used,
 * split into operations, staff earnings and salon profit — by period, stylist,
 * service and product, with the services whose margin needs a look.
 */
export function CostingReport({ params }) {
  const query = useReport('costing', params);
  const navigate = useNavigate();
  return (
    <ReportState query={query}>
      {(r) => {
        const s = r.summary;
        const g = r.period.groupBy;
        const periodColumns = [
          { key: 'period', header: 'Period', render: (p) => bucketLabel(p.period, g, true) },
          { key: 'services', header: 'Services', align: 'right', render: (p) => count(p.services) },
          { key: 'sales', header: 'Sales', align: 'right', render: (p) => money(p.sales) },
          ...PARTS.map((part) => ({ key: part.key, header: part.label, align: 'right', render: (p) => money(p[part.key]) })),
        ];
        return (
          <>
            <Kpis
              items={[
                { label: 'Service sales', icon: Banknote, value: money(s.sales), trend: s.change.sales ?? undefined, caption: `${count(s.services)} services · average ${money(s.averageServiceValue)}` },
                { label: 'Products used', icon: Package, tone: 'pink', value: money(s.productCost), caption: `${percent(s.sales ? (s.productCost / s.sales) * 100 : 0)} of sales` },
                { label: 'Operations', icon: Calculator, tone: 'blue', value: money(s.operations), caption: `Running costs recorded: ${money(s.runningCosts)}` },
                { label: 'Staff earnings', icon: HandCoins, tone: 'teal', value: money(s.staffEarnings), trend: s.change.staffEarnings ?? undefined, caption: `${percent(s.staffShare)} of sales` },
                { label: 'Salon profit', icon: Coins, tone: s.salonProfit < 0 ? 'danger' : 'success', value: money(s.salonProfit), trend: s.change.salonProfit ?? undefined, caption: `${percent(s.profitMargin)} of sales · ${money(s.averageProfit)} per service` },
                {
                  label: 'Low-margin services', icon: AlertTriangle, tone: s.flagged.pending ? 'warning' : 'neutral',
                  value: count(s.flagged.zero + s.flagged.negative), caption: s.flagged.pending ? `${s.flagged.pending} waiting for review` : 'Nothing waiting for review',
                },
              ]}
            />

            <div className="grid gap-6 xl:grid-cols-3">
              <Card className="p-5">
                <h3 className="font-semibold">Where the money went</h3>
                <p className="mb-4 text-xs text-muted">Every service: price − products used → operations → staff (shared equally) and salon profit.</p>
                {s.sales > 0 && s.salonProfit >= 0 ? (
                  <ShareBar formatValue={money} segments={PARTS.map((part) => ({ key: part.key, label: part.label, value: s[part.key] }))} />
                ) : <p className="text-sm text-muted">{s.sales ? 'Services this period made a loss overall.' : 'No services sold in this period.'}</p>}
                {s.services ? (
                  <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
                    Operations set aside {money(s.operations)}; running costs recorded as expenses were {money(s.runningCosts)}
                    {s.operationsCoverage >= 0 ? `, so ${money(s.operationsCoverage)} was left over.` : `, ${money(-s.operationsCoverage)} more than set aside.`}
                  </p>
                ) : null}
              </Card>
              <ChartCard
                title="By period"
                description="Each column is the period's service sales, split into its four parts"
                className="xl:col-span-2"
                height={300}
                isEmpty={!r.series.some((p) => p.sales)}
                table={tableFrom(periodColumns, r.series)}
              >
                <StackedColumnChart
                  data={r.series}
                  xKey="period"
                  series={PARTS}
                  formatValue={(v, key) => (key === 'axis' ? compactMoney(v) : money(v))}
                  formatX={(v) => bucketLabel(v, g)}
                />
              </ChartCard>
            </div>

            <div className="mt-6 grid gap-6">
              <ReportTable
                title="By stylist"
                description="A shared service counts for each person, with their equal share"
                rows={r.staff}
                columns={[
                  { key: 'name', header: 'Staff member' },
                  { key: 'services', header: 'Services', align: 'right', render: (x) => `${count(x.services)}${x.shared ? ` (${x.shared} shared)` : ''}` },
                  { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) },
                  { key: 'productCost', header: 'Products', align: 'right', render: (x) => money(x.productCost) },
                  { key: 'earnings', header: 'Earnings', align: 'right', render: (x) => <span className="font-semibold">{money(x.earnings)}</span> },
                  { key: 'averageEarnings', header: 'Per service', align: 'right', render: (x) => money(x.averageEarnings) },
                ]}
              />
              <ReportTable
                title="By service"
                rows={r.services}
                columns={[
                  { key: 'name', header: 'Service' },
                  { key: 'count', header: 'Times', align: 'right', render: (x) => count(x.count) },
                  { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) },
                  { key: 'productCost', header: 'Products', align: 'right', render: (x) => money(x.productCost) },
                  { key: 'operations', header: 'Operations', align: 'right', render: (x) => money(x.operations) },
                  { key: 'staffEarnings', header: 'Staff', align: 'right', render: (x) => money(x.staffEarnings) },
                  { key: 'salonProfit', header: 'Salon profit', align: 'right', render: (x) => <span className={x.salonProfit < 0 ? 'font-semibold text-danger' : 'font-semibold'}>{money(x.salonProfit)}</span> },
                  { key: 'averageProfit', header: 'Avg profit', align: 'right', render: (x) => money(x.averageProfit) },
                ]}
              />
            </div>

            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <ReportTable
                title="By product"
                description="Products used on services, at their cost when used"
                rows={r.products.map((x) => ({ ...x, rowId: `${x.id}-${x.unit}` }))}
                rowKey="rowId"
                columns={[
                  { key: 'name', header: 'Product' },
                  { key: 'quantity', header: 'Used', align: 'right', render: (x) => `${formatNumber(x.quantity, { maximumFractionDigits: 3 })} ${x.unit}` },
                  { key: 'cost', header: 'Cost', align: 'right', render: (x) => money(x.cost) },
                  { key: 'timesUsed', header: 'Services', align: 'right', render: (x) => count(x.timesUsed) },
                  { key: 'services', header: 'Used in', render: (x) => <span className="text-xs text-muted">{x.services}</span> },
                ]}
              />
              <ReportTable
                title="Zero or negative margin"
                description="Services whose products cost as much as, or more than, the price"
                empty="No low-margin services in this period"
                rows={r.flagged}
                rowKey="itemId"
                onRowClick={(x) => navigate(`/pos/sales/${x.saleId}`)}
                columns={[
                  { key: 'invoiceNumber', header: 'Invoice', render: (x) => <span className="font-medium">{x.invoiceNumber}</span> },
                  { key: 'service', header: 'Service' },
                  { key: 'price', header: 'Price', align: 'right', render: (x) => money(x.price) },
                  { key: 'productCost', header: 'Products', align: 'right', render: (x) => money(x.productCost) },
                  { key: 'salonProfit', header: 'Salon', align: 'right', render: (x) => <span className={x.salonProfit < 0 ? 'text-danger' : ''}>{money(x.salonProfit)}</span> },
                  { key: 'reviewStatus', header: 'Review', render: (x) => <Badge tone={x.reviewStatus === 'pending' ? 'warning' : 'neutral'}>{x.reviewStatus === 'pending' ? 'Needs review' : titleCase(x.reviewStatus)}</Badge> },
                  { key: 'performedAt', header: 'Date', render: (x) => <span className="text-xs text-muted">{formatDateTime(x.performedAt)}</span> },
                ]}
              />
            </div>
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <ReportTable
                title="By how sales were entered"
                description="At the till, recorded later for an earlier date, or imported from a spreadsheet"
                rows={(r.bySource || []).filter((x) => x.services)}
                rowKey="source"
                empty="No services in this period"
                columns={[
                  { key: 'source', header: 'Entered', render: (x) => SOURCES[x.source] },
                  { key: 'sales', header: 'Sales', align: 'right', render: (x) => count(x.sales) },
                  { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) },
                  { key: 'operations', header: 'Operations', align: 'right', render: (x) => money(x.operations) },
                  { key: 'staffEarnings', header: 'Staff', align: 'right', render: (x) => money(x.staffEarnings) },
                  { key: 'salonProfit', header: 'Salon profit', align: 'right', render: (x) => money(x.salonProfit) },
                ]}
              />
              <ReportTable
                title="By calculation"
                description="The general formula, or a service's own rule"
                rows={r.byMethod || []}
                rowKey="method"
                empty="No services in this period"
                columns={[
                  { key: 'method', header: 'Calculation', render: (x) => METHODS[x.method] || x.method },
                  { key: 'services', header: 'Services', align: 'right', render: (x) => count(x.services) },
                  { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) },
                  { key: 'staffEarnings', header: 'Staff', align: 'right', render: (x) => money(x.staffEarnings) },
                  { key: 'salonProfit', header: 'Salon profit', align: 'right', render: (x) => money(x.salonProfit) },
                ]}
              />
            </div>
            <div className="mt-6">
              <ReportTable
                title="Recorded later, moved or voided"
                description="Sales of this period entered after the day, moved to another date, or voided — with who and why"
                empty="None in this period"
                rows={r.corrections || []}
                onRowClick={(x) => navigate(`/pos/sales/${x.id}`)}
                columns={[
                  { key: 'invoiceNumber', header: 'Invoice', render: (x) => <span className="font-medium">{x.invoiceNumber}</span> },
                  {
                    key: 'status', header: 'What', render: (x) => (
                      <span className="flex flex-wrap gap-1">
                        {x.status === 'voided' ? <Badge tone="danger">Voided</Badge> : null}
                        {x.source === 'backdated' ? <Badge tone="warning">Recorded later</Badge> : null}
                        {x.moved ? <Badge tone="info">Date changed</Badge> : null}
                      </span>
                    ),
                  },
                  { key: 'soldAt', header: 'Business date', render: (x) => <span className="text-xs">{formatDateTime(x.soldAt)}</span> },
                  { key: 'createdAt', header: 'Entered', render: (x) => <span className="text-xs text-muted">{formatDateTime(x.createdAt)} · {x.enteredBy}</span> },
                  { key: 'total', header: 'Total', align: 'right', render: (x) => money(x.total) },
                  { key: 'reason', header: 'Reason', render: (x) => <span className="text-xs text-muted">{x.voidReason || x.backdateReason || ''}</span> },
                ]}
              />
            </div>
            <p className="mt-6 flex items-center gap-1.5 text-xs text-muted">
              <Sparkles className="size-3.5" aria-hidden />
              Figures are stored when each service is sold, with the rule and percentages in force then, so later price or rule changes never alter them. Refunded and voided sales are left out. Imported sales are split with each service's rule; their product cost is estimated from the service's usual products.
            </p>
          </>
        );
      }}
    </ReportState>
  );
}
