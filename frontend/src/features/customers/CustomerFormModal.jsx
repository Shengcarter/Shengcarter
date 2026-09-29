import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Checkbox, Input, Modal, Select, Textarea, applyServerErrors } from '../../components/ui';
import { customerApi, customerKeys } from './api';

const schema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(120),
  phone: z.string().trim().min(1, 'Phone is required').regex(/^\+?[0-9\s\-().]{7,20}$/, 'Enter a valid phone number'),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]),
  gender: z.enum(['female', 'male', 'other', 'unspecified']),
  dateOfBirth: z.string().optional(),
  address: z.string().max(255).optional(),
  notes: z.string().max(5000).optional(),
  marketingOptIn: z.boolean(),
  preferredChannel: z.enum(['sms', 'whatsapp', 'email', 'none']),
});

const EMPTY = { fullName: '', phone: '', email: '', gender: 'unspecified', dateOfBirth: '', address: '', notes: '', marketingOptIn: true, preferredChannel: 'sms' };

/** Create or edit a customer. `onSaved(customer)` receives the saved record. */
export function CustomerFormModal({ open, onClose, customer, onSaved, initialName = '' }) {
  const isEdit = Boolean(customer);
  const qc = useQueryClient();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema), defaultValues: EMPTY });

  useEffect(() => {
    if (!open) return;
    reset(
      customer
        ? {
            fullName: customer.fullName,
            phone: customer.phone,
            email: customer.email || '',
            gender: customer.gender,
            dateOfBirth: customer.dateOfBirth || '',
            address: customer.address || '',
            notes: customer.notes || '',
            marketingOptIn: customer.marketingOptIn,
            preferredChannel: customer.preferredChannel,
          }
        : { ...EMPTY, fullName: /\d/.test(initialName) ? '' : initialName, phone: /\d/.test(initialName) ? initialName : '' },
    );
  }, [open, customer, reset, initialName]);

  const onSubmit = handleSubmit(async (values) => {
    const body = { ...values, email: values.email || null, dateOfBirth: values.dateOfBirth || null, address: values.address || null, notes: values.notes || null };
    try {
      const res = isEdit ? await customerApi.update(customer.id, body) : await customerApi.create(body);
      toast.success(res.message);
      await qc.invalidateQueries({ queryKey: customerKeys.all });
      onSaved?.(res.data);
      onClose();
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Edit customer' : 'New customer'}
      description={isEdit ? customer.code : 'Register a customer to book appointments and track their history.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} loading={isSubmitting}>{isEdit ? 'Save changes' : 'Create customer'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" required autoComplete="off" error={errors.fullName?.message} {...register('fullName')} data-autofocus />
        <Input label="Phone" required type="tel" placeholder="0712 345 678" error={errors.phone?.message} {...register('phone')} />
        <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <Select
          label="Gender"
          options={[
            { value: 'female', label: 'Female' },
            { value: 'male', label: 'Male' },
            { value: 'other', label: 'Other' },
            { value: 'unspecified', label: 'Prefer not to say' },
          ]}
          {...register('gender')}
        />
        <Input label="Date of birth" type="date" max={new Date().toISOString().slice(0, 10)} error={errors.dateOfBirth?.message} {...register('dateOfBirth')} />
        <Select
          label="Preferred contact"
          options={[
            { value: 'sms', label: 'SMS' },
            { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'email', label: 'Email' },
            { value: 'none', label: 'No messages' },
          ]}
          {...register('preferredChannel')}
        />
        <Input label="Address" className="sm:col-span-2" error={errors.address?.message} {...register('address')} />
        <Textarea label="Notes" hint="Allergies, preferences, hair type… visible to stylists on appointments." className="sm:col-span-2" rows={3} error={errors.notes?.message} {...register('notes')} />
        <Checkbox className="sm:col-span-2" label="Agrees to receive promotions" description="Used for promotional SMS / WhatsApp / email campaigns." {...register('marketingOptIn')} />
      </form>
    </Modal>
  );
}
