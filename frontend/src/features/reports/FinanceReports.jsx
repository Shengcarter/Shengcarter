import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Banknote, Boxes, Building2, Coins, Package, PackageX, Receipt, Scale, Truck, Wallet } from 'lucide-react';
import { Card, CardHeader } from '../../components/ui';
import { ChartCard } from '../../components/charts/ChartCard';
import { ColumnChart, RankedBarChart, TimeSeriesChart } from '../../components/charts/Charts';
import { formatDate, formatDateTime, titleCase } from '../../utils/format';
import { cn } from '../../utils/cn';
import { useReport } from './api';
import { bucketLabel } from './periods';
import { Kpis, ReportState, ReportTable, compactMoney, count, money, percent, tableFrom } from './components';

function Ranked({ title, description, rows, nameKey, valueKey, columns, format = compactMoney, className }) {
  const top = rows.slice(0, 8);
  return (
    <ChartCard title={title} description={description} className={className} isEmpty={!top.some((r) => r[valueKey])} height={Math.max(180, top.length * 38)} table={tableFrom(columns, rows)}>
      <RankedBarChart data={top} nameKey={nameKey} valueKey={valueKey} label={title} formatValue={format} />
    </ChartCard>
  );
}

// ---- Expenses -------------------------------------------------------------------------------------

export function ExpensesReport({ params }) {
  const query = useReport('expenses', params);
  return (
    <ReportState query={query}>
      {(r) => {
        const s = r.summary;
        const g = r.period.groupBy;
        return (
          <>
            <Kpis
              items={[
                { label: 'Total expenses', icon: Wallet, value: money(s.total), trend: s.change ?? undefined, caption: `${count(s.count)} entries` },
                { label: 'Average per day', icon: Receipt, value: money(s.averagePerDay), caption: `${r.period.days} days` },
                { label: 'Share of net sales', icon: Scale, tone: s.shareOfSales >= 70 ? 'danger' : s.shareOfSales >= 50 ? 'warning' : 'neutral', value: percent(s.shareOfSales), caption: 'Expenses ÷ net sales' },
                { label: 'Largest category', icon: Coins, value: s.largestCategory || '—', caption: r.categories[0] ? money(r.categories[0].total) : 'No expenses' },
              ]}
            />
            <div className="grid gap-6 xl:grid-cols-2">
              <ChartCard
                title="Expenses over time"
                isEmpty={!r.series.some((p) => p.total)}
                table={tableFrom([{ key: 'period', header: 'Period', render: (p) => bucketLabel(p.period, g, true) }, { key: 'total', header: 'Amount', align: 'right', render: (p) => money(p.total) }], [...r.series].reverse())}
              >
                <ColumnChart data={r.series} xKey="period" yKey="total" label="Expenses" formatX={(v) => bucketLabel(v, g)} formatValue={(v, key) => (key === 'axis' ? compactMoney(v) : money(v))} />
              </ChartCard>
              <Ranked
                title="By category"
                rows={r.categories}
                nameKey="category"
                valueKey="total"
                columns={[{ key: 'category', header: 'Category' }, { key: 'total', header: 'Amount', align: 'right', render: (c) => money(c.total) }, { key: 'share', header: 'Share', align: 'right', render: (c) => percent(c.share) }]}
              />
            </div>
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <ReportTable
                title="Top vendors"
                rowKey="vendor"
                columns={[
                  { key: 'vendor', header: 'Vendor', primary: true, render: (v) => <span className="font-medium">{v.vendor}</span> },
                  { key: 'count', header: 'Entries', align: 'right', render: (v) => count(v.count) },
                  { key: 'total', header: 'Amount', align: 'right', render: (v) => money(v.total) },
                ]}
                rows={r.vendors}
              />
              <ReportTable
                title="Paid with"
                rowKey="method"
                columns={[
                  { key: 'method', header: 'Method', primary: true, render: (m) => titleCase(m.method) },
                  { key: 'total', header: 'Amount', align: 'right', render: (m) => money(m.total) },
                ]}
                rows={r.paymentMethods}
              />
            </div>
          </>
        );
      }}
    </ReportState>
  );
}

// ---- Profit & loss --------------------------------------------------------------------------------

function StatementLine({ label, value, strong, minus, note, tone }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 px-5 py-2.5', strong && 'border-t border-line bg-surface-2/50')}>
      <dt className={cn('text-sm', strong ? 'font-semibold text-fg' : 'text-muted')}>
        {minus ? 'Less: ' : ''}{label}
        {note ? <span className="ml-2 text-xs text-muted">{note}</span> : null}
      </dt>
      <dd className={cn(strong ? 'text-base font-semibold' : 'text-sm', tone === 'danger' && 'text-danger', tone === 'success' && 'text-success')}>
        {minus ? `(${money(value)})` : money(value)}
      </dd>
    </div>
  );
}

export function ProfitReport({ params }) {
  const query = useReport('profit', params);
  return (
    <ReportState query={query}>
      {(r) => {
        const s = r.summary;
        const g = r.period.groupBy;
        return (
          <>
            <Kpis
              items={[
                { label: 'Net sales', icon: Banknote, value: money(s.netSales), trend: s.change.netSales ?? undefined, caption: 'Excluding tax' },
                { label: 'Gross profit', icon: Coins, value: money(s.grossProfit), caption: `${percent(s.grossMargin)} margin` },
                { label: 'Expenses', icon: Wallet, value: money(s.expenses), trend: s.change.expenses ?? undefined, caption: s.change.expenses === null ? 'Nothing to compare yet' : 'vs previous period' },
                { label: 'Profit after wages', icon: Scale, tone: s.afterWages.profit < 0 ? 'danger' : 'success', value: money(s.afterWages.profit), trend: s.afterWages.change ?? undefined, caption: `Cash profit ${money(s.netProfit)}` },
              ]}
            />
            <div className="grid gap-6 xl:grid-cols-3">
              <Card className="xl:row-span-2">
                <CardHeader title="Profit & loss statement" description={`${formatDate(r.period.from)} – ${formatDate(r.period.to)}`} />
                <dl className="pb-2">
                  <StatementLine label="Gross sales (incl. tax)" value={s.grossSales} />
                  <StatementLine label="Tax collected" value={s.tax} minus />
                  <StatementLine label="Net sales" value={s.netSales} strong />
                  <StatementLine label="Cost of goods sold" value={s.cogs} minus />
                  <StatementLine label="Gross profit" value={s.grossProfit} strong note={percent(s.grossMargin)} />
                  {r.expenses.map((e) => <StatementLine key={e.category} label={e.category} value={e.total} minus />)}
                  <StatementLine label="Total expenses" value={s.expenses} minus strong />
                  <StatementLine label="Net profit (cash paid out)" value={s.netProfit} strong tone={s.netProfit < 0 ? 'danger' : 'success'} note={percent(s.netMargin)} />
                </dl>
                <div className="border-t border-line px-5 pt-4">
                  <p className="text-sm font-semibold">Profit after wages</p>
                  <p className="mt-0.5 text-xs text-muted">Counts wages for the days worked, paid or not, so profit does not jump on payday. Running costs are all expenses except salary payments.</p>
                </div>
                <dl className="pb-2">
                  <StatementLine label="Gross profit" value={s.grossProfit} />
                  <StatementLine label="Running costs" value={s.afterWages.runningCosts} minus />
                  <StatementLine label="Salaries for days worked" value={s.afterWages.salaries} minus />
                  <StatementLine label="Commission earned" value={s.afterWages.commission} minus />
                  <StatementLine label="Profit after wages" value={s.afterWages.profit} strong tone={s.afterWages.profit < 0 ? 'danger' : 'success'} note={percent(s.afterWages.margin)} />
                </dl>
                <div className="space-y-1.5 border-t border-line px-5 py-4 text-xs text-muted">
                  <p>Discounts given: {money(s.discounts)} (already deducted from sales).</p>
                  <p>Commission earned but not yet paid: {money(s.unpaidCommission)} — it becomes an expense when salaries are paid.</p>
                  <p>Once every salary for the period has been paid, profit after wages equals net profit.</p>
                  <p>Customer balances still owed: {money(s.outstanding)}.</p>
                </div>
              </Card>
              <ChartCard
                title="Net sales, expenses and profit"
                className="xl:col-span-2"
                height={300}
                isEmpty={!r.series.some((p) => p.net || p.expenses)}
                table={tableFrom(
                  [
                    { key: 'period', header: 'Period', render: (p) => bucketLabel(p.period, g, true) },
                    { key: 'net', header: 'Net sales', align: 'right', render: (p) => money(p.net) },
                    { key: 'cogs', header: 'COGS', align: 'right', render: (p) => money(p.cogs) },
                    { key: 'expenses', header: 'Expenses', align: 'right', render: (p) => money(p.expenses) },
                    { key: 'profit', header: 'Net profit', align: 'right', render: (p) => money(p.profit) },
                  ],
                  [...r.series].reverse(),
                )}
              >
                <TimeSeriesChart
                  data={r.series}
                  xKey="period"
                  series={[{ key: 'net', label: 'Net sales' }, { key: 'expenses', label: 'Expenses' }, { key: 'profit', label: 'Net profit' }]}
                  formatX={(v) => bucketLabel(v, g)}
                  formatLabel={(v) => bucketLabel(v, g, true)}
                  formatValue={(v, key) => (key === 'axis' ? compactMoney(v) : money(v))}
                />
              </ChartCard>
              <Ranked
                className="xl:col-span-2"
                title="Where the money went"
                rows={r.expenses}
                nameKey="category"
                valueKey="total"
                columns={[{ key: 'category', header: 'Category' }, { key: 'total', header: 'Amount', align: 'right', render: (c) => money(c.total) }, { key: 'share', header: 'Share', align: 'right', render: (c) => percent(c.share) }]}
              />
            </div>
          </>
        );
      }}
    </ReportState>
  );
}

// ---- Branches -------------------------------------------------------------------------------------

export function BranchesReport({ params }) {
  const query = useReport('branches', params);
  return (
    <ReportState query={query}>
      {(r) => (
        <>
          <Kpis
            items={[
              { label: 'Branches', icon: Building2, value: count(r.summary.branches) },
              { label: 'Gross sales', icon: Banknote, value: money(r.summary.grossSales) },
              { label: 'Expenses', icon: Wallet, value: money(r.summary.expenses) },
              { label: 'Net profit', icon: Scale, tone: r.summary.netProfit < 0 ? 'danger' : 'success', value: money(r.summary.netProfit) },
            ]}
          />
          <div className="grid gap-6 xl:grid-cols-2">
            <Ranked title="Gross sales by branch" rows={r.branches} nameKey="name" valueKey="grossSales" columns={[{ key: 'name', header: 'Branch' }, { key: 'grossSales', header: 'Gross sales', align: 'right', render: (b) => money(b.grossSales) }, { key: 'share', header: 'Share', align: 'right', render: (b) => percent(b.share) }]} />
            <Ranked title="Net profit by branch" rows={[...r.branches].sort((a, b) => b.netProfit - a.netProfit)} nameKey="name" valueKey="netProfit" columns={[{ key: 'name', header: 'Branch' }, { key: 'netProfit', header: 'Net profit', align: 'right', render: (b) => money(b.netProfit) }]} />
          </div>
          <ReportTable
            title="Branch comparison"
            className="mt-6"
            columns={[
              { key: 'name', header: 'Branch', primary: true, render: (b) => <span><span className="font-medium">{b.name}</span>{!b.active ? <span className="ml-2 text-xs text-muted">(inactive)</span> : null}</span> },
              { key: 'sales', header: 'Sales', align: 'right', render: (b) => count(b.sales) },
              { key: 'grossSales', header: 'Gross sales', align: 'right', render: (b) => money(b.grossSales) },
              { key: 'averageSale', header: 'Avg sale', align: 'right', hideOnMobile: true, render: (b) => money(b.averageSale) },
              { key: 'expenses', header: 'Expenses', align: 'right', render: (b) => money(b.expenses) },
              { key: 'netProfit', header: 'Net profit', align: 'right', render: (b) => money(b.netProfit) },
              { key: 'customers', header: 'Customers', align: 'right', hideOnMobile: true, render: (b) => count(b.customers) },
              { key: 'appointments', header: 'Appointments', align: 'right', hideOnMobile: true, render: (b) => count(b.appointments) },
            ]}
            rows={r.branches}
          />
        </>
      )}
    </ReportState>
  );
}

// ---- Inventory ------------------------------------------------------------------------------------

const MOVEMENT_LABELS = { opening: 'Opening stock', purchase: 'Purchases received', sale: 'Sales', refund: 'Refund returns', adjustment: 'Stock counts', stock_in: 'Stock in', stock_out: 'Stock out', damage: 'Damaged / expired', internal_use: 'Salon use' };

export function InventoryReport({ params }) {
  const navigate = useNavigate();
  const query = useReport('inventory', params);
  return (
    <ReportState query={query}>
      {(r) => {
        const s = r.summary;
        return (
          <>
            <Kpis
              items={[
                { label: 'Stock value (cost)', icon: Boxes, value: money(s.costValue), caption: `${money(s.retailValue)} at retail` },
                { label: 'Units sold', icon: Package, value: count(s.unitsSold), caption: `${money(s.productRevenue)} revenue` },
                { label: 'Product profit', icon: Coins, tone: 'success', value: money(s.productProfit), caption: 'Revenue − cost of goods' },
                { label: 'Low / out of stock', icon: PackageX, tone: s.outOfStock ? 'danger' : s.lowStock ? 'warning' : 'neutral', value: `${count(s.lowStock)} / ${count(s.outOfStock)}`, caption: `${count(s.purchases)} purchases · ${money(s.purchasesTotal)}` },
              ]}
            />
            <div className="grid gap-6 xl:grid-cols-2">
              <Ranked
                title="Stock value by category"
                description="At cost price"
                rows={r.valuation}
                nameKey="category"
                valueKey="costValue"
                columns={[{ key: 'category', header: 'Category' }, { key: 'units', header: 'Units', align: 'right', render: (c) => count(c.units) }, { key: 'costValue', header: 'Cost value', align: 'right', render: (c) => money(c.costValue) }, { key: 'retailValue', header: 'Retail value', align: 'right', render: (c) => money(c.retailValue) }]}
              />
              <ReportTable
                title="Stock movements"
                rowKey="type"
                columns={[
                  { key: 'type', header: 'Movement', primary: true, render: (m) => MOVEMENT_LABELS[m.type] || titleCase(m.type) },
                  { key: 'entries', header: 'Entries', align: 'right', render: (m) => count(m.entries) },
                  { key: 'quantity', header: 'Net units', align: 'right', render: (m) => <span className={m.quantity < 0 ? 'text-danger' : 'text-success'}>{m.quantity > 0 ? '+' : ''}{count(m.quantity)}</span> },
                  { key: 'value', header: 'Value (cost)', align: 'right', render: (m) => money(m.value) },
                ]}
                rows={r.movements}
              />
            </div>
            <ReportTable
              title="Best-selling products"
              className="mt-6"
              onRowClick={(p) => navigate(`/inventory?product=${p.id}`)}
              columns={[
                { key: 'name', header: 'Product', primary: true, render: (p) => <span><span className="font-medium">{p.name}</span><span className="block text-xs text-muted">{p.sku}</span></span> },
                { key: 'quantity', header: 'Sold', align: 'right', render: (p) => count(p.quantity) },
                { key: 'revenue', header: 'Revenue', align: 'right', render: (p) => money(p.revenue) },
                { key: 'profit', header: 'Profit', align: 'right', render: (p) => money(p.profit) },
                { key: 'margin', header: 'Margin', align: 'right', hideOnMobile: true, render: (p) => percent(p.margin) },
                { key: 'inStock', header: 'In stock', align: 'right', render: (p) => count(p.inStock) },
                {
                  key: 'daysOfCover', header: 'Days of cover', align: 'right',
                  render: (p) => (p.daysOfCover === null ? '—' : <span className={cn(p.daysOfCover < 14 && 'font-medium text-warning')}>{count(p.daysOfCover)}</span>),
                },
              ]}
              rows={r.topProducts}
            />
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <ReportTable
                title="Low stock"
                action={r.lowStock.length ? <AlertTriangle className="size-5 text-warning" aria-hidden /> : null}
                empty="Every product is above its minimum"
                columns={[
                  { key: 'name', header: 'Product', primary: true, render: (p) => <span className="font-medium">{p.name}</span> },
                  { key: 'inStock', header: 'In stock', align: 'right', render: (p) => <span className={p.inStock === 0 ? 'text-danger' : 'text-warning'}>{count(p.inStock)} {p.unit}</span> },
                  { key: 'minStock', header: 'Minimum', align: 'right', render: (p) => count(p.minStock) },
                ]}
                rows={r.lowStock}
                onRowClick={(p) => navigate(`/inventory?product=${p.id}`)}
              />
              <ReportTable
                title="Slow movers"
                description="Retail products with no sales in this period"
                action={<Truck className="size-5 text-muted" aria-hidden />}
                empty="Every retail product sold at least once"
                columns={[
                  { key: 'name', header: 'Product', primary: true, render: (p) => <span className="font-medium">{p.name}</span> },
                  { key: 'inStock', header: 'In stock', align: 'right', render: (p) => count(p.inStock) },
                  { key: 'stockValue', header: 'Stock value', align: 'right', render: (p) => money(p.stockValue) },
                  { key: 'lastSold', header: 'Last sold', hideOnMobile: true, render: (p) => (p.lastSold ? formatDateTime(p.lastSold) : 'Never') },
                ]}
                rows={r.slowMovers}
              />
            </div>
          </>
        );
      }}
    </ReportState>
  );
}
