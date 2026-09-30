import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Ban, CheckCheck, CircleCheck, CirclePlay, Pencil, Phone, Printer, QrCode, ReceiptText, ScanLine, ShoppingBag, UserX,
} from 'lucide-react';
import { Avatar, Badge, Button, ConfirmDialog, Detail, Drawer, ErrorState, Modal, SkeletonRows, StatusBadge, Textarea } from '../../components/ui';
import { usePrint } from '../../components/print/usePrint';
import { useAuthStore } from '../../store/authStore';
import { formatDateTime, formatDuration, formatMoney, formatTime, formatDate, titleCase, todayISO } from '../../utils/format';
import { usePermission } from '../../hooks';
import { appointmentApi, appointmentKeys, useAppointment, useAppointmentQr } from './api';
import { EDITABLE_STATUSES, localDateOf, staffNames } from './calendarUtils';
import { ReplyBadge, ReplyNote } from './CustomerReply';
import { AppointmentProducts } from '../costing/AppointmentProducts';

/** Printable appointment slip (A4 or thermal). */
function AppointmentSlip({ appointment, qr }) {
  const settings = useAuthStore.getState().settings;
  return (
    <div style={{ fontFamily: 'Inter Variable, Arial, sans-serif', padding: 16, color: '#000', maxWidth: 420 }}>
      <p style={{ fontSize: 11, letterSpacing: 2, fontWeight: 700 }}>ZOLA STYLISH MANAGEMENT SYSTEM</p>
      <h1 style={{ fontSize: 20, margin: '4px 0 2px' }}>{settings?.business?.salon_name}</h1>
      <p style={{ fontSize: 11, color: '#444' }}>{appointment.branchName}{settings?.business?.phone ? ` · ${settings.business.phone}` : ''}</p>
      <hr style={{ margin: '12px 0', borderColor: '#ccc' }} />
      <p style={{ fontSize: 13, fontWeight: 700 }}>Appointment {appointment.code}</p>
      <table style={{ fontSize: 12, width: '100%', marginTop: 6 }}>
        <tbody>
          <tr><td style={{ color: '#555' }}>Customer</td><td style={{ textAlign: 'right' }}>{appointment.customerName}</td></tr>
          <tr><td style={{ color: '#555' }}>Date</td><td style={{ textAlign: 'right' }}>{formatDate(appointment.startTime, 'cccc dd LLL yyyy')}</td></tr>
          <tr><td style={{ color: '#555' }}>Time</td><td style={{ textAlign: 'right' }}>{formatTime(appointment.startTime)} – {formatTime(appointment.endTime)}</td></tr>
          <tr><td style={{ color: '#555' }}>{appointment.staff?.length > 1 ? 'Staff' : 'Stylist'}</td><td style={{ textAlign: 'right' }}>{staffNames(appointment, { full: true })}</td></tr>
        </tbody>
      </table>
      <hr style={{ margin: '12px 0', borderColor: '#ccc' }} />
      {appointment.services.map((s) => (
        <p key={s.serviceId} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
          <span>{s.serviceName}</span><span>{formatMoney(s.price)}</span>
        </p>
      ))}
      <p style={{ fontSize: 13, fontWeight: 700, display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        <span>Estimated total</span><span>{formatMoney(appointment.totalPrice)}</span>
      </p>
      {qr ? (
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <img src={qr.dataUrl} alt="Check-in QR code" style={{ width: 150, height: 150 }} />
          <p style={{ fontSize: 10, color: '#555' }}>Show this QR code at reception to check in</p>
        </div>
      ) : null}
    </div>
  );
}

export function AppointmentDrawer({ appointmentId, onClose, onEdit }) {
  const can = usePermission();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const query = useAppointment(appointmentId);
  const [showQr, setShowQr] = useState(false);
  const qr = useAppointmentQr(appointmentId, Boolean(appointmentId));
  const [busy, setBusy] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [noShowOpen, setNoShowOpen] = useState(false);
  const [reason, setReason] = useState('');
  const { print, portal } = usePrint();

  const a = query.data;

  const run = async (label, fn) => {
    setBusy(label);
    try {
      const res = await fn();
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: appointmentKeys.all });
      return true;
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const status = (next, extra) => run(next, () => appointmentApi.setStatus(a.id, next, extra));

  let body;
  if (query.isPending) body = <SkeletonRows rows={6} />;
  else if (query.isError) body = <ErrorState error={query.error} onRetry={query.refetch} />;
  else {
    const editable = EDITABLE_STATUSES.includes(a.status);
    // Day-of actions (check-in, start, complete, no-show, checkout) only on or after the appointment day.
    const isDue = localDateOf(a.startTime) <= todayISO();
    const canCheckIn = isDue && can('appointments.checkin') && !a.checkedInAt && ['pending', 'confirmed'].includes(a.status);
    body = (
      <div className="space-y-6">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={a.status} />
            {a.checkedInAt ? <Badge tone="success"><CheckCheck className="size-3" />Checked in {formatTime(a.checkedInAt)}</Badge> : null}
            <ReplyBadge appointment={a} />
            <Badge>{titleCase(a.source)}</Badge>
          </div>
          <p className="mt-3 font-display text-2xl font-semibold">{formatDate(a.startTime, 'cccc, dd LLL yyyy')}</p>
          <p className="text-muted">{formatTime(a.startTime)} – {formatTime(a.endTime)} · {formatDuration(a.totalDuration)}</p>
        </div>

        <ReplyNote appointment={a} />

        <div className="rounded-2xl border border-line p-4">
          <div className="flex items-center gap-3">
            <Avatar name={a.customerName} src={a.customerPhoto} />
            <div className="min-w-0 flex-1">
              <p className="font-medium">{a.customerName}</p>
              <p className="text-sm text-muted">{a.customerCode}</p>
            </div>
            <a href={`tel:${a.customerPhone}`} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-surface-2">
              <Phone className="size-3.5" /> Call
            </a>
          </div>
          {a.customerNotes ? <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-warning">{a.customerNotes}</p> : null}
          {can('customers.view') ? (
            <button type="button" onClick={() => navigate(`/customers/${a.customerId}`)} className="mt-3 text-sm font-medium text-accent hover:underline">View customer profile</button>
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold">Services</p>
          <ul className="divide-y divide-line rounded-2xl border border-line">
            {a.services.map((s) => (
              <li key={s.serviceId} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>{s.serviceName} <span className="text-muted">· {formatDuration(s.durationMinutes)}</span></span>
                <span className="font-medium">{formatMoney(s.price)}</span>
              </li>
            ))}
            <li className="flex items-center justify-between bg-surface-2/40 px-4 py-2.5 text-sm font-semibold">
              <span>Total</span><span>{formatMoney(a.totalPrice)}</span>
            </li>
          </ul>
        </div>

        <AppointmentProducts appointment={a} canRecord={can('appointments.record_products')} />

        <dl className="grid grid-cols-2 gap-4">
          <Detail label={a.staff?.length > 1 ? 'Staff (together)' : 'Stylist'}>
            <span className="flex flex-col gap-0.5">
              {(a.staff?.length ? a.staff : [{ id: a.employeeId, fullName: a.employeeName, color: a.employeeColor }]).map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: m.color }} />{m.fullName}</span>
              ))}
              {a.staff?.length > 1 ? <span className="text-xs text-muted">Their share of the service is split equally</span> : null}
            </span>
          </Detail>
          <Detail label="Branch">{a.branchName}</Detail>
          <Detail label="Booked by">{a.createdByName || '—'}</Detail>
          <Detail label="Booked on">{formatDateTime(a.createdAt)}</Detail>
          {a.notes ? <Detail label="Notes" className="col-span-2">{a.notes}</Detail> : null}
          {a.cancellationReason ? <Detail label="Cancellation reason" className="col-span-2">{a.cancellationReason} {a.cancelledByName ? `(${a.cancelledByName})` : ''}</Detail> : null}
        </dl>

        {showQr && qr.data ? (
          <div className="flex flex-col items-center rounded-2xl border border-line p-4">
            <img src={qr.data.dataUrl} alt={`Check-in QR code for ${a.code}`} className="size-44 rounded-lg bg-white p-2" />
            <p className="mt-2 text-center text-xs text-muted">Customers show this code at reception. It reveals no personal details.</p>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {a.status === 'pending' && can('appointments.update') ? <Button size="sm" icon={CircleCheck} loading={busy === 'confirmed'} onClick={() => status('confirmed')}>Confirm</Button> : null}
          {canCheckIn ? <Button size="sm" icon={ScanLine} loading={busy === 'checkin'} onClick={() => run('checkin', () => appointmentApi.checkInById(a.id))}>Check in</Button> : null}
          {isDue && ['pending', 'confirmed'].includes(a.status) && can('appointments.complete') ? <Button size="sm" variant="secondary" icon={CirclePlay} loading={busy === 'in_progress'} onClick={() => status('in_progress')}>Start service</Button> : null}
          {isDue && ['pending', 'confirmed', 'in_progress'].includes(a.status) && can('appointments.complete') ? <Button size="sm" variant="secondary" icon={CheckCheck} loading={busy === 'completed'} onClick={() => status('completed')}>Complete</Button> : null}
          {isDue && !a.saleId && ['in_progress', 'completed', 'confirmed'].includes(a.status) && can('pos.create') ? (
            <Button size="sm" variant="outline" icon={ShoppingBag} onClick={() => navigate(`/pos?appointment=${a.id}`)}>Checkout in POS</Button>
          ) : null}
          {a.saleId && can('sales.view') ? <Button size="sm" variant="outline" icon={ReceiptText} onClick={() => navigate(`/pos/sales/${a.saleId}`)}>View invoice</Button> : null}
          {editable && can('appointments.update') ? <Button size="sm" variant="ghost" icon={Pencil} onClick={() => onEdit(a)}>Edit / reschedule</Button> : null}
          <Button size="sm" variant="ghost" icon={QrCode} onClick={() => setShowQr((v) => !v)}>{showQr ? 'Hide QR' : 'Show QR'}</Button>
          <Button size="sm" variant="ghost" icon={Printer} disabled={!qr.data} onClick={() => print(<AppointmentSlip appointment={a} qr={qr.data} />)}>Print slip</Button>
          {isDue && editable && can('appointments.update') ? <Button size="sm" variant="ghost" icon={UserX} onClick={() => setNoShowOpen(true)}>No-show</Button> : null}
          {['pending', 'confirmed', 'in_progress'].includes(a.status) && can('appointments.cancel') ? (
            <Button size="sm" variant="danger-ghost" icon={Ban} onClick={() => { setReason(''); setCancelOpen(true); }}>Cancel</Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <Drawer open={Boolean(appointmentId)} onClose={onClose} title={a ? a.code : 'Appointment'}>
        {body}
      </Drawer>
      <Modal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        size="sm"
        title="Cancel appointment"
        description="The customer is notified if cancellation messages are enabled."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep appointment</Button>
            <Button variant="danger" loading={busy === 'cancelled'} disabled={!reason.trim()} onClick={async () => (await status('cancelled', reason)) && setCancelOpen(false)}>Cancel appointment</Button>
          </>
        }
      >
        <Textarea label="Reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Customer called to cancel…" data-autofocus />
      </Modal>
      <ConfirmDialog
        open={noShowOpen}
        onClose={() => setNoShowOpen(false)}
        title="Mark as no-show?"
        message="Use this when the customer did not arrive. It frees the stylist's time and is counted in the customer's history."
        confirmLabel="Mark no-show"
        loading={busy === 'no_show'}
        onConfirm={async () => (await status('no_show')) && setNoShowOpen(false)}
      />
      {portal}
    </>
  );
}
