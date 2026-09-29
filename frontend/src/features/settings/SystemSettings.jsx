import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Input, Select, Switch, applyServerErrors } from '../../components/ui';
import { SettingsSection, FieldGrid } from './SettingsSection';
import { useSaveSettings } from './api';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function timezones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Africa/Dar_es_Salaam', 'Africa/Nairobi', 'Africa/Kampala', 'Africa/Kigali', 'Africa/Johannesburg', 'UTC'];
  }
}

export function SystemSettings({ values }) {
  const save = useSaveSettings('system');
  const zones = useMemo(() => timezones().map((z) => ({ value: z, label: z.replace(/_/g, ' ') })), []);
  const { register, handleSubmit, reset, control, setError, formState: { errors, isDirty } } = useForm({ defaultValues: values });
  useEffect(() => reset(values), [values, reset]);

  const onSubmit = handleSubmit(async (data) => {
    try {
      await save.mutateAsync({
        ...data,
        slot_interval_minutes: Number(data.slot_interval_minutes),
        appointment_buffer_minutes: Number(data.appointment_buffer_minutes),
        // Form state may hold an array for numeric keys; the API expects {"0": ..., "6": ...}.
        business_hours: Object.fromEntries(DAYS.map((_, i) => [String(i), data.business_hours[i]])),
      });
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  return (
    <SettingsSection title="System settings" description="Time zone, appearance and booking rules." onSubmit={onSubmit} saving={save.isPending} dirty={isDirty}>
      <FieldGrid cols={3}>
        <Select label="Time zone" options={zones} error={errors.timezone?.message} {...register('timezone')} />
        <Select label="Language" options={[{ value: 'en', label: 'English' }]} hint="The interface is currently available in English." {...register('language')} />
        <Select
          label="Default theme"
          hint="Used until each user picks their own."
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'Follow device' },
          ]}
          {...register('default_theme')}
        />
        <Select
          label="Clock format"
          options={[
            { value: '24h', label: '24-hour (14:30)' },
            { value: '12h', label: '12-hour (2:30 PM)' },
          ]}
          {...register('time_format')}
        />
        <Select label="Booking slot interval" options={[5, 10, 15, 20, 30, 60].map((n) => ({ value: n, label: `${n} minutes` }))} {...register('slot_interval_minutes')} />
        <Input label="Buffer between appointments (min)" type="number" min="0" max="120" error={errors.appointment_buffer_minutes?.message} {...register('appointment_buffer_minutes')} />
      </FieldGrid>

      <Controller
        control={control}
        name="enforce_working_hours"
        render={({ field }) => (
          <Switch
            className="rounded-xl border border-line px-4 py-3"
            label="Only allow bookings within working hours"
            description="Uses each employee's schedule, or the business hours below when no schedule is set."
            checked={field.value}
            onChange={field.onChange}
          />
        )}
      />

      <div>
        <p className="mb-2 text-sm font-medium">Business hours</p>
        <div className="divide-y divide-line rounded-xl border border-line">
          {DAYS.map((day, index) => (
            <div key={day} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <Controller
                control={control}
                name={`business_hours.${index}.open`}
                render={({ field }) => (
                  <label className="flex w-36 items-center gap-2 text-sm">
                    <input type="checkbox" checked={field.value} onChange={(e) => field.onChange(e.target.checked)} className="size-4 accent-brand-500" />
                    {day}
                  </label>
                )}
              />
              <input type="time" aria-label={`${day} opening time`} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm" {...register(`business_hours.${index}.start`)} />
              <span className="text-muted">–</span>
              <input type="time" aria-label={`${day} closing time`} className="h-9 rounded-lg border border-line bg-surface px-2 text-sm" {...register(`business_hours.${index}.end`)} />
            </div>
          ))}
        </div>
        {errors.business_hours ? <p className="mt-1 text-xs text-danger">{errors.business_hours.message || 'Check the business hours'}</p> : null}
      </div>
    </SettingsSection>
  );
}
