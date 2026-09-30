import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, ScanLine } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, ErrorState, IconButton, PageHeader, Pagination, SearchInput, Segmented, SkeletonRows, StatusBadge } from '../../components/ui';
import { formatDateTime, formatMoney, todayISO, toBusinessZone } from '../../utils/format';
import { http } from '../../api/client';
import { useMediaQuery, usePermission, useSettings, useDocumentTitle } from '../../hooks';
import { useAuthStore } from '../../store/authStore';
import { useEmployeeOptions } from '../services/api';
import { appointmentApi, appointmentKeys, useAppointmentList, useCalendar } from './api';
import { EDITABLE_STATUSES, dt, localDateOf, rangeForView, shiftDate, staffNames, titleForView, visibleHours } from './calendarUtils';
import { TimeGrid } from './TimeGrid';
import { MonthView } from './MonthView';
import { AgendaView, DateStrip } from './AgendaView';
import { AppointmentFormModal } from './AppointmentFormModal';
import { AppointmentDrawer } from './AppointmentDrawer';
import { CheckInModal } from './CheckInModal';

const VIEWS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'list', label: 'List' },
];

function ListView({ employeeId, onOpen }) {
  const [params, setParams] = useState({ page: 1, limit: 20, search: '', status: '', from: '', to: '' });
  const list = useAppointmentList({ ...params, employeeId });
  return (
    <>
      <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center">
        <SearchInput placeholder="Code, customer or phone…" className="lg:w-72" onChange={(search) => setParams((p) => ({ ...p, search, page: 1 }))} />
        <select aria-label="Status" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={params.status} onChange={(e) => setParams((p) => ({ ...p, status: e.target.value, page: 1 }))}>
          <option value="">Any status</option>
          {['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input type="date" aria-label="From" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={params.from} onChange={(e) => setParams((p) => ({ ...p, from: e.target.value, page: 1 }))} />
          <span className="text-muted">–</span>
          <input type="date" aria-label="To" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={params.to} onChange={(e) => setParams((p) => ({ ...p, to: e.target.value, page: 1 }))} />
        </div>
      </div>
      <DataTable
        rows={list.data?.data}
        loading={list.isPending}
        error={list.error}
        onRetry={list.refetch}
        onRowClick={(a) => onOpen(a.id)}
        empty={<EmptyState icon={CalendarDays} title="No appointments found" />}
        columns={[
          { key: 'startTime', header: 'When', primary: true, render: (a) => <div><p className="font-medium">{formatDateTime(a.startTime)}</p><p className="text-xs text-muted">{a.code}</p></div> },
          { key: 'customerName', header: 'Customer', render: (a) => <div><p>{a.customerName}</p><p className="text-xs text-muted">{a.customerPhone}</p></div> },
          { key: 'services', header: 'Services', render: (a) => <span className="line-clamp-1">{a.services}</span> },
          { key: 'employeeName', header: 'Staff', render: (a) => <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: a.employeeColor }} />{staffNames(a, { full: a.staff?.length <= 1 })}</span> },
          { key: 'totalPrice', header: 'Value', align: 'right', render: (a) => formatMoney(a.totalPrice) },
          { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
        ]}
      />
      <Pagination pagination={list.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
    </>
  );
}

export default function AppointmentsPage() {
  useDocumentTitle('Appointments');
  const can = usePermission();
  const settings = useSettings();
  const qc = useQueryClient();
  const isPhone = useMediaQuery('(max-width: 767px)');
  const ownEmployeeId = useAuthStore((s) => s.user?.employeeId);
  const [searchParams, setSearchParams] = useSearchParams();

  const [view, setView] = useState('day');
  const [date, setDate] = useState(todayISO());
  const [employeeId, setEmployeeId] = useState('');
  const [showCancelled, setShowCancelled] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [form, setForm] = useState({ open: false, appointment: null, preset: null });
  const [checkInOpen, setCheckInOpen] = useState(false);

  const employees = useEmployeeOptions({ bookable: true });
  const range = useMemo(() => rangeForView(view === 'list' ? 'day' : view, date), [view, date]);
  const calendarParams = { ...range, ...(employeeId ? { employeeId } : {}), ...(showCancelled ? {} : { status: 'pending,confirmed,in_progress,completed,no_show' }) };
  const calendar = useCalendar(calendarParams, { enabled: view !== 'list' });
  const events = useMemo(() => calendar.data || [], [calendar.data]);
  const hours = useMemo(() => visibleHours(settings.system?.business_hours), [settings.system?.business_hours]);
  const slotMinutes = settings.system?.slot_interval_minutes || 15;

  // Deep links: ?appointment=12 opens the drawer; ?new=1&customer=5 opens the form; ?checkin=1 opens the scanner.
  useEffect(() => {
    const appointment = Number(searchParams.get('appointment'));
    if (appointment) setOpenId(appointment);
    if (searchParams.get('new') && can('appointments.create')) {
      const customerId = Number(searchParams.get('customer'));
      if (customerId) {
        http
          .get(`/customers/${customerId}`)
          .then((r) => setForm({ open: true, appointment: null, preset: { customer: r.data, date: todayISO() } }))
          .catch((e) => toast.error(e.message));
      } else {
        setForm({ open: true, appointment: null, preset: { date: todayISO() } });
      }
    }
    if (searchParams.get('checkin') && can('appointments.checkin')) setCheckInOpen(true);
    if (appointment || searchParams.get('new') || searchParams.get('checkin')) setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams, can]);

  const canDrag = useCallback((event) => can('appointments.update') && EDITABLE_STATUSES.includes(event.status), [can]);

  const visibleEmployees = useMemo(() => {
    const list = employees.data || [];
    if (!can('appointments.view') && ownEmployeeId) return list.filter((e) => e.id === ownEmployeeId);
    return employeeId ? list.filter((e) => e.id === Number(employeeId)) : list;
  }, [employees.data, employeeId, can, ownEmployeeId]);

  const columns = useMemo(() => {
    if (view === 'day') {
      return visibleEmployees.map((e) => ({ id: `emp-${e.id}`, employeeId: e.id, date, title: e.fullName.split(' ')[0], subtitle: e.jobTitle, color: e.calendarColor }));
    }
    const { from } = rangeForView('week', date);
    const today = todayISO();
    return Array.from({ length: 7 }, (_, i) => {
      const d = dt(from).plus({ days: i });
      const day = settings.system?.business_hours?.[String(d.weekday % 7)];
      return { id: `day-${d.toISODate()}`, date: d.toISODate(), title: d.toFormat('ccc'), subtitle: d.toFormat('dd LLL'), highlight: d.toISODate() === today, closed: day && !day.open };
    });
  }, [view, visibleEmployees, date, settings.system?.business_hours]);

  // In the day view an appointment done by several people shows in each person's column.
  const gridEvents = useMemo(
    () => (view === 'day'
      ? events.flatMap((e) => (e.staff?.length ? e.staff : [{ id: e.employeeId }]).map((m) => ({ ...e, columnEmployeeId: m.id, slotKey: `${e.id}-${m.id}` })))
      : events),
    [events, view],
  );
  const eventColumn = useCallback((e) => (view === 'day' ? `emp-${e.columnEmployeeId ?? e.employeeId}` : `day-${localDateOf(e.startTime)}`), [view]);

  /** Drag-and-drop: compute the new start, update optimistically, then save. */
  const onMove = async ({ event, column, minutesDelta }) => {
    const start = toBusinessZone(event.startTime);
    const target = column.date ? dt(column.date).set({ hour: start.hour, minute: start.minute }) : start;
    const newStart = target.plus({ minutes: minutesDelta });
    const duration = new Date(event.endTime) - new Date(event.startTime);
    // Dropping in another person's column moves this person's part to them; the rest of the team stays.
    const fromEmployeeId = event.columnEmployeeId;
    const toEmployeeId = column.employeeId && column.employeeId !== fromEmployeeId ? column.employeeId : null;
    const key = appointmentKeys.calendar(calendarParams);
    const previous = qc.getQueryData(key);
    const movedTo = (employees.data || []).find((e) => e.id === toEmployeeId);
    qc.setQueryData(key, (list = []) =>
      list.map((e) => {
        if (e.id !== event.id) return e;
        const staff = toEmployeeId && movedTo
          ? (e.staff || []).map((m) => (m.id === fromEmployeeId ? { id: movedTo.id, fullName: movedTo.fullName, color: movedTo.calendarColor } : m))
          : e.staff;
        return { ...e, startTime: newStart.toUTC().toISO(), endTime: new Date(newStart.toMillis() + duration).toISOString(), staff };
      }),
    );
    try {
      await appointmentApi.reschedule(event.id, { startTime: newStart.toISO(), ...(toEmployeeId ? { employeeId: toEmployeeId, fromEmployeeId } : {}) });
      toast.success(`${event.code} moved to ${newStart.toFormat('ccc dd LLL, HH:mm')}${toEmployeeId ? ` — ${movedTo?.fullName || 'new staff member'} takes over` : ''}`);
    } catch (error) {
      qc.setQueryData(key, previous);
      toast.error(error.message);
    } finally {
      qc.invalidateQueries({ queryKey: appointmentKeys.all });
    }
  };

  const onSlotClick = can('appointments.create')
    ? (column, time) => setForm({ open: true, appointment: null, preset: { employeeId: column.employeeId || null, date: column.date, time } })
    : undefined;

  const effectiveView = isPhone && (view === 'day' || view === 'week') ? 'agenda' : view;

  let content;
  if (view === 'list') {
    content = <ListView employeeId={employeeId || undefined} onOpen={setOpenId} />;
  } else if (calendar.isPending) {
    content = <SkeletonRows rows={8} className="p-4" />;
  } else if (calendar.isError) {
    content = <ErrorState error={calendar.error} onRetry={calendar.refetch} />;
  } else if (effectiveView === 'agenda') {
    content = <AgendaView date={date} events={events} onEventClick={(e) => setOpenId(e.id)} canCreate={can('appointments.create')} onCreate={() => setForm({ open: true, appointment: null, preset: { date } })} />;
  } else if (effectiveView === 'month') {
    content = <MonthView date={date} events={events} onEventClick={(e) => setOpenId(e.id)} onDayClick={(d) => { setDate(d); setView('day'); }} />;
  } else if (!columns.length) {
    content = <EmptyState icon={CalendarDays} title="No bookable staff" description="Add employees who take appointments and assign them services." />;
  } else {
    content = (
      <TimeGrid
        columns={columns}
        events={gridEvents}
        hours={hours}
        slotMinutes={slotMinutes}
        eventColumn={eventColumn}
        canDrag={canDrag}
        onEventClick={(e) => setOpenId(e.id)}
        onMove={onMove}
        onSlotClick={onSlotClick}
        onMoreClick={(column) => {
          setDate(column.date);
          setView('day');
        }}
      />
    );
  }

  const dayCount = view === 'day' ? events.filter((e) => localDateOf(e.startTime) === date && e.status !== 'cancelled').length : null;

  return (
    <div>
      <PageHeader
        title="Appointments"
        description={dayCount !== null && !calendar.isPending ? `${dayCount} appointment${dayCount === 1 ? '' : 's'} on ${dt(date).toFormat('cccc dd LLL')}` : 'Schedule, check in and manage bookings.'}
        actions={
          <>
            {can('appointments.checkin') ? <Button variant="secondary" icon={ScanLine} onClick={() => setCheckInOpen(true)}>Check in</Button> : null}
            {can('appointments.create') ? <Button icon={Plus} onClick={() => setForm({ open: true, appointment: null, preset: { date } })}>New appointment</Button> : null}
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line p-3 sm:p-4 lg:flex-row lg:items-center">
          {view !== 'list' ? (
            <div className="flex items-center gap-1">
              <IconButton icon={ChevronLeft} label="Previous" variant="secondary" size="sm" onClick={() => setDate(shiftDate(effectiveView === 'agenda' ? 'day' : view, date, -1))} />
              <Button size="sm" variant="secondary" onClick={() => setDate(todayISO())}>Today</Button>
              <IconButton icon={ChevronRight} label="Next" variant="secondary" size="sm" onClick={() => setDate(shiftDate(effectiveView === 'agenda' ? 'day' : view, date, 1))} />
              <h2 className="ml-2 truncate text-base font-semibold whitespace-nowrap">{isPhone ? dt(date).toFormat(view === 'month' ? 'LLL yyyy' : 'ccc dd LLL') : titleForView(view, date)}</h2>
              {calendar.isFetching && !calendar.isPending ? <span className="ml-2 size-2 animate-pulse rounded-full bg-brand-500" aria-label="Updating" /> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            {can('appointments.view') ? (
              <select aria-label="Filter by stylist" className="h-9 rounded-xl border border-line bg-surface px-3 text-sm" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
                <option value="">All stylists</option>
                {(employees.data || []).map((e) => <option key={e.id} value={e.id}>{e.fullName}</option>)}
              </select>
            ) : null}
            {view !== 'list' ? (
              <label className="flex items-center gap-2 text-sm text-muted">
                <input type="checkbox" className="size-4 accent-brand-500" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
                Show cancelled
              </label>
            ) : null}
            <Segmented options={VIEWS} value={view} onChange={setView} size="sm" />
          </div>
        </div>
        {effectiveView === 'agenda' ? <div className="border-b border-line p-3"><DateStrip date={date} onChange={setDate} /></div> : null}
        {content}
      </Card>

      {view !== 'list' && effectiveView !== 'agenda' && can('appointments.update') ? (
        <p className="mt-3 text-xs text-muted">Tip: drag an appointment to move it to another time or stylist. Click an empty slot to book.</p>
      ) : null}

      <AppointmentDrawer appointmentId={openId} onClose={() => setOpenId(null)} onEdit={(a) => { setOpenId(null); setForm({ open: true, appointment: a, preset: null }); }} />
      <AppointmentFormModal
        open={form.open}
        appointment={form.appointment}
        preset={form.preset}
        onClose={() => setForm((f) => ({ ...f, open: false }))}
        onSaved={(a) => {
          setDate(localDateOf(a.startTime));
          setOpenId(a.id);
        }}
      />
      <CheckInModal open={checkInOpen} onClose={() => setCheckInOpen(false)} />
    </div>
  );
}

