import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Copy, Download, KeyRound, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { Badge, Button, Card, Input, PasswordInput } from '../../components/ui';
import { formatDateTime } from '../../utils/format';
import { twoFactorApi } from './api';

const errorOf = (error) => error.errors?.[0]?.message || error.message;

/** A 6-digit code field that works with phone keyboards and password managers. */
export function CodeInput({ value, onChange, label = 'Code from the app', recovery = false, ...props }) {
  return (
    <Input
      label={label}
      value={value}
      onChange={(e) => onChange(recovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode={recovery ? 'text' : 'numeric'}
      autoComplete="one-time-code"
      placeholder={recovery ? 'XXXXX-XXXXX' : '123456'}
      maxLength={recovery ? 11 : 6}
      inputClassName="h-11 font-mono tracking-[0.3em]"
      {...props}
    />
  );
}

/** Recovery codes, shown once: copy or save them as a text file. */
export function RecoveryCodes({ codes, onDone, doneLabel = 'I have saved them' }) {
  const text = codes.join('\n');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Recovery codes copied');
    } catch {
      toast.error('Copy failed: write them down instead');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([`ZOLA STYLISH recovery codes (each works once)\n\n${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zola-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        If you lose your phone, each of these codes lets you sign in <strong className="text-fg">once</strong>. Keep them somewhere safe (not on the same phone). They are shown only now.
      </p>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-surface-2 p-3 font-mono text-sm">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={Copy} onClick={copy}>Copy</Button>
        <Button variant="secondary" size="sm" icon={Download} onClick={download}>Save as file</Button>
        <Button size="sm" className="ml-auto" onClick={onDone}>{doneLabel}</Button>
      </div>
    </div>
  );
}

/**
 * Turning on two-step sign-in: password → scan the QR code (or type the key)
 * → first code → recovery codes.
 */
export function TwoStepSetup({ onDone, onCancel, onEnabled }) {
  const [step, setStep] = useState('password');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const start = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSetup(await twoFactorApi.setup(password));
      setPassword('');
      setStep('scan');
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCodes(await twoFactorApi.confirm(code));
      setStep('codes');
      onEnabled?.();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (step === 'codes') return <RecoveryCodes codes={codes} onDone={onDone} />;
  if (step === 'scan') {
    return (
      <form onSubmit={confirm} className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Open an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy…).</li>
          <li>Add an account and scan this code.</li>
          <li>Type the 6-digit code the app shows.</li>
        </ol>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          <img src={setup.qrCode} alt="QR code to add this account to an authenticator app" className="size-44 rounded-xl border border-line bg-white p-2" />
          <div className="min-w-0 text-sm">
            <p className="text-muted">Can't scan? Enter this key in the app:</p>
            <p className="mt-1 font-mono text-xs break-all select-all">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</p>
          </div>
        </div>
        <CodeInput value={code} onChange={setCode} error={error} autoFocus />
        <div className="flex justify-end gap-2">
          {onCancel ? <Button variant="secondary" onClick={onCancel}>Cancel</Button> : null}
          <Button type="submit" loading={busy} disabled={code.length !== 6}>Turn on</Button>
        </div>
      </form>
    );
  }
  return (
    <form onSubmit={start} className="space-y-4">
      <PasswordInput label="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={error} autoFocus />
      <div className="flex justify-end gap-2">
        {onCancel ? <Button variant="secondary" onClick={onCancel}>Cancel</Button> : null}
        <Button type="submit" icon={Smartphone} loading={busy} disabled={!password}>Continue</Button>
      </div>
    </form>
  );
}

/** Password + code, for turning it off or making new recovery codes. */
function ConfirmWithCode({ action, label, danger, onDone, onCancel }) {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await action({ password, code }));
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-4">
      <PasswordInput label="Your password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <CodeInput value={code} onChange={setCode} recovery={recovery} label={recovery ? 'Recovery code' : 'Code from the app'} error={error} />
      {label !== 'New recovery codes' ? (
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => { setRecovery((v) => !v); setCode(''); }}>
          {recovery ? 'Use a code from the app' : 'Use a recovery code instead'}
        </button>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant={danger ? 'danger' : 'primary'} loading={busy} disabled={!password || !code}>{label}</Button>
      </div>
    </form>
  );
}

/** Profile → Two-step sign-in. */
export function TwoStepCard() {
  const [status, setStatus] = useState(null);
  const [mode, setMode] = useState(null); // setup | disable | codes
  const [codes, setCodes] = useState(null);
  const load = () => twoFactorApi.status().then(setStatus).catch((e) => toast.error(errorOf(e)));
  useEffect(() => {
    load();
  }, []);

  if (!status) return <Card className="p-6"><p className="text-sm text-muted">Loading…</p></Card>;
  const finish = (message) => {
    setMode(null);
    setCodes(null);
    if (message) toast.success(message);
    load();
  };

  return (
    <Card className="p-6">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-accent">
          {status.enabled ? <ShieldCheck className="size-5" aria-hidden /> : <ShieldOff className="size-5" aria-hidden />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="flex flex-wrap items-center gap-2 font-semibold">
            Two-step sign-in
            <Badge tone={status.enabled ? 'success' : status.required ? 'warning' : 'neutral'}>{status.enabled ? 'On' : status.required ? 'Required' : 'Off'}</Badge>
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            After your password, enter a 6-digit code from an authenticator app on your phone. Someone who learns your password still cannot sign in.
          </p>
          {status.enabled ? (
            <p className="mt-1 text-xs text-muted">On since {formatDateTime(status.enabledAt)} · {status.recoveryCodesLeft} recovery code{status.recoveryCodesLeft === 1 ? '' : 's'} left</p>
          ) : null}
        </div>
      </div>

      {codes ? (
        <RecoveryCodes codes={codes} onDone={() => finish()} doneLabel="Done" />
      ) : mode === 'setup' ? (
        <TwoStepSetup onDone={() => finish('Two-step sign-in is on')} onCancel={() => setMode(null)} onEnabled={load} />
      ) : mode === 'disable' ? (
        <ConfirmWithCode label="Turn off" danger action={twoFactorApi.disable} onDone={() => finish('Two-step sign-in is off')} onCancel={() => setMode(null)} />
      ) : mode === 'codes' ? (
        <ConfirmWithCode label="New recovery codes" action={twoFactorApi.recoveryCodes} onDone={(fresh) => setCodes(fresh)} onCancel={() => setMode(null)} />
      ) : status.enabled ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={KeyRound} onClick={() => setMode('codes')}>New recovery codes</Button>
          {!status.required ? <Button variant="danger-ghost" size="sm" icon={ShieldOff} onClick={() => setMode('disable')}>Turn off</Button> : null}
          {status.required ? <p className="w-full text-xs text-muted">Your salon requires two-step sign-in for your account, so it cannot be turned off.</p> : null}
        </div>
      ) : (
        <Button icon={Smartphone} onClick={() => setMode('setup')}>Turn on two-step sign-in</Button>
      )}
    </Card>
  );
}
