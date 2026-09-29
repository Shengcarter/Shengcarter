import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlertTriangle, Banknote, CakeSlice, CalendarCheck, CalendarDays, CalendarPlus, Clock, Coins, Hourglass, LogIn, LogOut, Package,
  ReceiptText, ScanLine, ShoppingBag, Sparkles, TrendingUp, UserPlus, Users,
} from 'lucide-react';
import { Avatar, Badge, Button, ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageHeader, Skeleton, StatCard, StatusBadge } from '../../components/ui';
import { ChartCard } from '../../components/charts/ChartCard';
import { ColumnChart, RankedBarChart, ShareBar } from '../../components/charts/Charts';
import { formatDate, formatDateTime, formatMoney, formatNumber, formatTime, nowInBusinessZone, toBusinessZone } from '../../utils/format';
import { useDocumentTitle, usePermission } from '../../hooks';
import { useAuthStore } from '../../store/authStore';
import { employeeApi } from '../employees/api';
import { useDashboard, useInsights } from '../reports/api';
import { cn } from '../../utils/cn';

const METHOD_LABELS = { cash: 'Cash', mobile_money: 'Mobile money', card: 'Card', bank_transfer: 'Bank transfer' };
const METHOD_ORDER = ['cash', 'mobile_money', 'card', 'bank_transfer'];

function greeting() {
  const hour = nowInBusinessZone().hour;
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
}

function QuickActions() {
  const can = usePermission();
  const actions = [
    can('pos.create') && { to: '/pos', label: 'New sale', icon: ShoppingBag, primary: true },
    can('appointments.create') && { to: '/appointments?new=1', label: 'Book appointment', icon: CalendarPlus },
    can('customers.create') && { to: '/customers?new=1', label: 'New customer', icon: UserPlus },
    can('appointments.checkin') && { to: '/appointments?checkin=1', label: 'Check in', icon: ScanLine },
  ].filter(Boolean);
  if (!actions.length) return null;
  return actions.map((a) => (
    <ButtonLink key={a.to} to={a.to} icon={a.icon} variant={a.primary ? 'primary' : 'secondary'}>{a.label}</ButtonLink>
  ));
}

/** Stylist's own day: services, commission and clock in/out. */
function MyDay({ me }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const attendance = me.attendance;
  const clock = async (action) => {
    setBusy(true);
    try {
      await (action === 'in' ? employeeApi.clockIn() : employeeApi.clockOut());
      toast.success(action === 'in' ? 'Clocked in — have a great day!' : 'Clocked out. See you next time!');
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="mb-6 flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
      <div className="flex flex-1 items-center gap-4">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-gold-500/12 text-accent ring-1 ring-gold-500/20"><Clock className="size-5" aria-hidden /></span>
        <div>
          <p className="font-semibold">My day</p>
          <p className="text-sm text-muted">
            {attendance?.clockIn
              ? `Clocked in at ${formatTime(attendance.clockIn)}${attendance.clockOut ? ` · out at ${formatTime(attendance.clockOut)}` : ''}${attendance.status === 'late' ? ' (late)' : ''}`
              : attendance?.status === 'on_leave' ? 'On leave today' : 'Not clocked in yet'}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-4 text-sm lg:w-[28rem]">
        <div><dt className="text-muted">Services this month</dt><dd className="mt-0.5 text-lg font-semibold">{formatNumber(me.servicesThisMonth)}</dd></div>
        <div><dt className="text-muted">Service revenue</dt><dd className="mt-0.5 text-lg font-semibold">{formatMoney(me.revenueThisMonth)}</dd></div>
        <div><dt className="text-muted">Commission</dt><dd className="mt-0.5 text-lg font-semibold">{formatMoney(me.commissionThisMonth)}</dd></div>
      </dl>
      {me.canClock && attendance?.status !== 'on_leave' ? (
        !attendance?.clockIn ? (
          <Button icon={LogIn} loading={busy} onClick={() => clock('in')}>Clock in</Button>
        ) : !attendance.clockOut ? (
          <Button variant="secondary" icon={LogOut} loading={busy} onClick={() => clock('out')}>Clock out</Button>
        ) : null
      ) : null}
    </Card>
  );
}

function SalesKpis({ sales, finance }) {
  const navigate = useNavigate();
  const can = usePermission();
  const today = sales.today;
  const month = sales.month;
  return (
    <div className="mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
      <StatCard
        label="Today's sales"
        icon={Banknote}
        value={formatMoney(today.gross)}
        trend={today.change ?? undefined}
        caption={today.change === null ? `${formatNumber(today.count)} sales today` : 'vs same day last week'}
        onClick={can('sales.view') ? () => navigate('/pos/sales') : undefined}
      />
      <StatCard
        label="This month"
        icon={TrendingUp}
        value={formatMoney(month.gross)}
        trend={month.change ?? undefined}
        caption={month.change === null ? `${formatNumber(month.count)} sales` : 'vs same days last month'}
        index={1}
      />
      {finance ? (
        <StatCard label="Profit this month" icon={Coins} tone={finance.profitAfterWages < 0 ? 'danger' : 'success'} value={formatMoney(finance.profitAfterWages)} trend={finance.profitAfterWagesChange ?? undefined} caption={`After ${formatMoney(finance.wagesEarned)} wages`} index={2} />
      ) : (
        <StatCard label="Average sale" icon={ReceiptText} value={formatMoney(month.averageSale)} caption="This month" index={2} />
      )}
      <StatCard
        label="Owed by customers"
        icon={Hourglass}
        tone={sales.outstanding.total > 0 ? 'warning' : 'neutral'}
        value={formatMoney(sales.outstanding.total)}
        caption={`${formatNumber(sales.outstanding.count)} unpaid balance${sales.outstanding.count === 1 ? '' : 's'}`}
        index={3}
      />
    </div>
  );
}

function RevenueTrend({ trend }) {
  const table = {
    columns: [
      { key: 'period', header: 'Day', format: (v) => formatDate(v, 'ccc dd LLL') },
      { key: 'sales', header: 'Sales', align: 'right', format: (v) => formatNumber(v) },
      { key: 'gross', header: 'Revenue', align: 'right', format: (v) => formatMoney(v) },
    ],
    rows: [...trend].reverse(),
  };
  const total = trend.reduce((s, d) => s + d.gross, 0);
  return (
    <ChartCard
      title="Revenue, last 30 days"
      description={`${formatMoney(total)} in total · ${formatMoney(total / 30)} a day on average`}
      table={table}
      isEmpty={!total}
      height={250}
      fill
      className="xl:col-span-2"
    >
      <ColumnChart
        data={trend}
        xKey="period"
        yKey="gross"
        label="Revenue"
        formatX={(v) => formatDate(v, 'dd LLL')}
        formatValue={(v, key) => formatMoney(v, { compact: key === 'axis' })}
      />
    </ChartCard>
  );
}

function AppointmentsToday({ appointments, className }) {
  const t = appointments.today;
  const stats = [
    { label: 'Booked', value: t.total - t.cancelled - t.noShow },
    { label: 'In the chair', value: t.inProgress },
    { label: 'Completed', value: t.completed },
    { label: 'No-show / cancelled', value: t.noShow + t.cancelled },
  ];
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader
        title={appointments.ownOnly ? 'My appointments today' : "Today's appointments"}
        icon={CalendarDays}
        action={<Link to="/appointments" className="text-sm font-medium text-accent hover:underline">Calendar</Link>}
      />
      <dl className="grid grid-cols-4 gap-2 px-5 pb-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-surface-2/70 px-2 py-2.5 text-center">
            <dd className="text-xl font-semibold">{formatNumber(s.value)}</dd>
            <dt className="mt-0.5 text-[11px] leading-tight text-muted">{s.label}</dt>
          </div>
        ))}
      </dl>
      <div className="border-t border-line px-5 pt-3 pb-1 text-xs font-medium tracking-wide text-muted uppercase">Up next</div>
      {appointments.upcoming.length ? (
        <ul className="flex-1 divide-y divide-line/70">
          {appointments.upcoming.map((a) => (
            <li key={a.id}>
              <Link to={`/appointments?appointment=${a.id}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-surface-2/60">
                <span className="w-14 shrink-0">
                  {!toBusinessZone(a.startTime).hasSame(nowInBusinessZone(), 'day') ? <span className="block text-[11px] leading-tight text-muted">{formatDate(a.startTime, 'ccc dd')}</span> : null}
                  <span className="block text-sm font-semibold">{formatTime(a.startTime)}</span>
                </span>
                <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: a.calendarColor || '#D4AF37' }} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.customerName}</span>
                  <span className="block truncate text-xs text-muted">{a.services}{appointments.ownOnly ? '' : ` · ${a.employeeName}`}</span>
                </span>
                {a.status === 'in_progress' ? <Badge tone="info">Now</Badge> : null}
                {a.status === 'pending' ? <StatusBadge status="pending" /> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={CalendarCheck} title="Nothing else booked" description="New bookings will appear here." className="py-8" />
      )}
    </Card>
  );
}

function TopList({ title, rows, nameKey, empty }) {
  const data = rows.slice(0, 5);
  return (
    <ChartCard
      title={title}
      description="This month, by revenue"
      isEmpty={!data.length}
      empty={<EmptyState title={empty} className="py-10" />}
      height={Math.max(160, data.length * 40)}
      table={{
        columns: [
          { key: nameKey, header: 'Name' },
          { key: 'count', header: 'Count', align: 'right', format: (v) => formatNumber(v) },
          { key: 'revenue', header: 'Revenue', align: 'right', format: (v) => formatMoney(v) },
        ],
        rows: data.map((r) => ({ ...r, count: r.quantity ?? r.services })),
      }}
    >
      <RankedBarChart data={data} nameKey={nameKey} valueKey="revenue" label="Revenue" formatValue={(v) => formatMoney(v, { compact: true })} />
    </ChartCard>
  );
}

function PaymentMix({ rows }) {
  const segments = METHOD_ORDER.map((m) => ({ key: m, label: METHOD_LABELS[m], value: rows.find((r) => r.method === m)?.total || 0 }));
  const total = segments.reduce((s, x) => s + x.value, 0);
  return (
    <ChartCard
      title="How customers paid"
      description="This month, net of refunds"
      isEmpty={!total}
      height="auto"
      table={{ columns: [{ key: 'label', header: 'Method' }, { key: 'value', header: 'Amount', align: 'right', format: (v) => formatMoney(v) }], rows: segments }}
    >
      <div className="px-1 pt-1"><ShareBar segments={segments} formatValue={(v) => formatMoney(v)} /></div>
    </ChartCard>
  );
}

function RecentSales({ rows }) {
  return (
    <Card className="xl:col-span-2">
      <CardHeader title="Recent sales" icon={ReceiptText} action={<Link to="/pos/sales" className="text-sm font-medium text-accent hover:underline">All sales</Link>} />
      {rows.length ? (
        <ul className="divide-y divide-line/70">
          {rows.map((s) => (
            <li key={s.id}>
              <Link to={`/pos/sales/${s.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{s.customerName || 'Walk-in customer'}</span>
                  <span className="block text-xs text-muted">{s.invoiceNumber} · {formatDateTime(s.soldAt)}</span>
                </span>
                <span className={cn('text-sm font-semibold', s.status === 'refunded' && 'text-muted line-through')}>{formatMoney(s.total)}</span>
                <StatusBadge status={s.status === 'refunded' ? 'refunded' : s.paymentStatus} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={ShoppingBag} title="No sales yet" description="Completed sales will appear here." className="py-10" />
      )}
    </Card>
  );
}

function LowStock({ inventory }) {
  const count = inventory.lowStock + inventory.outOfStock;
  return (
    <Card>
      <CardHeader
        title="Stock alerts"
        icon={Package}
        description={count ? `${inventory.outOfStock} out of stock · ${inventory.lowStock} low` : 'All products are above minimum'}
        action={<Link to="/inventory" className="text-sm font-medium text-accent hover:underline">Inventory</Link>}
      />
      {inventory.items.length ? (
        <ul className="divide-y divide-line/70 pb-2">
          {inventory.items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
              <AlertTriangle className={cn('size-4 shrink-0', p.quantity === 0 ? 'text-danger' : 'text-warning')} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className={cn('font-medium', p.quantity === 0 ? 'text-danger' : 'text-warning')}>{formatNumber(p.quantity)} {p.unit}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

function Birthdays({ customers }) {
  if (!customers.birthdays.length) return null;
  return (
    <Card>
      <CardHeader title="Birthdays this week" icon={CakeSlice} description="A greeting (or a birthday offer) goes a long way." />
      <ul className="divide-y divide-line/70 pb-2">
        {customers.birthdays.slice(0, 6).map((b) => (
          <li key={b.id}>
            <Link to={`/customers/${b.id}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-surface-2/60">
              <Avatar name={b.fullName} size="sm" />
              <span className="min-w-0 flex-1 truncate font-medium">{b.fullName}</span>
              <Badge tone={b.inDays === 0 ? 'gold' : 'neutral'}>{b.inDays === 0 ? 'Today' : b.inDays === 1 ? 'Tomorrow' : formatDate(`${nowInBusinessZone().year}-${String(b.dateOfBirth).slice(5, 10)}`, 'ccc dd LLL')}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function StaffToday({ staff }) {
  const onDuty = staff.filter((s) => s.clockIn && !s.clockOut).length;
  return (
    <Card>
      <CardHeader title="Team today" icon={Users} description={`${onDuty} of ${staff.length} on duty`} action={<Link to="/employees?tab=attendance" className="text-sm font-medium text-accent hover:underline">Attendance</Link>} />
      <ul className="grid gap-x-6 px-5 pb-4 sm:grid-cols-2">
        {staff.map((s) => (
          <li key={s.id} className="flex items-center gap-3 border-b border-line/60 py-2.5 last:border-0">
            <span className="relative">
              <Avatar name={s.fullName} size="sm" />
              <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-surface" style={{ background: s.calendarColor || '#D4AF37' }} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{s.fullName}</span>
              <span className="block truncate text-xs text-muted">{s.jobTitle}</span>
            </span>
            <span className="text-right text-xs">
              {s.status ? <StatusBadge status={s.status} label={s.status === 'present' && s.clockOut ? 'Left' : undefined} /> : <Badge>Not in</Badge>}
              {s.clockIn ? <span className="mt-1 block text-muted">{formatTime(s.clockIn)}{s.clockOut ? `–${formatTime(s.clockOut)}` : ''}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const SEVERITY = {
  critical: { icon: AlertTriangle, className: 'text-danger bg-red-500/10' },
  warning: { icon: AlertTriangle, className: 'text-warning bg-amber-500/10' },
  positive: { icon: TrendingUp, className: 'text-success bg-green-500/10' },
  info: { icon: Sparkles, className: 'text-accent bg-gold-500/10' },
};

/** The three most important findings from the insights engine. */
function InsightsTeaser() {
  const insights = useInsights({});
  const findings = insights.data?.findings?.slice(0, 3) || [];
  return (
    <Card className="flex flex-col">
      <CardHeader title="Business insights" icon={Sparkles} description="Last 30 days" action={<Link to="/reports?tab=insights" className="text-sm font-medium text-accent hover:underline">All insights</Link>} />
      {insights.isPending ? (
        <div className="space-y-3 px-5 pb-5">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
      ) : findings.length ? (
        <ul className="flex-1 space-y-3 px-5 pb-5">
          {findings.map((f) => {
            const style = SEVERITY[f.severity] || SEVERITY.info;
            return (
              <li key={f.id} className="flex gap-3">
                <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg', style.className)}><style.icon className="size-3.5" aria-hidden /></span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{f.title}</span>
                  <span className="line-clamp-2 text-xs text-muted">{f.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon={Sparkles} title="No insights yet" description="Insights appear once there are sales to analyse." className="py-8" />
      )}
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</div>
      <div className="grid gap-6 xl:grid-cols-3"><Skeleton className="h-80 xl:col-span-2" /><Skeleton className="h-80" /></div>
    </div>
  );
}

export default function DashboardPage() {
  useDocumentTitle('Dashboard');
  const user = useAuthStore((s) => s.user);
  const can = usePermission();
  const dashboard = useDashboard();
  const d = dashboard.data;
  const today = useMemo(() => nowInBusinessZone().toFormat('cccc, dd LLLL yyyy'), []);

  return (
    <div>
      <PageHeader title={`${greeting()}, ${user?.fullName?.split(' ')[0] || ''}`} description={today} actions={<QuickActions />} />
      {dashboard.isPending ? <DashboardSkeleton /> : dashboard.isError ? <ErrorState error={dashboard.error} onRetry={dashboard.refetch} /> : (
        <>
          {d.me ? <MyDay me={d.me} /> : null}
          {d.sales ? <SalesKpis sales={d.sales} finance={d.finance} /> : null}

          <div className="grid gap-6 xl:grid-cols-3">
            {d.sales ? <RevenueTrend trend={d.sales.trend} /> : null}
            {d.appointments ? <AppointmentsToday appointments={d.appointments} className={d.sales ? undefined : 'xl:col-span-2'} /> : null}

            {d.sales ? (
              <>
                <TopList title="Top services" rows={d.sales.topServices} nameKey="name" empty="No services sold this month" />
                <TopList title="Top stylists" rows={d.sales.topStaff} nameKey="name" empty="No services sold this month" />
                <PaymentMix rows={d.sales.paymentMix} />
                <RecentSales rows={d.sales.recent} />
              </>
            ) : null}

            <div className="space-y-6">
              {d.inventory ? <LowStock inventory={d.inventory} /> : null}
              {d.customers ? (
                <Card className="flex items-center gap-4 p-5">
                  <span className="flex size-11 items-center justify-center rounded-xl bg-gold-500/12 text-accent ring-1 ring-gold-500/20"><Users className="size-5" aria-hidden /></span>
                  <div className="flex-1">
                    <p className="text-sm text-muted">Customers</p>
                    <p className="text-xl font-semibold">{formatNumber(d.customers.total)}</p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold text-accent">+{formatNumber(d.customers.newThisMonth)}</p>
                    <p className="text-xs text-muted">new this month</p>
                  </div>
                </Card>
              ) : null}
              {d.customers ? <Birthdays customers={d.customers} /> : null}
            </div>
            {d.staff?.length ? <div className="xl:col-span-2"><StaffToday staff={d.staff} /></div> : null}
            {can('insights.view') ? <InsightsTeaser /> : null}
          </div>
          {!d.sales && !d.appointments && !d.me ? (
            <EmptyState icon={Sparkles} title="Welcome to ZOLA STYLISH MANAGEMENT SYSTEM" description="Use the menu to open the modules available to your role." />
          ) : null}
          <p className="mt-6 text-center text-xs text-muted">Updated {formatTime(d.generatedAt)} · refreshes every minute</p>
        </>
      )}
    </div>
  );
}
