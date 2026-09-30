import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { MessageCircle } from 'lucide-react';
import { Input, Switch, Textarea, applyServerErrors } from '../../components/ui';
import { SettingsSection, FieldGrid } from './SettingsSection';
import { useSaveSettings } from './api';

const EVENTS = [
  { key: 'appointment_confirmation', label: 'Booking confirmation', description: 'Sent when an appointment is booked (not for walk-ins). Asks the customer to confirm or say if they will be late.' },
  { key: 'appointment_reminder', label: 'Appointment reminder', description: 'Sent before the appointment (see reminder timing). Asks again to confirm or report a delay.' },
  { key: 'appointment_cancelled', label: 'Appointment cancelled', description: 'Sent when an appointment is cancelled.' },
  { key: 'payment_receipt', label: 'Thank-you after payment', description: 'Sent when the customer pays: thanks them and welcomes them back.' },
];
const REPLIES = [
  { key: 'reply_confirmed', label: 'When the customer confirms', description: 'Customer replied YES (or OK, SAWA, NDIYO, 👍).' },
  { key: 'reply_late', label: 'When the customer will be late', description: 'Customer replied LATE 15 (or "nitachelewa dakika 15"). {{delay}} becomes "about 15 minutes late".' },
  { key: 'reply_received', label: 'When the customer wants to cancel or change', description: 'Customer replied CANCEL, NO or SITAKUJA. Your team is alerted to call them.' },
];
const CHANNELS = [
  { key: 'sms', label: 'SMS' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'email', label: 'Email' },
];
const PLACEHOLDERS = ['{{customer_name}}', '{{salon_name}}', '{{date}}', '{{time}}', '{{stylist}}', '{{code}}', '{{services}}', '{{amount}}', '{{invoice_number}}', '{{delay}}'];

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
              <th className="px-4 py-3 font-medium">Message</th>
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
          <p className="text-sm font-medium">Message texts</p>
          <p className="mt-1 text-xs text-muted">
            Placeholders: {PLACEHOLDERS.map((p) => <code key={p} className="mr-1.5 rounded bg-surface-2 px-1 py-0.5">{p}</code>)}
          </p>
        </div>
        {EVENTS.map((event) => (
          <Textarea key={event.key} label={event.label} rows={3} error={errors.templates?.[event.key]?.message} {...register(`templates.${event.key}`)} />
        ))}
      </div>

      <div className="space-y-4 rounded-2xl border border-line p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-accent"><MessageCircle className="size-4" aria-hidden /></span>
          <div>
            <p className="text-sm font-medium">When customers reply on WhatsApp</p>
            <p className="mt-0.5 text-xs text-muted">
              A reply of YES confirms the appointment and LATE with the minutes marks it as running late, both on the calendar. CANCEL alerts your team to call the customer; nothing is cancelled automatically.
              Any other message is passed to the front desk, and STOP turns off automatic messages for that customer.
              These answers go back to the customer straight away. Replies only arrive once WhatsApp is connected under Integrations.
            </p>
          </div>
        </div>
        {REPLIES.map((reply) => (
          <Textarea
            key={reply.key}
            label={reply.label}
            hint={reply.description}
            rows={2}
            error={errors.templates?.[reply.key]?.message}
            {...register(`templates.${reply.key}`)}
          />
        ))}
      </div>
    </SettingsSection>
  );
}
