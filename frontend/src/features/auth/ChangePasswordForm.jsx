import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
import { Button, PasswordInput, applyServerErrors } from '../../components/ui';
import { changePassword } from './api';
import { passwordRule, PASSWORD_HINT } from './passwordSchema';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: passwordRule,
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { path: ['confirmPassword'], message: 'Passwords do not match' });

export function ChangePasswordForm({ onDone, submitLabel = 'Change password' }) {
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  const onSubmit = async (values) => {
    try {
      await changePassword(values);
      toast.success('Password changed successfully');
      reset();
      onDone?.();
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
      <PasswordInput label="Current password" autoComplete="current-password" error={errors.currentPassword?.message} {...register('currentPassword')} />
      <PasswordInput label="New password" autoComplete="new-password" hint={PASSWORD_HINT} error={errors.newPassword?.message} {...register('newPassword')} />
      <PasswordInput label="Confirm new password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
      <Button type="submit" loading={isSubmitting} icon={KeyRound}>
        {submitLabel}
      </Button>
    </form>
  );
}
