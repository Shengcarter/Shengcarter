import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Input, Select, Switch, Textarea, applyServerErrors } from '../../components/ui';
import { SettingsSection, FieldGrid } from './SettingsSection';
import { useSaveSettings } from './api';
import { SplitBreakdown } from '../costing/SplitBreakdown';

/** The worked example shown under the split rules (the server does the real calculation). */
function exampleSplit(operationsRate, staffRate, profitRate) {
  const price = 50000;
  const productCost = 12000;
  const after = price - productCost;
  const operations = Math.round((after * operationsRate) / 100);
  const staffPool = Math.round(((after - operations) * staffRate) / 100);
  return {
    price, productCost, amountAfterProducts: after, operations, staffPool, salonProfit: after - operations - staffPool,
    rates: { operations: operationsRate, employee: staffRate, profit: profitRate },
  };
}

const CURRENCIES = [
  { value: 'TZS', label: 'TZS — Tanzanian Shilling' },
  { value: 'KES', label: 'KES — Kenyan Shilling' },
  { value: 'UGX', label: 'UGX — Ugandan Shilling' },
  { value: 'RWF', label: 'RWF — Rwandan Franc' },
  { value: 'ZAR', label: 'ZAR — South African Rand' },
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
];

const LOCALES = [
  { value: 'en-TZ', label: 'English (Tanzania)' },
  { value: 'sw-TZ', label: 'Kiswahili (Tanzania)' },
  { value: 'en-KE', label: 'English (Kenya)' },
  { value: 'en-UG', label: 'English (Uganda)' },
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
];

export function FinancialSettings({ values }) {
  const save = useSaveSettings('financial');
  const { register, handleSubmit, reset, control, watch, setValue, setError, formState: { errors, isDirty } } = useForm({ defaultValues: values });
  useEffect(() => reset(values), [values, reset]);
  const taxMode = watch('tax_mode');
  const [operationsRate, staffRate, profitRate] = watch(['operations_percentage', 'staff_pool_percentage', 'salon_profit_percentage']).map(Number);
  const splitAddsUp = Math.round(staffRate * 100) + Math.round(profitRate * 100) === 10000;

  const onSubmit = handleSubmit(async (data) => {
    try {
      await save.mutateAsync({
        ...data,
        currency_decimals: Number(data.currency_decimals),
        tax_rate: Number(data.tax_rate),
        number_padding: Number(data.number_padding),
        operations_percentage: Number(data.operations_percentage),
        staff_pool_percentage: Number(data.staff_pool_percentage),
        salon_profit_percentage: Number(data.salon_profit_percentage),
      });
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  return (
    <SettingsSection title="Financial settings" description="Currency, tax, document numbering and how the money from each service is split. The server applies these to every sale." onSubmit={onSubmit} saving={save.isPending} dirty={isDirty}>
      <FieldGrid cols={3}>
        <Select label="Currency" options={CURRENCIES} error={errors.currency_code?.message} {...register('currency_code')} />
        <Select
          label="Decimal places"
          options={[0, 1, 2, 3].map((n) => ({ value: n, label: n === 0 ? '0 (whole amounts)' : String(n) }))}
          error={errors.currency_decimals?.message}
          {...register('currency_decimals')}
        />
        <Select label="Number format" options={LOCALES} error={errors.currency_locale?.message} {...register('currency_locale')} />
      </FieldGrid>

      <FieldGrid cols={3}>
        <Select
          label="Tax mode"
          options={[
            { value: 'none', label: 'No tax — charge exactly the listed price' },
            { value: 'exclusive', label: 'Added on top of prices' },
            { value: 'inclusive', label: 'Included in prices' },
          ]}
          error={errors.tax_mode?.message}
          {...register('tax_mode')}
        />
        <Input label="Tax rate (%)" type="number" step="0.01" min="0" max="100" disabled={taxMode === 'none'} error={errors.tax_rate?.message} {...register('tax_rate')} />
        <Input label="Tax label" placeholder="VAT" disabled={taxMode === 'none'} error={errors.tax_label?.message} {...register('tax_label')} />
      </FieldGrid>

      <FieldGrid cols={3}>
        <Input label="Invoice prefix" hint="e.g. INV-" error={errors.invoice_prefix?.message} {...register('invoice_prefix')} />
        <Input label="Receipt prefix" hint="e.g. RCT-" error={errors.receipt_prefix?.message} {...register('receipt_prefix')} />
        <Input label="Number digits" type="number" min="3" max="10" hint="INV-000123 uses 6 digits" error={errors.number_padding?.message} {...register('number_padding')} />
      </FieldGrid>

      <FieldGrid>
        <Select
          label="Default receipt layout"
          options={[
            { value: 'thermal', label: 'Thermal receipt (80 mm)' },
            { value: 'a4', label: 'A4 invoice' },
          ]}
          {...register('receipt_format')}
        />
        <Controller
          control={control}
          name="allow_partial_payments"
          render={({ field }) => (
            <Switch
              className="self-end rounded-xl border border-line px-4 py-2.5"
              label="Allow partial payments"
              description="Customers may leave a balance on an invoice"
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
      </FieldGrid>
      <Textarea label="Receipt footer message" rows={2} error={errors.receipt_footer?.message} {...register('receipt_footer')} />

      <div className="rounded-2xl border border-line p-4">
        <h3 className="font-semibold">Service money split</h3>
        <p className="mt-0.5 text-sm text-muted">
          For every service sold: the price, minus the actual products used, gives what is left. Operations take their share of it first; the rest is
          divided between the staff who did the service (shared equally) and the salon. Changes apply to services sold from now on; past services keep
          the figures they were sold with.
        </p>
        <FieldGrid cols={3}>
          <Input label="Operations (%)" type="number" step="0.01" min="0" max="100" hint="Of what is left after products" error={errors.operations_percentage?.message} {...register('operations_percentage')} />
          <Input
            label="Staff (%)"
            type="number"
            step="0.01"
            min="0"
            max="100"
            hint="Of what is left after operations"
            error={errors.staff_pool_percentage?.message}
            {...register('staff_pool_percentage', { onChange: (e) => setValue('salon_profit_percentage', Math.max(0, 100 - Number(e.target.value || 0)), { shouldDirty: true }) })}
          />
          <Input label="Salon profit (%)" type="number" step="0.01" min="0" max="100" hint="Staff + salon = 100%" error={errors.salon_profit_percentage?.message || (!splitAddsUp ? 'Staff and salon profit must add up to 100%' : undefined)} {...register('salon_profit_percentage')} />
        </FieldGrid>
        {splitAddsUp && operationsRate >= 0 && operationsRate <= 100 ? (
          <div className="mt-4 max-w-md">
            <p className="mb-2 text-xs font-medium text-muted">Example: a 50,000 service using 12,000 of products</p>
            <SplitBreakdown compact split={exampleSplit(operationsRate, staffRate, profitRate)} />
          </div>
        ) : null}
      </div>
    </SettingsSection>
  );
}
