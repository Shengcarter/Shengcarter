import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Input, Select, Switch, Textarea, applyServerErrors } from '../../components/ui';
import { SettingsSection, FieldGrid } from './SettingsSection';
import { useSaveSettings } from './api';

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
  const { register, handleSubmit, reset, control, watch, setError, formState: { errors, isDirty } } = useForm({ defaultValues: values });
  useEffect(() => reset(values), [values, reset]);
  const taxMode = watch('tax_mode');

  const onSubmit = handleSubmit(async (data) => {
    try {
      await save.mutateAsync({
        ...data,
        currency_decimals: Number(data.currency_decimals),
        tax_rate: Number(data.tax_rate),
        number_padding: Number(data.number_padding),
      });
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  return (
    <SettingsSection title="Financial settings" description="Currency, tax and document numbering. The server applies these to every sale." onSubmit={onSubmit} saving={save.isPending} dirty={isDirty}>
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
    </SettingsSection>
  );
}
