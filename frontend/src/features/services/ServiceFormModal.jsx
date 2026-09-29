import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Button, Input, Modal, Select, Switch, Textarea, applyServerErrors, ConfirmDialog } from '../../components/ui';
import { cn } from '../../utils/cn';
import { getFormatSettings } from '../../utils/format';
import { serviceApi, serviceKeys, useEmployeeOptions, useServiceCategories } from './api';

const schema = z.object({
  name: z.string().trim().min(1, 'Service name is required').max(120),
  categoryId: z.coerce.number({ error: 'Choose a category' }).int().positive('Choose a category'),
  price: z.coerce.number({ error: 'Enter a price' }).positive('Price must be greater than zero'),
  durationMinutes: z.coerce.number({ error: 'Enter a duration' }).int().min(5, 'At least 5 minutes').max(720, 'At most 12 hours'),
  commissionRate: z.union([z.literal(''), z.coerce.number().min(0, '0–100').max(100, '0–100')]),
  description: z.string().max(2000).optional(),
  isActive: z.boolean(),
  employeeIds: z.array(z.number()),
});

export function ServiceFormModal({ open, onClose, service }) {
  const isEdit = Boolean(service);
  const qc = useQueryClient();
  const categories = useServiceCategories({ enabled: open });
  const employees = useEmployeeOptions({ bookable: true }, { enabled: open });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { register, handleSubmit, reset, control, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    reset({
      name: service?.name || '',
      categoryId: service?.categoryId || '',
      price: service?.price ?? '',
      durationMinutes: service?.durationMinutes ?? 30,
      commissionRate: service?.commissionRate ?? '',
      description: service?.description || '',
      isActive: service ? service.isActive : true,
      employeeIds: service?.employees?.map((e) => e.id) || [],
    });
  }, [open, service, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const body = { ...values, commissionRate: values.commissionRate === '' ? null : values.commissionRate, description: values.description || null };
    try {
      const res = isEdit ? await serviceApi.update(service.id, body) : await serviceApi.create(body);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: serviceKeys.all });
      qc.invalidateQueries({ queryKey: serviceKeys.categories });
      qc.invalidateQueries({ queryKey: ['employees'] });
      onClose();
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  const remove = async () => {
    try {
      const res = await serviceApi.remove(service.id);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: serviceKeys.all });
      setConfirmDelete(false);
      onClose();
    } catch (e) {
      toast.error(e.message);
    }
  };

  const currency = getFormatSettings().currency;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={isEdit ? 'Edit service' : 'New service'}
        footer={
          <>
            {isEdit ? <Button variant="danger-ghost" className="sm:mr-auto" onClick={() => setConfirmDelete(true)}>Delete</Button> : null}
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={onSubmit} loading={isSubmitting}>{isEdit ? 'Save changes' : 'Create service'}</Button>
          </>
        }
      >
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Input label="Service name" required className="sm:col-span-2" error={errors.name?.message} {...register('name')} />
          <Select label="Category" required placeholder="Choose category" options={(categories.data || []).map((c) => ({ value: c.id, label: c.name }))} error={errors.categoryId?.message} {...register('categoryId')} />
          <Input label={`Price (${currency})`} required type="number" min="0" step="any" error={errors.price?.message} {...register('price')} />
          <Input label="Duration (minutes)" required type="number" min="5" step="5" error={errors.durationMinutes?.message} {...register('durationMinutes')} />
          <Input label="Commission (%)" type="number" min="0" max="100" step="0.5" hint="Leave blank to use each stylist's own rate" error={errors.commissionRate?.message} {...register('commissionRate')} />
          <Textarea label="Description" rows={2} className="sm:col-span-2" error={errors.description?.message} {...register('description')} />
          <Controller control={control} name="isActive" render={({ field }) => <Switch className="sm:col-span-2" label="Active" description="Inactive services cannot be booked or sold." checked={field.value} onChange={field.onChange} />} />
          <div className="sm:col-span-2">
            <p className="mb-2 text-sm font-medium">Staff who perform this service</p>
            <Controller
              control={control}
              name="employeeIds"
              render={({ field }) => (
                <div className="grid gap-2 sm:grid-cols-2">
                  {(employees.data || []).map((e) => {
                    const checked = field.value?.includes(e.id);
                    return (
                      <label key={e.id} className={cn('flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2', checked ? 'border-brand-500/50 bg-brand-500/5' : 'border-line')}>
                        <input
                          type="checkbox"
                          className="size-4 accent-brand-500"
                          checked={checked}
                          onChange={() => field.onChange(checked ? field.value.filter((x) => x !== e.id) : [...field.value, e.id])}
                        />
                        <Avatar name={e.fullName} src={e.photo} size="xs" />
                        <span className="min-w-0 text-sm"><span className="block truncate font-medium">{e.fullName}</span><span className="block truncate text-xs text-muted">{e.jobTitle}</span></span>
                      </label>
                    );
                  })}
                  {employees.data && !employees.data.length ? <p className="text-sm text-muted">No bookable staff in this branch yet.</p> : null}
                </div>
              )}
            />
          </div>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        onConfirm={remove}
        danger
        title={`Delete ${service?.name}?`}
        message="Services with bookings or sales are deactivated instead, so reports stay accurate."
        confirmLabel="Delete service"
      />
    </>
  );
}
