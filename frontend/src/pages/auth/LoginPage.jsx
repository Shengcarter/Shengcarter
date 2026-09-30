import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useQueryClient } from '@tanstack/react-query';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, LogIn } from 'lucide-react';
import { Button, Checkbox, Input, PasswordInput } from '../../components/ui';
import { login } from '../../features/auth/api';
import { useAuthStore } from '../../store/authStore';
import { useDocumentTitle } from '../../hooks';

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
  remember: z.boolean().optional(),
});

export default function LoginPage() {
  useDocumentTitle('Sign in');
  const navigate = useNavigate();
  const location = useLocation();
  const sessionExpired = useAuthStore((s) => s.sessionExpired);
  const queryClient = useQueryClient();
  const [serverError, setServerError] = useState(null);

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
      const next = location.state?.from?.pathname || '/';
      navigate(session.user.mustChangePassword ? '/change-password' : next, { replace: true });
    } catch (error) {
      setServerError(error.message);
    }
  };

  return (
    <div>
      <p className="text-xs font-semibold tracking-[0.25em] text-accent uppercase">Welcome back</p>
      <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight">Sign in to your account</h1>
      <p className="mt-2 text-sm text-muted">ZOLA STYLISH MANAGEMENT SYSTEM</p>

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
