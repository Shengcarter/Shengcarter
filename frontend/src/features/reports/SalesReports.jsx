import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, Banknote, CalendarX2, Coins, Gauge, Hourglass, Percent, ReceiptText, Repeat, Scissors, ShoppingBag, Sparkles, TrendingUp, UserPlus, Users,
} from 'lucide-react';
import { Badge } from '../../components/ui';
import { ChartCard } from '../../components/charts/ChartCard';
import { ColumnChart, RankedBarChart, ShareBar, TimeSeriesChart } from '../../components/charts/Charts';
import { formatDateTime, titleCase } from '../../utils/format';
import { useReport } from './api';
import { bucketLabel } from './periods';
import { Kpis, ReportState, ReportTable, compactMoney, count, money, percent, tableFrom } from './components';

const METHOD_ORDER = ['cash', 'mobile_money', 'card', 'bank_transfer'];

function SeriesCard({ title, description, data, groupBy, series, className, column = false }) {
  const columns = [
    { key: 'period', header: 'Period', render: (r) => bucketLabel(r.period, groupBy, true) },
    ...series.map((s) => ({ key: s.key, header: s.label, align: 'right', render: (r) => (s.money === false ? count(r[s.key]) : money(r[s.key])) })),
  ];
  const isMoney = series[0].money !== false;
  const unit = { day: 'day', week: 'week', month: 'month', year: 'year' }[groupBy];
  const note = data.length > 1 && data[data.length - 1].partial ? ` · the latest ${unit} is still in progress` : '';
  return (
    <ChartCard title={title} description={`${description || ''}${note}`.replace(/^ · /, '')} className={className} isEmpty={!data.some((d) => series.some((s) => d[s.key]))} table={tableFrom(columns, [...data].reverse())} height={280}>
      {column || data.length < 3 ? (
        <ColumnChart
          data={data}
          xKey="period"
          yKey={series[0].key}
          label={series[0].label}
          formatX={(v) => bucketLabel(v, groupBy)}
          formatValue={isMoney ? (v, key) => (key === 'axis' ? compactMoney(v) : money(v)) : undefined}
        />
      ) : (
        <TimeSeriesChart
          data={data}
          xKey="period"
          series={series}
          formatX={(v) => bucketLabel(v, groupBy)}
          formatLabel={(v) => bucketLabel(v, groupBy, true)}
          formatValue={isMoney ? (v, key) => (key === 'axis' ? compactMoney(v) : money(v)) : (v) => count(v)}
        />
      )}
    </ChartCard>
  );
}

function RankedCard({ title, description, rows, nameKey, valueKey, format = compactMoney, columns, className, empty }) {
  const top = rows.slice(0, 8);
  return (
    <ChartCard
      title={title}
      description={description}
      className={className}
      isEmpty={!top.some((r) => r[valueKey])}
      empty={empty}
      height={Math.max(180, top.length * 38)}
      table={tableFrom(columns, rows)}
    >
      <RankedBarChart data={top} nameKey={nameKey} valueKey={valueKey} label={title} formatValue={format} />
    </ChartCard>
  );
}

// ---- Sales ----------------------------------------------------------------------------------------

export function SalesReport({ params }) {
  const query = useReport('sales', params);
  return (
    <ReportState query={query}>
      {(r) => {
        const s = r.summary;
        const methods = METHOD_ORDER.map((m) => ({ key: m, label: titleCase(m), value: r.paymentMethods.find((p) => p.method === m)?.net || 0 }));
        return (
          <>
            <Kpis
              items={[
                { label: 'Gross sales', icon: Banknote, value: money(s.gross), trend: s.change.gross ?? undefined, caption: s.change.gross === null ? 'Including tax' : 'vs previous period' },
                { label: 'Transactions', icon: ReceiptText, value: count(s.count), trend: s.change.count ?? undefined, caption: `${count(s.walkIns)} walk-in` },
                { label: 'Average sale', icon: Gauge, value: money(s.averageSale), trend: s.change.averageSale ?? undefined, caption: 'vs previous period' },
                { label: 'Gross profit', icon: Coins, tone: 'success', value: money(s.grossProfit), caption: `After ${money(s.cogs)} cost of goods` },
              ]}
            />
            <div className="grid gap-6 xl:grid-cols-3">
              <SeriesCard
                title="Sales over time"
                description={`${money(s.gross)} gross · ${money(s.tax)} tax · ${money(s.discounts)} discounts`}
                data={r.series}
                groupBy={r.period.groupBy}
                series={[{ key: 'gross', label: 'Gross sales' }]}
                className="xl:col-span-2"
              />
              <ChartCard
                title="Payment methods"
                description="Net collected in the period"
                isEmpty={!methods.some((m) => m.value)}
                height="auto"
                table={{ columns: [{ key: 'label', header: 'Method' }, { key: 'value', header: 'Net', align: 'right', format: (v) => money(v) }], rows: methods }}
              >
                <div className="px-1 pt-1">
                  <ShareBar segments={methods} formatValue={money} />
                  <dl className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
                    <div><dt className="text-muted">Outstanding</dt><dd className="font-semibold">{money(s.outstanding)}</dd></div>
                    <div><dt className="text-muted">Refunded</dt><dd className="font-semibold">{count(s.refunds.count)} · {money(s.refunds.amount)}</dd></div>
                  </dl>
                </div>
              </ChartCard>
              <ChartCard
                title="Sales by weekday"
                description="Gross sales on each day of the week"
                isEmpty={!r.byWeekday.some((d) => d.gross)}
                table={tableFrom([{ key: 'day', header: 'Day' }, { key: 'sales', header: 'Sales', align: 'right', render: (d) => count(d.sales) }, { key: 'gross', header: 'Gross', align: 'right', render: (d) => money(d.gross) }], r.byWeekday)}
              >
                <ColumnChart data={r.byWeekday} xKey="day" yKey="gross" label="Gross sales" formatX={(v) => v.slice(0, 3)} formatValue={(v, key) => (key === 'axis' ? compactMoney(v) : money(v))} />
              </ChartCard>
              <ChartCard
                title="Busiest hours"
                description="Number of sales completed per hour"
                isEmpty={!r.byHour.length}
                table={tableFrom([{ key: 'hour', header: 'Hour' }, { key: 'sales', header: 'Sales', align: 'right', render: (d) => count(d.sales) }, { key: 'gross', header: 'Gross', align: 'right', render: (d) => money(d.gross) }], r.byHour)}
              >
                <ColumnChart data={r.byHour} xKey="hour" yKey="sales" label="Sales" />
              </ChartCard>
              <RankedCard
                title="Service categories"
                description={`${money(s.serviceRevenue)} from services · ${money(s.productRevenue)} from products`}
                rows={r.categories}
                nameKey="category"
                valueKey="revenue"
                columns={[{ key: 'category', header: 'Category' }, { key: 'revenue', header: 'Revenue', align: 'right', render: (c) => money(c.revenue) }, { key: 'share', header: 'Share', align: 'right', render: (c) => percent(c.share) }]}
              />
            </div>
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <ReportTable
                title="Services sold"
                columns={[
                  { key: 'name', header: 'Service', primary: true, render: (x) => <span className="font-medium">{x.name}</span> },
                  { key: 'category', header: 'Category', hideOnMobile: true },
                  { key: 'quantity', header: 'Sold', align: 'right', render: (x) => count(x.quantity) },
                  { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) },
                  { key: 'share', header: 'Share', align: 'right', render: (x) => percent(x.share) },
                ]}
                rows={r.services}
              />
              <ReportTable
                title="Staff"
                description="Service revenue after discounts, before tax"
                columns={[
                  { key: 'name', header: 'Staff member', primary: true, render: (x) => <span className="font-medium">{x.name}</span> },
                  { key: 'services', header: 'Services', align: 'right', render: (x) => count(x.services) },
                  { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) },
                  { key: 'commission', header: 'Commission', align: 'right', render: (x) => money(x.commission) },
                ]}
                rows={r.staff}
              />
              <ReportTable
                title="Products sold"
                className="xl:col-span-2"
                columns={[
                  { key: 'name', header: 'Product', primary: true, render: (x) => <span className="font-medium">{x.name}</span> },
                  { key: 'quantity', header: 'Units', align: 'right', render: (x) => count(x.quantity) },
                  { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) },
                  { key: 'cost', header: 'Cost', align: 'right', hideOnMobile: true, render: (x) => money(x.cost) },
                  { key: 'profit', header: 'Profit', align: 'right', render: (x) => money(x.profit) },
                  { key: 'margin', header: 'Margin', align: 'right', render: (x) => percent(x.margin) },
                ]}
                rows={r.products}
              />
            </div>
          </>
        );
      }}
    </ReportState>
  );
}

// ---- Customers ------------------------------------------------------------------------------------

export function CustomersReport({ params }) {
  const navigate = useNavigate();
  const query = useReport('customers', params);
  return (
    <ReportState query={query}>
      {(r) => {
        const s = r.summary;
        const customerColumns = [
          { key: 'name', header: 'Customer', primary: true, render: (c) => <span><span className="font-medium">{c.name}</span><span className="block text-xs text-muted">{c.code} · {c.phone}</span></span> },
          { key: 'visits', header: 'Visits', align: 'right', render: (c) => count(c.visits) },
          { key: 'spent', header: 'Spent', align: 'right', render: (c) => money(c.spent) },
          { key: 'lastVisit', header: 'Last visit', hideOnMobile: true, render: (c) => formatDateTime(c.lastVisit) },
        ];
        return (
          <>
            <Kpis
              items={[
                { label: 'New customers', icon: UserPlus, value: count(s.newCustomers), trend: s.newChange ?? undefined, caption: `${count(s.totalCustomers)} on record` },
                { label: 'Active customers', icon: Users, value: count(s.activeCustomers), caption: `${count(s.firstTimeCustomers)} first-time · ${count(s.returningCustomers)} returning` },
                { label: 'Retention', icon: Repeat, tone: s.retentionRate >= 60 ? 'success' : 'warning', value: percent(s.retentionRate), caption: `${count(s.retainedCustomers)} of ${count(s.previousActive)} came back` },
                { label: 'Average spend', icon: Banknote, value: money(s.averageSpend), caption: `${s.visitsPerCustomer} visits per customer` },
              ]}
            />
            <div className="grid gap-6 xl:grid-cols-3">
              <SeriesCard title="New customers" description="Registrations per period" data={r.series} groupBy={r.period.groupBy} series={[{ key: 'customers', label: 'New customers', money: false }]} column className="xl:col-span-2" />
              <RankedCard
                title="Loyalty tiers"
                description={`${percent(s.walkInShare)} of sales were walk-ins`}
                rows={r.tiers}
                nameKey="tier"
                valueKey="customers"
                format={count}
                columns={[{ key: 'tier', header: 'Tier' }, { key: 'customers', header: 'Customers', align: 'right', render: (t) => count(t.customers) }]}
              />
            </div>
            <div className="mt-6 grid gap-6 xl:grid-cols-2">
              <ReportTable title="Top customers" description="By spend in this period" columns={[...customerColumns, { key: 'tier', header: 'Tier', hideOnMobile: true, render: (c) => (c.tier ? <Badge tone="brand">{c.tier}</Badge> : '—') }]} rows={r.topCustomers} onRowClick={(c) => navigate(`/customers/${c.id}`)} />
              <ReportTable
                title="Regulars at risk"
                description={`${count(s.atRisk)} customers with 3+ visits have not returned in 60 days`}
                action={s.atRisk ? <AlertTriangle className="size-5 text-warning" aria-hidden /> : null}
                columns={customerColumns}
                rows={r.atRisk}
                empty="Every regular has visited recently"
                onRowClick={(c) => navigate(`/customers/${c.id}`)}
              />
            </div>
          </>
        );
      }}
    </ReportState>
  );
}

// ---- Services -------------------------------------------------------------------------------------

export function ServicesReport({ params }) {
  const query = useReport('services', params);
  return (
    <ReportState query={query}>
      {(r) => {
        const s = r.summary;
        return (
          <>
            <Kpis
              items={[
                { label: 'Services sold', icon: Scissors, value: count(s.servicesSold), caption: `${count(s.activeServices)} active services` },
                { label: 'Service revenue', icon: Banknote, value: money(s.revenue), caption: 'After discounts, before tax' },
                { label: 'Bookings', icon: ShoppingBag, value: count(s.bookings), caption: 'Appointments in the period' },
                { label: 'Cancelled / no-show', icon: CalendarX2, tone: s.cancellationRate >= 10 ? 'warning' : 'neutral', value: percent(s.cancellationRate), caption: 'Of all bookings' },
              ]}
            />
            <div className="grid gap-6 xl:grid-cols-2">
              <RankedCard
                title="Revenue by service"
                rows={r.services}
                nameKey="name"
                valueKey="revenue"
                columns={[{ key: 'name', header: 'Service' }, { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) }, { key: 'share', header: 'Share', align: 'right', render: (x) => percent(x.share) }]}
              />
              <RankedCard
                title="Revenue by category"
                rows={r.categories}
                nameKey="category"
                valueKey="revenue"
                columns={[{ key: 'category', header: 'Category' }, { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) }, { key: 'share', header: 'Share', align: 'right', render: (x) => percent(x.share) }]}
              />
            </div>
            <ReportTable
              title="Service performance"
              className="mt-6"
              columns={[
                { key: 'name', header: 'Service', primary: true, render: (x) => <span><span className="font-medium">{x.name}</span><span className="block text-xs text-muted">{x.category}</span></span> },
                { key: 'bookings', header: 'Bookings', align: 'right', render: (x) => count(x.bookings) },
                { key: 'cancellationRate', header: 'Cancelled / no-show', align: 'right', render: (x) => percent(x.cancellationRate) },
                { key: 'sold', header: 'Sold', align: 'right', render: (x) => count(x.sold) },
                { key: 'averagePrice', header: 'Avg price', align: 'right', hideOnMobile: true, render: (x) => money(x.averagePrice) },
                { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) },
                { key: 'share', header: 'Share', align: 'right', render: (x) => percent(x.share) },
              ]}
              rows={r.services}
            />
          </>
        );
      }}
    </ReportState>
  );
}

// ---- Staff ----------------------------------------------------------------------------------------

export function StaffReport({ params }) {
  const navigate = useNavigate();
  const query = useReport('staff', params);
  return (
    <ReportState query={query}>
      {(r) => {
        const s = r.summary;
        const bookable = r.staff.filter((x) => x.bookable);
        return (
          <>
            <Kpis
              items={[
                { label: 'Service revenue', icon: Banknote, value: money(s.serviceRevenue), caption: `${count(s.servicesPerformed)} services performed` },
                { label: 'Commission earned', icon: Coins, value: money(s.commission), caption: 'Excluding reversed' },
                { label: 'Average utilisation', icon: Percent, value: percent(s.averageUtilization), caption: 'Booked time ÷ scheduled time' },
                { label: 'Late / absent', icon: Hourglass, tone: s.lateArrivals + s.absences > 0 ? 'warning' : 'neutral', value: `${count(s.lateArrivals)} / ${count(s.absences)}`, caption: 'Attendance records' },
              ]}
            />
            <div className="grid gap-6 xl:grid-cols-2">
              <RankedCard title="Revenue by staff member" rows={r.staff.filter((x) => x.revenue)} nameKey="name" valueKey="revenue" columns={[{ key: 'name', header: 'Staff member' }, { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) }]} />
              <RankedCard
                title="Utilisation"
                description="Share of scheduled hours that were booked"
                rows={[...bookable].sort((a, b) => (b.utilization || 0) - (a.utilization || 0))}
                nameKey="name"
                valueKey="utilization"
                format={percent}
                columns={[{ key: 'name', header: 'Staff member' }, { key: 'bookedHours', header: 'Booked hours', align: 'right', render: (x) => count(x.bookedHours) }, { key: 'utilization', header: 'Utilisation', align: 'right', render: (x) => percent(x.utilization) }]}
              />
            </div>
            <ReportTable
              title="Staff performance"
              className="mt-6"
              onRowClick={(x) => navigate(`/employees/${x.id}`)}
              columns={[
                { key: 'name', header: 'Staff member', primary: true, render: (x) => <span><span className="font-medium">{x.name}</span><span className="block text-xs text-muted">{x.jobTitle}</span></span> },
                { key: 'appointments', header: 'Appts', align: 'right', render: (x) => count(x.appointments) },
                { key: 'noShows', header: 'No-shows', align: 'right', hideOnMobile: true, render: (x) => count(x.noShows) },
                { key: 'services', header: 'Services', align: 'right', render: (x) => count(x.services) },
                { key: 'revenue', header: 'Revenue', align: 'right', render: (x) => money(x.revenue) },
                { key: 'averageService', header: 'Avg service', align: 'right', hideOnMobile: true, render: (x) => money(x.averageService) },
                { key: 'commission', header: 'Commission', align: 'right', render: (x) => money(x.commission) },
                { key: 'utilization', header: 'Utilisation', align: 'right', render: (x) => percent(x.utilization) },
                { key: 'attendance', header: 'Present / late / absent', align: 'right', hideOnMobile: true, render: (x) => `${x.present} / ${x.late} / ${x.absent}` },
              ]}
              rows={r.staff}
            />
            {s.topPerformer ? (
              <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Sparkles className="size-4 text-accent" aria-hidden />Top performer this period: <span className="font-medium text-fg">{s.topPerformer}</span><TrendingUp className="size-4 text-success" aria-hidden /></p>
            ) : null}
          </>
        );
      }}
    </ReportState>
  );
}
