import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Clock, Search, Users } from 'lucide-react';
import { Avatar, Button, Modal, Select, Spinner, Textarea } from '../../components/ui';
import { cn } from '../../utils/cn';
import { formatDuration, formatMoney, formatTime, localToISO, todayISO, toBusinessZone } from '../../utils/format';
import { CustomerPicker } from '../customers/CustomerPicker';
import { useEmployeeOptions, useServices } from '../services/api';
import { appointmentApi, appointmentKeys, useAvailability } from './api';

const SOURCES = [
  { value: 'phone', label: 'Phone call' },
  { value: 'walk_in', label: 'Walk-in' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'online', label: 'Online' },
  { value: 'other', label: 'Other' },
];

function initialState(appointment, preset) {
  if (appointment) {
    const start = toBusinessZone(appointment.startTime);
    return {
      customer: { id: appointment.customerId, fullName: appointment.customerName, phone: appointment.customerPhone, code: appointment.customerCode },
      serviceIds: appointment.services.map((s) => s.serviceId),
      employeeIds: appointment.staff?.length ? appointment.staff.map((m) => m.id) : [appointment.employeeId],
      date: start.toISODate(),
      time: start.toFormat('HH:mm'),
      source: appointment.source,
      status: appointment.status,
      notes: appointment.notes || '',
    };
  }
  return {
    customer: preset?.customer || null,
    serviceIds: [],
    employeeIds: preset?.employeeId ? [preset.employeeId] : [],
    date: preset?.date || todayISO(),
    time: preset?.time || null,
    source: 'phone',
    status: 'confirmed',
    notes: '',
  };
}

/** Create or edit an appointment with server-checked availability. */
export function AppointmentFormModal({ open, onClose, appointment, preset, onSaved }) {
  const isEdit = Boolean(appointment);
  const qc = useQueryClient();
  const [form, setForm] = useState(() => initialState(appointment, preset));
  const [serviceSearch, setServiceSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const [showAllStaff, setShowAllStaff] = useState(false);
  const services = useServices({ status: 'active' }, { enabled: open });
  const employees = useEmployeeOptions({ bookable: true }, { enabled: open });

  useEffect(() => {
    if (open) {
      setForm(initialState(appointment, preset));
      setErrors({});
      setServiceSearch('');
      setShowAllStaff(false);
    }
  }, [open, appointment, preset]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const selectedServices = useMemo(() => (services.data || []).filter((s) => form.serviceIds.includes(s.id)), [services.data, form.serviceIds]);
  const totalDuration = selectedServices.reduce((sum, s) => sum + s.durationMinutes, 0);
  const totalPrice = selectedServices.reduce((sum, s) => sum + Number(s.price), 0);

  // Staff who perform at least one chosen service (or everyone, for helpers).
  const performsAny = (e) => form.serviceIds.some((id) => e.serviceIds.includes(id));
  const eligible = useMemo(
    () => (employees.data || []).filter((e) => showAllStaff || performsAny(e) || form.employeeIds.includes(e.id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [employees.data, form.serviceIds, showAllStaff, form.employeeIds],
  );
  const team = form.employeeIds.map((id) => (employees.data || []).find((e) => e.id === id)).filter(Boolean);
  // Each service needs someone in the team who performs it.
  const uncovered = selectedServices.filter((s) => team.length && !team.some((e) => e.serviceIds.includes(s.id)));
  const toggleStaff = (id) => set({ employeeIds: form.employeeIds.includes(id) ? form.employeeIds.filter((x) => x !== id) : [...form.employeeIds, id], time: null });

  const availability = useAvailability(
    { employeeIds: form.employeeIds, date: form.date, serviceIds: form.serviceIds, excludeId: appointment?.id },
    open && Boolean(form.employeeIds.length && form.date && form.serviceIds.length),
  );

  const toggleService = (id) => {
    set({ serviceIds: form.serviceIds.includes(id) ? form.serviceIds.filter((x) => x !== id) : [...form.serviceIds, id], time: null });
  };

  const filteredServices = (services.data || []).filter((s) => !serviceSearch || s.name.toLowerCase().includes(serviceSearch.toLowerCase()));
  const grouped = filteredServices.reduce((acc, s) => {
    (acc[s.categoryName] = acc[s.categoryName] || []).push(s);
    return acc;
  }, {});

  const submit = async () => {
    const next = {};
    if (!form.customer) next.customer = 'Choose a customer';
    if (!form.serviceIds.length) next.services = 'Choose at least one service';
    if (!form.employeeIds.length) next.employee = 'Choose who will do it';
    else if (uncovered.length) next.employee = `Nobody chosen performs ${uncovered.map((s) => s.name).join(', ')}`;
    if (!form.time) next.time = 'Choose a time';
    setErrors(next);
    if (Object.keys(next).length) return;

    setSaving(true);
    const body = {
      customerId: form.customer.id,
      employeeIds: form.employeeIds,
      serviceIds: form.serviceIds,
      startTime: localToISO(form.date, form.time),
      notes: form.notes || null,
      source: form.source,
      ...(isEdit ? {} : { status: form.status }),
    };
    try {
      const res = isEdit ? await appointmentApi.update(appointment.id, body) : await appointmentApi.create(body);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: appointmentKeys.all });
      onSaved?.(res.data);
      onClose();
    } catch (error) {
      toast.error(error.message);
      if (error.status === 409) availability.refetch();
      const fieldErrors = {};
      for (const e of error.errors || []) {
        if (e.field === 'startTime') fieldErrors.time = e.message;
        if (e.field === 'serviceIds') fieldErrors.services = e.message;
        if (e.field === 'employeeId' || e.field === 'employeeIds') fieldErrors.employee = e.message;
        if (e.field === 'customerId') fieldErrors.customer = e.message;
      }
      setErrors(fieldErrors);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={isEdit ? `Edit ${appointment.code}` : 'New appointment'}
      description="Availability is checked live against staff schedules, leave and existing bookings."
      footer={
        <>
          <div className="mr-auto hidden text-sm text-muted sm:block">
            {selectedServices.length ? <>Total <span className="font-semibold text-fg">{formatMoney(totalPrice)}</span> · {formatDuration(totalDuration)}</> : null}
          </div>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={saving}>{isEdit ? 'Save changes' : 'Book appointment'}</Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left: who and what */}
        <div className="space-y-5">
          <CustomerPicker value={form.customer} onChange={(customer) => set({ customer })} error={errors.customer} />

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-sm font-medium">Services</p>
              {selectedServices.length ? <span className="text-xs text-muted">{selectedServices.length} selected · {formatDuration(totalDuration)}</span> : null}
            </div>
            <div className="rounded-xl border border-line">
              <div className="relative border-b border-line">
                <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <input value={serviceSearch} onChange={(e) => setServiceSearch(e.target.value)} placeholder="Filter services…" aria-label="Filter services" className="h-10 w-full rounded-t-xl bg-transparent pr-3 pl-9 text-sm focus:outline-none" />
              </div>
              <div className="scrollbar-thin max-h-64 overflow-y-auto p-1.5">
                {services.isPending ? <Spinner className="m-4" /> : null}
                {Object.entries(grouped).map(([category, list]) => (
                  <div key={category} className="mb-1">
                    <p className="px-2 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-muted uppercase">{category}</p>
                    {list.map((s) => {
                      const checked = form.serviceIds.includes(s.id);
                      return (
                        <label key={s.id} className={cn('flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2', checked ? 'bg-brand-500/10' : 'hover:bg-surface-2')}>
                          <input type="checkbox" className="size-4 accent-brand-500" checked={checked} onChange={() => toggleService(s.id)} />
                          <span className="flex-1 text-sm">{s.name}</span>
                          <span className="text-xs text-muted">{formatDuration(s.durationMinutes)}</span>
                          <span className="w-24 text-right text-sm font-medium">{formatMoney(s.price)}</span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            {errors.services ? <p className="mt-1 text-xs text-danger" role="alert">{errors.services}</p> : null}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select label="Booked via" value={form.source} onChange={(e) => set({ source: e.target.value })} options={SOURCES} />
            {!isEdit ? (
              <Select label="Status" value={form.status} onChange={(e) => set({ status: e.target.value })} options={[{ value: 'confirmed', label: 'Confirmed' }, { value: 'pending', label: 'Pending confirmation' }]} />
            ) : null}
          </div>
          <Textarea label="Notes" rows={2} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Style reference, special requests…" />
        </div>

        {/* Right: who and when */}
        <div className="space-y-5">
          <div>
            <label htmlFor="appointment-date" className="mb-1.5 block text-sm font-medium">Date</label>
            <input id="appointment-date" type="date" min={isEdit ? undefined : todayISO()} value={form.date} onChange={(e) => set({ date: e.target.value, time: null })}
              className="h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none" />
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Staff</p>
              {form.serviceIds.length ? (
                <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setShowAllStaff((v) => !v)}>
                  {showAllStaff ? 'Only staff who do these services' : 'Show all staff (helpers)'}
                </button>
              ) : null}
            </div>
            {!form.serviceIds.length ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Choose services to see who can perform them.</p>
            ) : !eligible.length ? (
              <p className="rounded-xl border border-dashed border-amber-500/40 px-4 py-6 text-center text-sm text-warning">Nobody performs the selected services. Assign them under Services, or show all staff.</p>
            ) : (
              <>
                <p className="mb-2 text-xs text-muted">Choose one person, or several for a service done together. Everyone chosen is booked for the whole time, and the commission is shared equally.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {eligible.map((e) => {
                    const position = form.employeeIds.indexOf(e.id);
                    const selected = position !== -1;
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => toggleStaff(e.id)}
                        aria-pressed={selected}
                        className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left', selected ? 'border-brand-500 bg-brand-500/10' : 'border-line hover:border-brand-500/40')}
                      >
                        <Avatar name={e.fullName} src={e.photo} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-sm font-medium"><span className="size-2 rounded-full" style={{ background: e.calendarColor }} aria-hidden />{e.fullName}</span>
                          <span className="block truncate text-xs text-muted">{performsAny(e) ? e.jobTitle : 'Helper'}</span>
                        </span>
                        {selected && form.employeeIds.length > 1 ? (
                          <span className="shrink-0 rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">{position === 0 ? 'Lead' : `+${position}`}</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
                {team.length > 1 ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-accent"><Users className="size-3.5" aria-hidden />{team.length} people · commission shared equally</p>
                ) : null}
              </>
            )}
            {errors.employee ? <p className="mt-1 text-xs text-danger" role="alert">{errors.employee}</p> : null}
            {!errors.employee && uncovered.length ? <p className="mt-1 text-xs text-warning" role="status">Nobody chosen performs {uncovered.map((s) => s.name).join(', ')}.</p> : null}
          </div>

          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><Clock className="size-4 text-muted" /> Time</p>
            {!form.employeeIds.length ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Choose staff to see free times.</p>
            ) : availability.isPending || availability.isFetching ? (
              <div className="flex justify-center py-6"><Spinner /></div>
            ) : availability.isError ? (
              <p className="text-sm text-danger">{availability.error.message}</p>
            ) : !availability.data.working ? (
              <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">Not available: {availability.data.reason}.</p>
            ) : (
              <div className="grid max-h-60 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-5" role="radiogroup" aria-label="Available times">
                {availability.data.slots.map((slot) => {
                  const time = toBusinessZone(slot.start).toFormat('HH:mm');
                  const selected = form.time === time;
                  return (
                    <button
                      key={slot.start}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      disabled={!slot.available}
                      onClick={() => set({ time })}
                      className={cn(
                        'rounded-lg border px-1 py-2 text-sm tabular-nums',
                        selected ? 'border-brand-500 bg-brand-500 font-semibold text-white' : slot.available ? 'border-line hover:border-brand-500/50' : 'cursor-not-allowed border-transparent bg-surface-2 text-muted/50 line-through',
                      )}
                    >
                      {formatTime(slot.start)}
                    </button>
                  );
                })}
              </div>
            )}
            {errors.time ? <p className="mt-1 text-xs text-danger" role="alert">{errors.time}</p> : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}
