import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { LogIn, LogOut, PencilLine } from 'lucide-react';
import { Avatar, Button, Card, DataTable, EmptyState, Input, Modal, Select, StatusBadge, Textarea } from '../../components/ui';
import { formatDate, formatTime, todayISO, toBusinessZone } from '../../utils/format';
import { usePermission } from '../../hooks';
import { employeeApi, useAttendance, useAttendanceToday } from './api';

function RecordModal({ open, onClose, preset }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(preset);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async () => {
    setBusy(true);
    try {
      await employeeApi.recordAttendance({ ...form, employeeId: Number(form.employeeId) });
      toast.success('Attendance saved');
      qc.invalidateQueries({ queryKey: ['attendance'] });
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };
  if (!form) return null;
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Record attendance" description={form.name}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Date" type="date" className="col-span-2" value={form.workDate} max={todayISO()} onChange={set('workDate')} />
        <Select
          label="Status"
          className="col-span-2"
          value={form.status}
          onChange={set('status')}
          options={[
            { value: 'present', label: 'Present' },
            { value: 'late', label: 'Late' },
            { value: 'half_day', label: 'Half day' },
            { value: 'absent', label: 'Absent' },
            { value: 'on_leave', label: 'On leave' },
          ]}
        />
        <Input label="Clock in" type="time" value={form.clockIn} onChange={set('clockIn')} />
        <Input label="Clock out" type="time" value={form.clockOut} onChange={set('clockOut')} />
        <Textarea label="Notes" rows={2} className="col-span-2" value={form.notes} onChange={set('notes')} />
      </div>
    </Modal>
  );
}

/** Today's staff board with clock in / out, plus attendance history. */
export function AttendancePanel() {
  const can = usePermission();
  const manage = can('attendance.manage');
  const qc = useQueryClient();
  const today = useAttendanceToday();
  const [range, setRange] = useState({ from: todayISO().slice(0, 8) + '01', to: todayISO() });
  const history = useAttendance(range);
  const [busyId, setBusyId] = useState(null);
  const [recording, setRecording] = useState(null);

  const act = async (fn, employeeId) => {
    setBusyId(employeeId);
    try {
      const res = await fn({ employeeId });
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['attendance'] });
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const hhmm = (value) => (value ? toBusinessZone(value).toFormat('HH:mm') : '');

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-semibold">Today · {formatDate(today.data?.date || todayISO(), 'cccc dd LLL')}</h2>
          <p className="text-sm text-muted">Clock staff in and out. Arrivals more than 15 minutes after their scheduled start are marked late.</p>
        </div>
        <DataTable
          loading={today.isPending}
          error={today.error}
          onRetry={today.refetch}
          rows={today.data?.employees}
          rowKey="employeeId"
          empty={<EmptyState title="No active staff" />}
          columns={[
            {
              key: 'fullName',
              header: 'Employee',
              primary: true,
              render: (e) => (
                <div className="flex items-center gap-3">
                  <Avatar name={e.fullName} src={e.photo} size="sm" />
                  <div><p className="font-medium">{e.fullName}</p><p className="text-xs text-muted">{e.jobTitle}</p></div>
                </div>
              ),
            },
            { key: 'schedule', header: 'Schedule', render: (e) => <span className={e.scheduled ? '' : 'text-muted'}>{e.scheduleNote}</span> },
            { key: 'clockIn', header: 'In', render: (e) => (e.clockIn ? formatTime(e.clockIn) : '—') },
            { key: 'clockOut', header: 'Out', render: (e) => (e.clockOut ? formatTime(e.clockOut) : '—') },
            { key: 'status', header: 'Status', render: (e) => (e.status ? <StatusBadge status={e.status} /> : <span className="text-xs text-muted">Not in yet</span>) },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (e) =>
                manage ? (
                  <div className="flex justify-end gap-1.5">
                    {!e.clockIn && e.status !== 'on_leave' ? <Button size="xs" icon={LogIn} loading={busyId === e.employeeId} onClick={() => act(employeeApi.clockIn, e.employeeId)}>Clock in</Button> : null}
                    {e.clockIn && !e.clockOut ? <Button size="xs" variant="secondary" icon={LogOut} loading={busyId === e.employeeId} onClick={() => act(employeeApi.clockOut, e.employeeId)}>Clock out</Button> : null}
                    <Button
                      size="xs"
                      variant="ghost"
                      icon={PencilLine}
                      onClick={() => setRecording({ employeeId: e.employeeId, name: e.fullName, workDate: today.data.date, status: e.status || 'present', clockIn: hhmm(e.clockIn), clockOut: hhmm(e.clockOut), notes: e.notes || '' })}
                    >
                      Edit
                    </Button>
                  </div>
                ) : null,
            },
          ]}
        />
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="font-semibold">Attendance history</h2>
          <div className="flex items-center gap-2">
            <input type="date" aria-label="From" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
            <span className="text-muted">–</span>
            <input type="date" aria-label="To" className="h-9 rounded-lg border border-line bg-surface px-2 text-sm" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
          </div>
        </div>
        <DataTable
          loading={history.isPending}
          error={history.error}
          onRetry={history.refetch}
          rows={history.data}
          empty={<EmptyState title="No attendance recorded in this period" />}
          columns={[
            { key: 'workDate', header: 'Date', render: (a) => formatDate(a.workDate, 'ccc dd LLL') },
            { key: 'employeeName', header: 'Employee', primary: true },
            { key: 'clockIn', header: 'In', render: (a) => (a.clockIn ? formatTime(a.clockIn) : '—') },
            { key: 'clockOut', header: 'Out', render: (a) => (a.clockOut ? formatTime(a.clockOut) : '—') },
            { key: 'minutesWorked', header: 'Hours', align: 'right', render: (a) => (a.minutesWorked ? (a.minutesWorked / 60).toFixed(1) : '—') },
            { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
          ]}
        />
      </Card>
      <RecordModal key={recording ? `${recording.employeeId}-${recording.workDate}` : 'closed'} open={Boolean(recording)} onClose={() => setRecording(null)} preset={recording} />
    </div>
  );
}
