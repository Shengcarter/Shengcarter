import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CheckCircle2, LogIn, ScanLine, ShieldAlert, XCircle } from 'lucide-react';
import { Button, Logo, Spinner } from '../components/ui';
import { http } from '../api/client';
import { useAuthStore, hasPermission } from '../store/authStore';
import { useDocumentTitle } from '../hooks';
import { formatTime } from '../utils/format';

/**
 * Page opened by scanning an appointment QR code.
 * - Anyone: sees only that the booking is valid (date, time, branch) — no
 *   personal information is exposed by the public link.
 * - Signed-in staff with check-in permission: can check the customer in.
 */
export default function CheckInPage() {
  useDocumentTitle('Appointment check-in');
  const { token } = useParams();
  const location = useLocation();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const canCheckIn = status === 'authenticated' && hasPermission({ user, permissions }, 'appointments.checkin');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  const verify = useQuery({
    queryKey: ['public-appointment', token],
    queryFn: () => http.get(`/public/appointments/${token}`).then((r) => r.data),
    retry: false,
  });

  const checkIn = async () => {
    setBusy(true);
    try {
      const res = await http.post('/appointments/check-in', { token });
      setResult({ ok: true, appointment: res.data });
      verify.refetch();
    } catch (e) {
      setResult({ ok: false, message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const v = verify.data;

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <Logo className="mb-8 justify-center" />
        <div className="card overflow-hidden">
          {verify.isPending ? (
            <div className="flex justify-center p-10"><Spinner /></div>
          ) : verify.isError ? (
            <div className="p-8 text-center">
              <XCircle className="mx-auto mb-3 size-12 text-danger" aria-hidden />
              <h1 className="font-display text-xl font-semibold">Invalid QR code</h1>
              <p className="mt-2 text-sm text-muted">{verify.error.message}</p>
            </div>
          ) : (
            <>
              <div className={`px-6 py-6 text-center ${v.valid ? 'bg-brand-500/10' : 'bg-red-500/10'}`}>
                {v.valid ? <CalendarCheck className="mx-auto mb-3 size-12 text-accent" aria-hidden /> : <ShieldAlert className="mx-auto mb-3 size-12 text-danger" aria-hidden />}
                <h1 className="font-display text-2xl font-semibold">{v.valid ? 'Valid appointment' : `Appointment ${v.status.replace('_', ' ')}`}</h1>
                <p className="mt-1 text-sm text-muted">{v.salonName} · {v.branchName}</p>
              </div>
              <dl className="grid grid-cols-2 gap-4 px-6 py-5 text-sm">
                <div><dt className="text-xs text-muted uppercase">Reference</dt><dd className="font-semibold">{v.code}</dd></div>
                <div><dt className="text-xs text-muted uppercase">Services</dt><dd className="font-semibold">{v.serviceCount}</dd></div>
                <div><dt className="text-xs text-muted uppercase">Date</dt><dd className="font-semibold">{v.date}</dd></div>
                <div><dt className="text-xs text-muted uppercase">Time</dt><dd className="font-semibold">{v.time}</dd></div>
              </dl>
              <div className="border-t border-line px-6 py-5">
                {v.checkedIn ? (
                  <p className="flex items-center justify-center gap-2 text-sm font-medium text-success"><CheckCircle2 className="size-4" /> Already checked in</p>
                ) : canCheckIn ? (
                  <Button className="w-full" size="lg" icon={ScanLine} loading={busy} disabled={!v.valid || !v.isToday} onClick={checkIn}>
                    {v.isToday ? 'Check in customer' : 'Check-in opens on the appointment day'}
                  </Button>
                ) : status === 'authenticated' ? (
                  <p className="text-center text-sm text-muted">Please present this code at reception.</p>
                ) : (
                  <div className="space-y-3 text-center">
                    <p className="text-sm text-muted">Please show this screen at reception when you arrive.</p>
                    <Link to="/login" state={{ from: location }} className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline">
                      <LogIn className="size-4" /> Staff sign-in to check in
                    </Link>
                  </div>
                )}
                {result ? (
                  result.ok ? (
                    <div className="mt-4 rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm" role="status">
                      <p className="font-semibold text-success">{result.appointment.customerName} is checked in</p>
                      <p className="text-muted">{formatTime(result.appointment.startTime)} with {result.appointment.employeeName}</p>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-danger" role="alert">{result.message}</p>
                  )
                ) : null}
              </div>
            </>
          )}
        </div>
        <p className="mt-6 text-center text-xs text-muted">ZOLA STYLISH MANAGEMENT SYSTEM</p>
      </div>
    </div>
  );
}
