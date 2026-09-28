import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Camera, Mail, Pencil, Phone, Save, Trash2 } from 'lucide-react';
import {
  Avatar, Badge, Button, Card, ConfirmDialog, Detail, ErrorState, IconButton, SkeletonRows, StatCard, StatusBadge, Tabs,
} from '../../components/ui';
import { ChartCard } from '../../components/charts/ChartCard';
import { RankedBarChart, TimeSeriesChart } from '../../components/charts/Charts';
import { formatDate, formatDuration, formatMoney, formatNumber, todayISO } from '../../utils/format';
import { usePermission, useDocumentTitle } from '../../hooks';
import { cn } from '../../utils/cn';
import { useServices } from '../services/api';
import { employeeApi, employeeKeys, useEmployee, useEmployeePerformance } from './api';
import { EmployeeFormModal } from './EmployeeFormModal';
import { ScheduleEditor } from './ScheduleEditor';
import { LeavePanel } from './LeavePanel';
import { PayrollPanel } from './PayrollPanel';

const RANGES = [
  { value: 'month', label: 'This month' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'quarter', label: 'Last 90 days' },
];

function rangeFor(key) {
  const today = todayISO();
  const d = new Date(`${today}T00:00:00Z`);
  const back = (days) => new Date(d.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  if (key === 'last30') return { from: back(29), to: today };
  if (key === 'quarter') return { from: back(89), to: today };
  return { from: `${today.slice(0, 8)}01`, to: today };
}

function PerformancePanel({ employeeId }) {
  const [rangeKey, setRangeKey] = useState('month');
  const range = useMemo(() => rangeFor(rangeKey), [rangeKey]);
  const perf = useEmployeePerformance(employeeId, range);
  const p = perf.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Date range">
        {RANGES.map((r) => (
          <button key={r.value} type="button" role="radio" aria-checked={rangeKey === r.value} onClick={() => setRangeKey(r.value)}
            className={cn('rounded-full border px-3 py-1.5 text-sm', rangeKey === r.value ? 'border-gold-500/50 bg-gold-500/10 text-fg' : 'border-line text-muted hover:text-fg')}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Revenue generated" value={formatMoney(p?.revenue)} loading={perf.isPending} caption={`${formatNumber(p?.servicesCompleted)} services`} />
        <StatCard label="Commission earned" value={formatMoney(p?.commissionEarned)} loading={perf.isPending} caption={`${formatMoney(p?.commissionPaid)} paid out`} />
        <StatCard label="Customers served" value={formatNumber(p?.customersServed)} loading={perf.isPending} caption={`Avg ${formatMoney(p?.averageServiceValue)} per service`} />
        <StatCard
          label="Attendance"
          value={`${formatNumber(p?.attendance?.daysPresent)} days`}
          loading={perf.isPending}
          caption={`${p?.attendance?.daysLate || 0} late · ${p?.attendance?.hoursWorked || 0} h worked`}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <ChartCard
          title="Revenue by day"
          description={`${formatDate(range.from)} – ${formatDate(range.to)}`}
          loading={perf.isPending}
          fetching={perf.isFetching}
          error={perf.error}
          onRetry={perf.refetch}
          isEmpty={!p?.daily?.length}
          table={{
            columns: [
              { key: 'date', header: 'Date', format: (v) => formatDate(v) },
              { key: 'services', header: 'Services', align: 'right' },
              { key: 'revenue', header: 'Revenue', align: 'right', format: (v) => formatMoney(v) },
            ],
            rows: p?.daily || [],
          }}
        >
          <TimeSeriesChart
            data={p?.daily || []}
            series={[{ key: 'revenue', label: 'Revenue' }]}
            formatX={(v) => formatDate(v, 'dd LLL')}
            formatValue={(v, key) => (key === 'axis' ? formatMoney(v, { compact: true }) : formatMoney(v))}
          />
        </ChartCard>
        <ChartCard
          title="Top services"
          description="By revenue"
          loading={perf.isPending}
          error={perf.error}
          isEmpty={!p?.topServices?.length}
          table={{
            columns: [
              { key: 'name', header: 'Service' },
              { key: 'count', header: 'Times', align: 'right' },
              { key: 'revenue', header: 'Revenue', align: 'right', format: (v) => formatMoney(v) },
            ],
            rows: p?.topServices || [],
          }}
        >
          <RankedBarChart data={p?.topServices || []} valueKey="revenue" label="Revenue" formatValue={(v) => formatMoney(v, { compact: true })} />
        </ChartCard>
      </div>

      <Card className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <Detail label="Appointments">{formatNumber(p?.appointments?.total)}</Detail>
        <Detail label="Completed">{formatNumber(p?.appointments?.completed)}</Detail>
        <Detail label="Cancelled">{formatNumber(p?.appointments?.cancelled)}</Detail>
        <Detail label="No-shows">{formatNumber(p?.appointments?.noShow)}</Detail>
      </Card>
    </div>
  );
}

function ServicesPanel({ employee, canEdit }) {
  const services = useServices({ status: 'active' });
  const qc = useQueryClient();
  const [selected, setSelected] = useState(() => new Set(employee.services.map((s) => s.id)));
  const [saving, setSaving] = useState(false);
  useEffect(() => setSelected(new Set(employee.services.map((s) => s.id))), [employee.services]);

  const toggle = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      await employeeApi.saveServices(employee.id, [...selected]);
      toast.success('Services updated');
      qc.invalidateQueries({ queryKey: employeeKeys.detail(employee.id) });
      qc.invalidateQueries({ queryKey: ['services'] });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <div>
          <h2 className="font-semibold">Services performed</h2>
          <p className="text-sm text-muted">{selected.size} selected — only these can be booked with {employee.fullName.split(' ')[0]}.</p>
        </div>
        {canEdit ? <Button size="sm" icon={Save} loading={saving} onClick={save}>Save</Button> : null}
      </div>
      {services.isPending ? (
        <SkeletonRows rows={4} className="p-5" />
      ) : (
        <div className="grid gap-2 p-5 sm:grid-cols-2 xl:grid-cols-3">
          {services.data.map((s) => (
            <label key={s.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5', selected.has(s.id) ? 'border-gold-500/50 bg-gold-500/5' : 'border-line')}>
              <input type="checkbox" className="size-4 accent-gold-500" disabled={!canEdit} checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate font-medium">{s.name}</span>
                <span className="block text-xs text-muted">{s.categoryName} · {formatDuration(s.durationMinutes)} · {formatMoney(s.price)}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function EmployeeProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = usePermission();
  const qc = useQueryClient();
  const employee = useEmployee(id);
  useDocumentTitle(employee.data?.fullName || 'Employee');
  const [tab, setTab] = useState('performance');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const photoInput = useRef(null);
  const manage = can('employees.manage');

  if (employee.isPending) return <SkeletonRows rows={8} />;
  if (employee.isError) return <ErrorState error={employee.error} onRetry={employee.refetch} />;
  const e = employee.data;

  const tabs = [
    { value: 'performance', label: 'Performance' },
    { value: 'schedule', label: 'Schedule' },
    { value: 'services', label: 'Services', count: e.services.length },
    ...(can(['leave.manage', 'employees.view']) ? [{ value: 'leave', label: 'Leave' }] : []),
    ...(can('payroll.manage') ? [{ value: 'payroll', label: 'Salary & commission' }] : []),
  ];

  const uploadPhoto = async (file) => {
    if (!file) return;
    try {
      await employeeApi.uploadPhoto(e.id, file);
      qc.invalidateQueries({ queryKey: employeeKeys.detail(e.id) });
      toast.success('Photo updated');
    } catch (err) {
      toast.error(err.errors?.[0]?.message || err.message);
    }
  };

  const remove = async () => {
    try {
      const res = await employeeApi.remove(e.id);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: employeeKeys.all });
      navigate('/employees', { replace: true });
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div>
      <Link to="/employees" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Employees
      </Link>
      <Card className="mb-6 flex flex-col gap-5 p-5 sm:flex-row sm:items-center sm:p-6">
        <div className="relative w-fit">
          <Avatar name={e.fullName} src={e.photo} size="xl" />
          {manage ? (
            <>
              <button type="button" onClick={() => photoInput.current?.click()} className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full bg-gold-500 text-ink-950 ring-2 ring-surface" aria-label="Change photo">
                <Camera className="size-4" />
              </button>
              <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(ev) => uploadPhoto(ev.target.files?.[0])} />
            </>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-semibold sm:text-3xl">{e.fullName}</h1>
            <StatusBadge status={e.status} />
            {e.isDemo ? <Badge tone="pink">Demo</Badge> : null}
          </div>
          <p className="mt-1 flex items-center gap-2 text-sm text-muted">
            <span className="size-2.5 rounded-full" style={{ background: e.calendarColor }} aria-hidden /> {e.jobTitle} · {e.code} · {e.branchName}
          </p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
            {e.phone ? <a href={`tel:${e.phone}`} className="inline-flex items-center gap-1.5 hover:text-fg"><Phone className="size-3.5" />{e.phone}</a> : null}
            {e.email ? <a href={`mailto:${e.email}`} className="inline-flex items-center gap-1.5 hover:text-fg"><Mail className="size-3.5" />{e.email}</a> : null}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-4 sm:w-64">
          <Detail label="Commission">{e.commissionRate}%</Detail>
          <Detail label="Since">{formatDate(e.employmentDate)}</Detail>
          {can(['employees.manage', 'payroll.manage']) ? <Detail label="Salary">{formatMoney(e.salary)}</Detail> : null}
          <Detail label="Login">{e.userEmail ? e.userRole : 'None'}</Detail>
        </dl>
        {manage ? (
          <div className="flex gap-2 sm:flex-col">
            <IconButton icon={Pencil} label="Edit employee" variant="secondary" onClick={() => setEditing(true)} />
            <IconButton icon={Trash2} label="Remove employee" variant="secondary" className="text-danger" onClick={() => setDeleting(true)} />
          </div>
        ) : null}
      </Card>

      <Tabs className="mb-5" tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'performance' ? <PerformancePanel employeeId={e.id} /> : null}
      {tab === 'schedule' ? <ScheduleEditor employeeId={e.id} schedule={e.schedule} canEdit={manage} /> : null}
      {tab === 'services' ? <ServicesPanel employee={e} canEdit={manage} /> : null}
      {tab === 'leave' ? <LeavePanel employeeId={e.id} /> : null}
      {tab === 'payroll' ? <PayrollPanel employee={e} /> : null}

      <EmployeeFormModal open={editing} onClose={() => setEditing(false)} employee={e} />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={remove}
        danger
        title={`Remove ${e.fullName}?`}
        message="Employees with appointments, sales or attendance history are marked as terminated instead of deleted."
        confirmLabel="Remove"
      />
    </div>
  );
}
