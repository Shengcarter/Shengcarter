import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, CameraOff, ScanLine } from 'lucide-react';
import { Button, Input, Modal } from '../../components/ui';
import { formatTime } from '../../utils/format';
import { appointmentApi, appointmentKeys } from './api';
import { staffNames } from './calendarUtils';

const TOKEN_PATTERN = /([a-f0-9]{32})/i;

/** Camera QR scanning where the browser supports the BarcodeDetector API. */
function QrScanner({ onToken }) {
  const videoRef = useRef(null);
  const [state, setState] = useState('idle'); // idle | running | denied
  // Latest callback without restarting the camera on every parent render.
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const supported = typeof window !== 'undefined' && 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia && window.isSecureContext;

  useEffect(() => {
    if (state !== 'running') return undefined;
    let stream;
    let timer;
    let stopped = false;
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (stopped) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        const tick = async () => {
          if (stopped) return;
          try {
            const codes = await detector.detect(videoRef.current);
            const match = codes.map((c) => TOKEN_PATTERN.exec(c.rawValue)).find(Boolean);
            if (match) {
              setState('idle');
              onTokenRef.current(match[1].toLowerCase());
              return;
            }
          } catch {
            /* frame not ready */
          }
          timer = setTimeout(tick, 300);
        };
        tick();
      } catch {
        setState('denied');
      }
    };
    start();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [state]);

  if (!supported) {
    return (
      <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-muted">
        In-app scanning needs a browser with QR support over HTTPS. You can also scan the customer's code with your phone's camera app — it opens the check-in page directly.
      </p>
    );
  }
  if (state === 'denied') return <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-danger">Camera access was blocked. Allow camera access or type the appointment code below.</p>;
  if (state === 'idle') return <Button variant="secondary" icon={Camera} className="w-full" onClick={() => setState('running')}>Scan QR code with camera</Button>;
  return (
    <div className="space-y-2">
      <video ref={videoRef} className="aspect-square w-full rounded-2xl bg-black object-cover" muted playsInline />
      <Button variant="ghost" size="sm" icon={CameraOff} onClick={() => setState('idle')}>Stop camera</Button>
    </div>
  );
}

export function CheckInModal({ open, onClose, onCheckedIn }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      setCode('');
      setResult(null);
    }
  }, [open]);

  const submit = async (body) => {
    setBusy(true);
    try {
      const res = await appointmentApi.checkIn(body);
      setResult({ ok: true, appointment: res.data });
      toast.success(`${res.data.customerName} checked in`);
      qc.invalidateQueries({ queryKey: appointmentKeys.all });
      onCheckedIn?.(res.data);
    } catch (e) {
      setResult({ ok: false, message: e.message });
    } finally {
      setBusy(false);
    }
  };

  const onToken = (token) => submit({ token });

  return (
    <Modal open={open} onClose={onClose} size="sm" title="Check in a customer" description="Scan the appointment QR code or enter the appointment code.">
      <div className="space-y-4">
        {!result?.ok ? <QrScanner onToken={onToken} /> : null}
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const match = TOKEN_PATTERN.exec(code);
            submit(match ? { token: match[1].toLowerCase() } : { code: code.trim().toUpperCase() });
          }}
        >
          <Input className="flex-1" aria-label="Appointment code" placeholder="APT-000123" value={code} onChange={(e) => setCode(e.target.value)} />
          <Button type="submit" icon={ScanLine} loading={busy} disabled={!code.trim()}>Check in</Button>
        </form>
        {result ? (
          result.ok ? (
            <div className="rounded-xl border border-green-500/30 bg-green-500/10 p-4 text-sm" role="status">
              <p className="font-semibold text-success">Checked in</p>
              <p className="mt-1">{result.appointment.customerName} · {result.appointment.code}</p>
              <p className="text-muted">{formatTime(result.appointment.startTime)} with {staffNames(result.appointment, { full: true })} — {result.appointment.services.map((s) => s.serviceName).join(', ')}</p>
            </div>
          ) : (
            <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-danger" role="alert">{result.message}</p>
          )
        ) : null}
      </div>
    </Modal>
  );
}
