import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Check, Plus, X } from 'lucide-react';
import { Button, Card, DataTable, EmptyState, IconButton, Input, Modal, Select, StatusBadge, Textarea } from '../../components/ui';
import { formatDate, titleCase, todayISO } from '../../utils/format';
import { usePermission } from '../../hooks';
import { useEmployeeOptions } from '../services/api';
import { employeeApi, useLeave } from './api';

const TYPES = ['annual', 'sick', 'maternity', 'paternity', 'unpaid', 'other'].map((t) => ({ value: t, label: titleCase(t) }));

function LeaveModal({ open, onClose, employeeId }) {
  const can = usePermission();
  const manager = can('leave.manage');
  const employees = useEmployeeOptions({ includeInactive: true }, { enabled: open && !employeeId && manager });
  const qc = useQueryClient();
  const [form, setForm] = useState({ employeeId: employeeId || '', leaveType: 'annual', startDate: todayISO(), endDate: todayISO(), reason: '', status: 'approved' });
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    setBusy(true);
    try {
      const res = await employeeApi.createLeave({ ...form, employeeId: form.employeeId ? Number(form.employeeId) : undefined, status: manager ? form.status : undefined });
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['leave'] });
      qc.invalidateQueries({ queryKey: ['attendance'] });
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Record leave" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {!employeeId && manager ? (
          <Select label="Employee" className="sm:col-span-2" placeholder="Choose employee" value={form.employeeId} onChange={set('employeeId')} options={(employees.data || []).map((e) => ({ value: e.id, label: e.fullName }))} />
        ) : null}
        <Select label="Type" value={form.leaveType} onChange={set('leaveType')} options={TYPES} />
        {manager ? <Select label="Status" value={form.status} onChange={set('status')} options={[{ value: 'approved', label: 'Approved' }, { value: 'pending', label: 'Pending approval' }]} /> : null}
        <Input label="From" type="date" value={form.startDate} onChange={set('startDate')} />
        <Input label="To" type="date" value={form.endDate} min={form.startDate} onChange={set('endDate')} />
        <Textarea label="Reason" rows={2} className="sm:col-span-2" value={form.reason} onChange={set('reason')} />
      </div>
    </Modal>
  );
}

export function LeavePanel({ employeeId }) {
  const can = usePermission();
  const manager = can('leave.manage');
  const qc = useQueryClient();
  const [status, setStatus] = useState('');
  const leave = useLeave({ employeeId, status });
  const [open, setOpen] = useState(false);

  const review = async (id, next) => {
    try {
      const res = await employeeApi.reviewLeave(id, next);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['leave'] });
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <select aria-label="Filter by status" className="h-9 rounded-lg border border-line bg-surface px-3 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All leave</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {manager ? <Button size="sm" icon={Plus} onClick={() => setOpen(true)}>Record leave</Button> : null}
      </div>
      <DataTable
        loading={leave.isPending}
        error={leave.error}
        onRetry={leave.refetch}
        rows={leave.data}
        empty={<EmptyState icon={CalendarOff} title="No leave recorded" />}
        columns={[
          ...(employeeId ? [] : [{ key: 'employeeName', header: 'Employee', primary: true }]),
          { key: 'leaveType', header: 'Type', render: (l) => titleCase(l.leaveType) },
          { key: 'dates', header: 'Dates', render: (l) => `${formatDate(l.startDate, 'dd LLL')} – ${formatDate(l.endDate, 'dd LLL yyyy')}` },
          { key: 'days', header: 'Days', align: 'right' },
          { key: 'reason', header: 'Reason', hideOnMobile: true, render: (l) => l.reason || '—' },
          { key: 'status', header: 'Status', render: (l) => <StatusBadge status={l.status} /> },
          {
            key: 'actions',
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            render: (l) =>
              manager ? (
                <div className="flex justify-end gap-1">
                  {l.status === 'pending' ? (
                    <>
                      <IconButton icon={Check} size="sm" label="Approve" onClick={() => review(l.id, 'approved')} />
                      <IconButton icon={X} size="sm" label="Reject" onClick={() => review(l.id, 'rejected')} />
                    </>
                  ) : null}
                  {l.status === 'approved' && l.endDate >= todayISO() ? (
                    <Button size="xs" variant="ghost" onClick={() => review(l.id, 'cancelled')}>Cancel</Button>
                  ) : null}
                </div>
              ) : null,
          },
        ]}
      />
      <LeaveModal open={open} onClose={() => setOpen(false)} employeeId={employeeId} />
    </Card>
  );
}
