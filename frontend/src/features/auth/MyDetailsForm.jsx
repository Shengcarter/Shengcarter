import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Save } from 'lucide-react';
import { Button, Input, applyServerErrors } from '../../components/ui';
import { http } from '../../api/client';
import { reloadSession } from './api';

const schema = z.object({
  fullName: z.string().trim().min(1, 'Your name is required').max(120, 'Maximum 120 characters'),
  phone: z.string().trim().max(30, 'Maximum 30 characters'),
});

/** The signed-in person's own name and phone. The dashboard greets them by this name. */
export function MyDetailsForm({ user }) {
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting, isDirty } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { fullName: user?.fullName || '', phone: user?.phone || '' },
  });

  const onSubmit = async (values) => {
    try {
      await http.patch('/users/me', values);
      const session = await reloadSession();
      reset({ fullName: session.user.fullName || '', phone: session.user.phone || '' });
      toast.success('Your details have been saved');
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="grid gap-4 sm:grid-cols-2">
      <Input label="Your name" required autoComplete="name" hint="Shown in the dashboard greeting and on your activity." error={errors.fullName?.message} {...register('fullName')} />
      <Input label="Phone" type="tel" autoComplete="tel" error={errors.phone?.message} {...register('phone')} />
      <div className="sm:col-span-2">
        <Button type="submit" icon={Save} loading={isSubmitting} disabled={!isDirty}>Save details</Button>
      </div>
    </form>
  );
}
