import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Input, Switch, Textarea, applyServerErrors } from '../../components/ui';
import { SettingsSection, FieldGrid } from './SettingsSection';
import { useSaveSettings } from './api';

const EVENTS = [
  { key: 'appointment_confirmation', label: 'Appointment confirmation', description: 'Sent when an appointment is booked.' },
  { key: 'appointment_reminder', label: 'Appointment reminder', description: 'Sent before the appointment (see reminder timing).' },
  { key: 'appointment_cancelled', label: 'Appointment cancelled', description: 'Sent when an appointment is cancelled.' },
  { key: 'payment_receipt', label: 'Payment confirmation', description: 'Sent after a sale is completed.' },
];
const CHANNELS = [
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
];
const PLACEHOLDERS = ['{{customer_name}}', '{{salon_name}}', '{{date}}', '{{time}}', '{{stylist}}', '{{code}}', '{{services}}', '{{amount}}', '{{invoice_number}}'];

export function NotificationSettings({ values }) {
  const save = useSaveSettings('notifications');
  const { register, handleSubmit, reset, control, setError, formState: { errors, isDirty } } = useForm({ defaultValues: values });
  useEffect(() => reset(values), [values, reset]);

  const onSubmit = handleSubmit(async (data) => {
    try {
      await save.mutateAsync({ ...data, reminder_hours_before: Number(data.reminder_hours_before) });
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  return (
    <SettingsSection
      title="Customer notifications"
      description="Choose which messages customers receive and on which channels. Channels must be set up under Integrations."
      onSubmit={onSubmit}
      saving={save.isPending}
      dirty={isDirty}
    >
      <FieldGrid>
        <Controller
          control={control}
          name="reminders_enabled"
          render={({ field }) => (
            <Switch className="rounded-xl border border-line px-4 py-3" label="Send appointment reminders" checked={field.value} onChange={field.onChange} />
          )}
        />
        <Input label="Send reminders this many hours before" type="number" min="1" max="168" error={errors.reminder_hours_before?.message} {...register('reminder_hours_before')} />
      </FieldGrid>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
              <th className="px-4 py-3 font-medium">Event</th>
              {CHANNELS.map((c) => <th key={c.key} className="px-4 py-3 text-center font-medium">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {EVENTS.map((event) => (
              <tr key={event.key} className="border-b border-line last:border-0">
                <td className="px-4 py-3">
                  <p className="font-medium">{event.label}</p>
                  <p className="text-xs text-muted">{event.description}</p>
                </td>
                {CHANNELS.map((channel) => (
                  <td key={channel.key} className="px-4 py-3 text-center">
                    <Controller
                      control={control}
                      name={`channels.${event.key}`}
                      render={({ field }) => {
                        const list = field.value || [];
                        const checked = list.includes(channel.key);
                        return (
                          <input
                            type="checkbox"
                            aria-label={`${event.label} via ${channel.label}`}
                            className="size-4 accent-brand-500"
                            checked={checked}
                            onChange={() => field.onChange(checked ? list.filter((c) => c !== channel.key) : [...list, channel.key])}
                          />
                        );
                      }}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">Message templates</p>
          <p className="mt-1 text-xs text-muted">
            Placeholders: {PLACEHOLDERS.map((p) => <code key={p} className="mr-1.5 rounded bg-surface-2 px-1 py-0.5">{p}</code>)}
          </p>
        </div>
        {EVENTS.map((event) => (
          <Textarea key={event.key} label={event.label} rows={2} error={errors.templates?.[event.key]?.message} {...register(`templates.${event.key}`)} />
        ))}
      </div>
    </SettingsSection>
  );
}
