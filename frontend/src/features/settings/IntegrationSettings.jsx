import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { BrainCircuit, Mail, MessageCircle, MessageSquareText, Send } from 'lucide-react';
import { Badge, Button, Card, Input, Select, Switch, applyServerErrors } from '../../components/ui';
import { SettingsSection, FieldGrid } from './SettingsSection';
import { useSaveSettings } from './api';
import { http } from '../../api/client';

const SECRET_KEYS = ['smtp_password', 'sms_api_key', 'twilio_auth_token', 'whatsapp_access_token', 'ai_api_key'];

/** Password-style input for a stored secret. Blank keeps the saved value. */
function SecretInput({ label, name, status, register, onClear, cleared }) {
  const configured = status?.isSet && !cleared;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        {configured ? (
          <Badge tone="success" dot>{status.source === 'environment' ? 'Set in .env' : 'Saved'}</Badge>
        ) : (
          <Badge>Not set</Badge>
        )}
      </div>
      <Input
        aria-label={label}
        type="password"
        autoComplete="off"
        placeholder={configured ? '•••••••• (leave blank to keep)' : 'Enter value'}
        {...register(name)}
      />
      {status?.isSet && status.source === 'settings' && !cleared ? (
        <button type="button" onClick={onClear} className="text-xs text-danger hover:underline">Remove saved value</button>
      ) : null}
    </div>
  );
}

function TestMessage({ channel, placeholder }) {
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const res = await http.post('/settings/integrations/test', { channel, to });
      toast.success(res.message);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface-2/60 p-3 sm:flex-row sm:items-end">
      <Input className="flex-1" label="Send a test message to" placeholder={placeholder} value={to} onChange={(e) => setTo(e.target.value)} />
      <Button variant="secondary" icon={Send} loading={busy} disabled={to.length < 3} onClick={send}>Send test</Button>
    </div>
  );
}

function Block({ icon: Icon, title, description, children }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-gold-500/10 text-accent"><Icon className="size-4" /></span>
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export function IntegrationSettings({ values }) {
  const save = useSaveSettings('integrations');
  const [cleared, setCleared] = useState({});
  const defaults = { ...values, ...Object.fromEntries(SECRET_KEYS.map((k) => [k, ''])) };
  const { register, handleSubmit, reset, control, watch, setError, formState: { errors, isDirty } } = useForm({ defaultValues: defaults });
  useEffect(() => {
    reset({ ...values, ...Object.fromEntries(SECRET_KEYS.map((k) => [k, ''])) });
    setCleared({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, reset]);

  const emailProvider = watch('email_provider');
  const smsProvider = watch('sms_provider');
  const waProvider = watch('whatsapp_provider');
  const aiProvider = watch('ai_provider');

  const onSubmit = handleSubmit(async (data) => {
    const payload = { ...data, smtp_port: Number(data.smtp_port) };
    // Secrets: blank = keep, cleared = remove.
    SECRET_KEYS.forEach((key) => {
      if (cleared[key]) payload[key] = null;
      else if (!payload[key]) delete payload[key];
    });
    try {
      await save.mutateAsync(payload);
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  const secret = (key, label) => (
    <SecretInput
      label={label}
      name={key}
      status={values[key]}
      register={register}
      cleared={cleared[key]}
      onClear={() => setCleared((c) => ({ ...c, [key]: true }))}
    />
  );

  return (
    <SettingsSection
      title="Integrations"
      description="Connect email, SMS, WhatsApp and AI providers. Secrets are encrypted before they are stored and are never shown again. The salon keeps working offline if a provider is unreachable."
      onSubmit={onSubmit}
      saving={save.isPending}
      dirty={isDirty || Object.keys(cleared).length > 0}
    >
      <Block icon={Mail} title="Email" description="Password reset links and customer emails.">
        <FieldGrid cols={3}>
          <Select label="Provider" options={[{ value: 'log', label: 'Not configured (log only)' }, { value: 'smtp', label: 'SMTP server' }]} {...register('email_provider')} />
          <Input label="From name" {...register('email_from_name')} />
          <Input label="From address" type="email" error={errors.email_from_address?.message} {...register('email_from_address')} />
        </FieldGrid>
        {emailProvider === 'smtp' ? (
          <FieldGrid cols={3}>
            <Input label="SMTP host" placeholder="smtp.gmail.com" {...register('smtp_host')} />
            <Input label="Port" type="number" {...register('smtp_port')} />
            <Input label="Username" autoComplete="off" {...register('smtp_user')} />
            {secret('smtp_password', 'Password')}
            <Controller control={control} name="smtp_secure" render={({ field }) => <Switch className="self-end" label="Use SSL/TLS (port 465)" checked={field.value} onChange={field.onChange} />} />
          </FieldGrid>
        ) : null}
        <TestMessage channel="email" placeholder="you@example.com" />
      </Block>

      <Block icon={MessageSquareText} title="SMS" description="Appointment confirmations and reminders by text message.">
        <FieldGrid cols={3}>
          <Select
            label="Provider"
            options={[
              { value: 'log', label: 'Not configured (log only)' },
              { value: 'africastalking', label: "Africa's Talking" },
              { value: 'twilio', label: 'Twilio' },
            ]}
            {...register('sms_provider')}
          />
          <Input label="Sender ID" hint="Registered alphanumeric sender" {...register('sms_sender_id')} />
        </FieldGrid>
        {smsProvider === 'africastalking' ? (
          <FieldGrid>
            <Input label="Username" hint='Use "sandbox" for testing' {...register('sms_username')} />
            {secret('sms_api_key', 'API key')}
          </FieldGrid>
        ) : null}
        {smsProvider === 'twilio' || waProvider === 'twilio' ? (
          <FieldGrid cols={3}>
            <Input label="Twilio account SID" {...register('twilio_account_sid')} />
            {secret('twilio_auth_token', 'Twilio auth token')}
            <Input label="Twilio sender number" placeholder="+1…" {...register('twilio_from')} />
          </FieldGrid>
        ) : null}
        <TestMessage channel="sms" placeholder="+255712345678" />
      </Block>

      <Block icon={MessageCircle} title="WhatsApp Business" description="Confirmations, reminders and promotions over WhatsApp.">
        <FieldGrid>
          <Select
            label="Provider"
            options={[
              { value: 'log', label: 'Not configured (log only)' },
              { value: 'meta_cloud', label: 'Meta WhatsApp Cloud API' },
              { value: 'twilio', label: 'Twilio WhatsApp' },
            ]}
            {...register('whatsapp_provider')}
          />
        </FieldGrid>
        {waProvider === 'meta_cloud' ? (
          <FieldGrid>
            <Input label="Phone number ID" {...register('whatsapp_phone_number_id')} />
            {secret('whatsapp_access_token', 'Access token')}
          </FieldGrid>
        ) : null}
        <p className="text-xs text-muted">WhatsApp delivers free-form messages only within 24 hours of the customer's last message; outside that window Meta requires approved templates.</p>
        <TestMessage channel="whatsapp" placeholder="+255712345678" />
      </Block>

      <Block icon={BrainCircuit} title="AI insights" description="Optional. Without a key, built-in rule-based insights are used (works offline).">
        <FieldGrid cols={3}>
          <Select
            label="Provider"
            options={[
              { value: 'rule_based', label: 'Built-in rule-based insights' },
              { value: 'anthropic', label: 'Anthropic Claude' },
              { value: 'openai', label: 'OpenAI-compatible' },
            ]}
            {...register('ai_provider')}
          />
          {aiProvider !== 'rule_based' ? (
            <>
              <Input label="Model" placeholder={aiProvider === 'anthropic' ? 'claude-sonnet-5' : 'gpt-4.1-mini'} {...register('ai_model')} />
              {secret('ai_api_key', 'API key')}
            </>
          ) : null}
        </FieldGrid>
      </Block>
    </SettingsSection>
  );
}
