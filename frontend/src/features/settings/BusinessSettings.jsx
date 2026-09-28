import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ImagePlus, Trash2 } from 'lucide-react';
import { Button, Input, Textarea, applyServerErrors, BrandMark } from '../../components/ui';
import { SettingsSection, FieldGrid } from './SettingsSection';
import { refreshAppSettings, useSaveSettings } from './api';
import { http } from '../../api/client';

function LogoUploader({ logo, onChanged }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await http.upload('/settings/business/logo', 'logo', file);
      toast.success(res.message);
      onChanged();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await http.delete('/settings/business/logo');
      toast.success('Logo removed');
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      <BrandMark logo={logo || undefined} className="size-16 rounded-2xl ring-1 ring-line" />
      <div className="space-y-2">
        <p className="text-sm font-medium">Salon logo</p>
        <p className="text-xs text-muted">PNG, JPG or WEBP, up to 5 MB. Shown on receipts, invoices and the sidebar.</p>
        <div className="flex gap-2">
          <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
          <Button size="sm" variant="secondary" icon={ImagePlus} loading={busy} onClick={() => input.current?.click()}>
            Upload logo
          </Button>
          {logo ? (
            <Button size="sm" variant="danger-ghost" icon={Trash2} disabled={busy} onClick={remove}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function BusinessSettings({ values, onReload }) {
  const save = useSaveSettings('business');
  const { register, handleSubmit, reset, setError, formState: { errors, isDirty } } = useForm({ defaultValues: values });
  useEffect(() => reset(values), [values, reset]);

  const onSubmit = handleSubmit(async (data) => {
    // eslint-disable-next-line no-unused-vars
    const { logo, ...rest } = data;
    try {
      await save.mutateAsync(rest);
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  return (
    <SettingsSection
      title="Business information"
      description="Appears on receipts, invoices, reports and customer messages."
      onSubmit={onSubmit}
      saving={save.isPending}
      dirty={isDirty}
    >
      <LogoUploader logo={values.logo} onChanged={async () => { await refreshAppSettings(); onReload(); }} />
      <FieldGrid>
        <Input label="Salon name" required error={errors.salon_name?.message} {...register('salon_name')} />
        <Input label="Phone" error={errors.phone?.message} {...register('phone')} />
        <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <Input label="Website" error={errors.website?.message} {...register('website')} />
        <Input label="TIN (tax identification number)" error={errors.tax_number?.message} {...register('tax_number')} />
        <Input label="VAT registration number" error={errors.vat_number?.message} {...register('vat_number')} />
      </FieldGrid>
      <Textarea label="Address" rows={2} error={errors.address?.message} {...register('address')} />
    </SettingsSection>
  );
}
