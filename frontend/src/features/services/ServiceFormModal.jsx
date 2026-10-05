import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Avatar, Button, Input, Modal, Select, Switch, Textarea, applyServerErrors, ConfirmDialog } from '../../components/ui';
import { cn } from '../../utils/cn';
import { formatMoney, getFormatSettings } from '../../utils/format';
import { usePermission } from '../../hooks';
import { ProductsUsedEditor, cleanUsage, usageCost } from '../costing/ProductsUsedEditor';
import { useUsableProducts } from '../costing/api';
import { useSplitRules } from '../costing/rules';
import { serviceApi, serviceKeys, useEmployeeOptions, useServiceCategories } from './api';
import { FinancialRuleModal } from './FinancialRuleModal';
import { describeRule } from './ruleText';

const schema = z.object({
  name: z.string().trim().min(1, 'Service name is required').max(120),
  categoryId: z.coerce.number({ error: 'Choose a category' }).int().positive('Choose a category'),
  price: z.coerce.number({ error: 'Enter a price' }).positive('Price must be greater than zero'),
  maxPrice: z.union([z.literal(''), z.coerce.number().positive('Must be greater than zero')]),
  durationMinutes: z.coerce.number({ error: 'Enter a duration' }).int().min(5, 'At least 5 minutes').max(720, 'At most 12 hours'),
  description: z.string().max(2000).optional(),
  isActive: z.boolean(),
  employeeIds: z.array(z.number()),
  recipe: z.array(z.object({ productId: z.number(), quantity: z.union([z.string(), z.number()]) })),
}).refine((v) => v.maxPrice === '' || v.maxPrice >= v.price, { path: ['maxPrice'], message: 'Cannot be lower than the starting price' });

/** Rough split of a price after the recipe's products, to show what a service leaves (the till works it out exactly). */
function estimate(price, productCost, rules) {
  const after = price - productCost;
  if (!(price > 0) || after <= 0) return null;
  const operations = Math.round((after * rules.operations) / 100);
  const staff = Math.round(((after - operations) * rules.staff) / 100);
  return { staff, profit: after - operations - staff, operations };
}

export function ServiceFormModal({ open, onClose, service }) {
  const isEdit = Boolean(service);
  const qc = useQueryClient();
  const categories = useServiceCategories({ enabled: open });
  const employees = useEmployeeOptions({ bookable: true }, { enabled: open });
  const products = useUsableProducts({ enabled: open });
  const can = usePermission();
  const showCosts = can('reports.financial') || can('sales.correct');
  const rules = useSplitRules();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ruleOpen, setRuleOpen] = useState(false);
  const canSeeRule = can('services.rules') || can('reports.financial');
  const { register, handleSubmit, reset, control, setError, watch, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    reset({
      name: service?.name || '',
      categoryId: service?.categoryId || '',
      price: service?.price ?? '',
      maxPrice: service?.maxPrice ?? '',
      durationMinutes: service?.durationMinutes ?? 30,
      description: service?.description || '',
      isActive: service ? service.isActive : true,
      employeeIds: service?.employees?.map((e) => e.id) || [],
      recipe: (service?.recipe || []).map((r) => ({ productId: r.productId, quantity: String(r.quantity), name: r.name, unit: r.unit })),
    });
  }, [open, service, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const body = {
      ...values,
      maxPrice: values.maxPrice === '' ? null : values.maxPrice,
      description: values.description || null,
      recipe: cleanUsage(values.recipe),
    };
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
  const [price, recipe] = watch(['price', 'recipe']);
  const expectedCost = usageCost(recipe || [], products.data || []);
  // The general formula's estimate only applies to services on the general formula.
  const onGeneral = !service?.financialRule || service.financialRule.method === 'general';
  const example = showCosts && onGeneral ? estimate(Number(price), expectedCost, rules) : null;

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
          <Input label="Duration (minutes)" required type="number" min="5" step="5" error={errors.durationMinutes?.message} {...register('durationMinutes')} />
          <Input label={`Price (${currency})`} required type="number" min="0" step="any" error={errors.price?.message} {...register('price')} />
          <Input
            label={`Highest price (${currency})`}
            type="number"
            min="0"
            step="any"
            hint="For services priced by length or complexity: the actual price is chosen at checkout. Leave blank for a fixed price."
            error={errors.maxPrice?.message}
            {...register('maxPrice')}
          />
          <Textarea label="Description" rows={2} className="sm:col-span-2" error={errors.description?.message} {...register('description')} />
          <Controller control={control} name="isActive" render={({ field }) => <Switch className="sm:col-span-2" label="Active" description="Inactive services cannot be booked or sold." checked={field.value} onChange={field.onChange} />} />
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line p-3 sm:col-span-2">
            <div className="min-w-0">
              <p className="text-sm font-medium">Financial rule</p>
              <p className={cn('text-xs', service?.financialRule?.method === 'unconfigured' ? 'text-warning' : 'text-muted')}>
                {isEdit ? describeRule(service.financialRule) : 'New services start on the general formula; set their own rule after saving.'}
              </p>
            </div>
            {isEdit && canSeeRule ? (
              <Button size="sm" variant="secondary" onClick={() => setRuleOpen(true)}>{can('services.rules') ? 'Change rule' : 'View rule'}</Button>
            ) : null}
          </div>
          <div className="rounded-xl border border-line p-3 sm:col-span-2">
            <p className="text-sm font-medium">Products normally used</p>
            <p className="mb-2 text-xs text-muted">
              The expected hair, jelly, gel and other products for one service, in this branch. They are filled in at checkout, where the stylist or cashier records what was actually used; the money split always uses the actual amounts.
            </p>
            <Controller
              control={control}
              name="recipe"
              render={({ field }) => (
                <ProductsUsedEditor value={field.value || []} onChange={field.onChange} products={products.data || []} showCosts={showCosts} emptyText="None: this service uses no products (or add them here)." idPrefix="recipe" />
              )}
            />
            {example ? (
              <p className="mt-2 text-xs text-muted">
                At {formatMoney(Number(price))} with {formatMoney(expectedCost)} of products: operations {formatMoney(example.operations)}, staff {formatMoney(example.staff)}, salon profit {formatMoney(example.profit)}.
              </p>
            ) : null}
          </div>
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
      {isEdit ? <FinancialRuleModal open={ruleOpen} onClose={() => setRuleOpen(false)} service={service} /> : null}
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
