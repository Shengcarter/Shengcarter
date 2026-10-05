import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, LogIn, ShieldCheck } from 'lucide-react';
import { Button, Checkbox, Input, PasswordInput } from '../../components/ui';
import { login, loginSecondStep } from '../../features/auth/api';
import { CodeInput } from '../../features/auth/TwoStep';
import { useAuthStore } from '../../store/authStore';
import { useDocumentTitle } from '../../hooks';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional(),
});

/** Second step: the code from the authenticator app, or a recovery code. */
function CodeStep({ challenge, onSignedIn, onBack }) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSignedIn(await loginSecondStep({ challenge, code }));
    } catch (err) {
      if (err.code === 'CHALLENGE_EXPIRED') onBack(err.message);
      else setError(err.message);
      setCode('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate className="mt-8 space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <p>{recovery ? 'Enter one of the recovery codes you saved when you set up two-step sign-in.' : 'Open the authenticator app on your phone and enter the 6-digit code for this account.'}</p>
      </div>
      <CodeInput value={code} onChange={setCode} recovery={recovery} label={recovery ? 'Recovery code' : 'Code'} error={error} autoFocus />
      <Button type="submit" size="lg" className="w-full" loading={busy} disabled={recovery ? code.replace(/[^A-Z0-9]/g, '').length !== 10 : code.length !== 6}>
        Verify and sign in
      </Button>
      <div className="flex items-center justify-between text-sm">
        <button type="button" className="text-muted hover:text-fg" onClick={() => onBack(null)}>← Back</button>
        <button type="button" className="font-medium text-accent hover:underline" onClick={() => { setRecovery((v) => !v); setCode(''); setError(null); }}>
          {recovery ? 'Use the app instead' : 'Lost your phone? Use a recovery code'}
        </button>
      </div>
    </form>
  );
}

export default function LoginPage() {
  useDocumentTitle('Sign in');
  const navigate = useNavigate();
  const location = useLocation();
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const signedOut = new URLSearchParams(location.search).has('signedOut');
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState(null);
  const [challenge, setChallenge] = useState(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', remember: true },
  });

  const onSubmit = async (values) => {
    setServerError(null);
    try {
      // Drop anything loaded for the previous person (e.g. after their session expired on this device),
      // so the dashboard and every page show the account that is signing in. Done before the session
      // is set, so no page starts from the old data.
      queryClient.clear();
      const session = await login(values);
      if (session.twoFactorRequired) {
        setChallenge(session.challenge);
        return;
      }
      signedIn(session);
    } catch (error) {
      setServerError(error.message);
    }
  };

  function signedIn(session) {
    const next = location.state?.from?.pathname || '/';
    navigate(session.user.mustChangePassword ? '/change-password' : session.user.twoFactorSetupRequired ? '/setup-two-step' : next, { replace: true });
  }

  if (challenge) {
    return (
      <div>
        <p className="text-xs font-semibold tracking-[0.25em] text-accent uppercase">Two-step sign-in</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Enter your code</h1>
        <p className="mt-2 text-sm text-muted">ZOLA STYLISH MANAGEMENT SYSTEM</p>
        <CodeStep
          challenge={challenge}
          onSignedIn={signedIn}
          onBack={(message) => {
            setChallenge(null);
            setServerError(message);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs font-semibold tracking-[0.25em] text-accent uppercase">Welcome back</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Sign in to your account</h1>
      <p className="mt-2 text-sm text-muted">ZOLA STYLISH MANAGEMENT SYSTEM</p>

      {signedOut && !sessionExpired && !serverError ? (
        <div role="status" className="mt-6 flex items-start gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-muted">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          You have been signed out.
        </div>
      ) : null}

      {sessionExpired && !serverError ? (
        <div role="status" className="mt-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-warning">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          Your session has expired. Please sign in again.
        </div>
      ) : null}

      {serverError ? (
        <div role="alert" className="mt-6 flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-danger">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {serverError}
        </div>
      ) : null}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-5">
        <Input
          label="Email address"
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          error={errors.email?.message}
          inputClassName="h-11"
          {...register('email')}
        />
        <PasswordInput label="Password" autoComplete="current-password" placeholder="••••••••" error={errors.password?.message} {...register('password')} />

        <div className="flex items-center justify-between gap-4">
          <Checkbox label="Remember me" {...register('remember')} />
          <Link to="/forgot-password" className="text-sm font-medium text-accent hover:underline">
            Forgot password?
          </Link>
        </div>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting} icon={LogIn}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <p className="mt-10 text-center text-xs text-muted">
        Protected system. Access is logged. Contact your administrator if you need an account.
      </p>
    </div>
  );
}
