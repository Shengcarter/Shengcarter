import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Switch, Textarea, applyServerErrors } from '../../components/ui';
import { getFormatSettings } from '../../utils/format';
import { employeeApi, employeeKeys } from './api';

const COLORS = ['#D4AF37', '#60A5FA', '#F472B6', '#34D399', '#A78BFA', '#FB923C', '#F87171', '#22D3EE', '#94A3B8'];

const schema = z.object({
  fullName: z.string().trim().min(1, 'Full name is required').max(120),
  jobTitle: z.string().trim().min(1, 'Role is required').max(80),
  phone: z.string().trim().max(30).optional(),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]),
  address: z.string().max(255).optional(),
  employmentDate: z.string().optional(),
  salary: z.coerce.number().min(0, 'Must be zero or more'),
  commissionRate: z.coerce.number().min(0, '0–100').max(100, '0–100'),
  status: z.enum(['active', 'on_leave', 'inactive', 'terminated']),
  isBookable: z.boolean(),
  calendarColor: z.string(),
  notes: z.string().max(2000).optional(),
});

export function EmployeeFormModal({ open, onClose, employee, onSaved }) {
  const isEdit = Boolean(employee);
  const qc = useQueryClient();
  const { register, handleSubmit, reset, control, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    reset({
      fullName: employee?.fullName || '',
      jobTitle: employee?.jobTitle || '',
      phone: employee?.phone || '',
      email: employee?.email || '',
      address: employee?.address || '',
      employmentDate: employee?.employmentDate || new Date().toISOString().slice(0, 10),
      salary: employee?.salary ?? 0,
      commissionRate: employee?.commissionRate ?? 10,
      status: employee?.status || 'active',
      isBookable: employee ? employee.isBookable : true,
      calendarColor: employee?.calendarColor || COLORS[0],
      notes: employee?.notes || '',
    });
  }, [open, employee, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const body = { ...values, phone: values.phone || null, email: values.email || null, address: values.address || null, employmentDate: values.employmentDate || null, notes: values.notes || null };
    try {
      const res = isEdit ? await employeeApi.update(employee.id, body) : await employeeApi.create(body);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: employeeKeys.all });
      onSaved?.(res.data);
      onClose();
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  const currency = getFormatSettings().currency;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={isEdit ? 'Edit employee' : 'New employee'}
      description={isEdit ? employee.code : 'New staff start with the business hours as their schedule. You can adjust it later.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} loading={isSubmitting}>{isEdit ? 'Save changes' : 'Create employee'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" required error={errors.fullName?.message} {...register('fullName')} />
        <Input label="Role / job title" required placeholder="Senior Stylist" error={errors.jobTitle?.message} {...register('jobTitle')} />
        <Input label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
        <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <Input label="Employment date" type="date" error={errors.employmentDate?.message} {...register('employmentDate')} />
        <Select
          label="Status"
          options={[
            { value: 'active', label: 'Active' },
            { value: 'on_leave', label: 'On leave' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'terminated', label: 'Terminated' },
          ]}
          {...register('status')}
        />
        <Input label={`Monthly salary (${currency})`} type="number" min="0" step="any" error={errors.salary?.message} {...register('salary')} />
        <Input label="Commission rate (%)" type="number" min="0" max="100" step="0.5" hint="Applied to services unless the service sets its own rate" error={errors.commissionRate?.message} {...register('commissionRate')} />
        <Input label="Address" className="sm:col-span-2" error={errors.address?.message} {...register('address')} />
        <Controller
          control={control}
          name="calendarColor"
          render={({ field }) => (
            <fieldset className="sm:col-span-2">
              <legend className="mb-2 text-sm font-medium">Calendar colour</legend>
              <div className="flex flex-wrap gap-2">
                {COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => field.onChange(color)}
                    aria-label={`Colour ${color}`}
                    aria-pressed={field.value === color}
                    className={`size-8 rounded-full ring-offset-2 ring-offset-surface ${field.value === color ? 'ring-2 ring-fg' : ''}`}
                    style={{ background: color }}
                  />
                ))}
              </div>
            </fieldset>
          )}
        />
        <Controller control={control} name="isBookable" render={({ field }) => <Switch className="sm:col-span-2" label="Takes appointments" description="Show this person in the booking calendar." checked={field.value} onChange={field.onChange} />} />
        <Textarea label="Notes" rows={2} className="sm:col-span-2" {...register('notes')} />
      </form>
    </Modal>
  );
}
