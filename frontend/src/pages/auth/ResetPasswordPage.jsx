import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { Button, PasswordInput, applyServerErrors } from '../../components/ui';
import { resetPassword } from '../../features/auth/api';
import { passwordRule, PASSWORD_HINT } from '../../features/auth/passwordSchema';
import { useDocumentTitle } from '../../hooks';

const schema = z
  .object({ password: passwordRule, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export default function ResetPasswordPage() {
  useDocumentTitle('Choose a new password');
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const navigate = useNavigate();
  const [error, setError] = useState(null);
  const { register, handleSubmit, setError: setFieldError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async (values) => {
    setError(null);
    try {
      await resetPassword({ ...values, token });
      toast.success('Password reset. Please sign in with your new password.');
      navigate('/login', { replace: true });
    } catch (e) {
      if (!applyServerErrors(e, setFieldError)) setError(e.message);
    }
  };

  return (
    <div>
      <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
      <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight">Choose a new password</h1>
      {!token ? (
        <p role="alert" className="mt-4 text-sm text-danger">
          This reset link is incomplete. Please use the link from your email or <Link to="/forgot-password" className="underline">request a new one</Link>.
        </p>
      ) : (
        <>
          {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-5">
            <PasswordInput label="New password" autoComplete="new-password" hint={PASSWORD_HINT} error={errors.password?.message} {...register('password')} />
            <PasswordInput label="Confirm new password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
            <Button type="submit" size="lg" className="w-full" loading={isSubmitting} icon={KeyRound}>
              Reset password
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
