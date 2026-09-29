import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, MailCheck, Send } from 'lucide-react';
import { Button, Input } from '../../components/ui';
import { forgotPassword } from '../../features/auth/api';
import { useDocumentTitle } from '../../hooks';

const schema = z.object({ email: z.string().trim().min(1, 'Email is required').email('Enter a valid email address') });

export default function ForgotPasswordPage() {
  useDocumentTitle('Forgot password');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async ({ email }) => {
    setError(null);
    try {
      await forgotPassword(email);
      setSent(true);
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div>
      <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Back to sign in
      </Link>
      <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight">Reset your password</h1>

      {sent ? (
        <div className="mt-8 rounded-2xl border border-line bg-surface p-6 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-2xl bg-gold-500/10 text-accent">
            <MailCheck className="size-6" aria-hidden />
          </div>
          <p className="font-medium">Check your email</p>
          <p className="mt-2 text-sm text-muted">
            If an account exists for that address, we have sent a link to reset the password. The link expires in 60 minutes.
          </p>
          <p className="mt-4 text-xs text-muted">No email? Ask your administrator to reset your password from Settings → Users.</p>
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">Enter the email address of your account and we will send you a reset link.</p>
          {error ? <p role="alert" className="mt-4 text-sm text-danger">{error}</p> : null}
          <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-5">
            <Input label="Email address" type="email" autoComplete="email" error={errors.email?.message} inputClassName="h-11" {...register('email')} />
            <Button type="submit" size="lg" className="w-full" loading={isSubmitting} icon={Send}>
              Send reset link
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
