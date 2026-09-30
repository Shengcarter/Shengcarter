import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { BrainCircuit, Copy, Mail, MessageCircle, MessageSquareText, Send } from 'lucide-react';
import { Badge, Button, Card, Input, Select, Switch, applyServerErrors } from '../../components/ui';
import { SettingsSection, FieldGrid } from './SettingsSection';
import { useSaveSettings } from './api';
import { http } from '../../api/client';

const SECRET_KEYS = ['smtp_password', 'sms_api_key', 'twilio_auth_token', 'whatsapp_access_token', 'whatsapp_app_secret', 'ai_api_key'];

// Messages the salon starts on WhatsApp; each needs a template approved by Meta.
const WHATSAPP_MESSAGES = [
  { key: 'appointment_confirmation', label: 'Booking confirmation' },
  { key: 'appointment_reminder', label: 'Appointment reminder' },
  { key: 'appointment_cancelled', label: 'Appointment cancelled' },
  { key: 'payment_receipt', label: 'Thank-you after payment' },
];

/** "Hello {{customer_name}} … {{date}}" → "Hello {{1}} … {{2}}", the form WhatsApp templates use. */
function numberedTemplate(text) {
  const names = [];
  const numbered = String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => {
    if (!names.includes(name)) names.push(name);
    return `{{${names.indexOf(name) + 1}}}`;
  });
  return { numbered, names };
}

function copy(text) {
  navigator.clipboard?.writeText(text).then(() => toast.success('Copied'), () => toast.error('Could not copy; select the text instead'));
}

function randomToken() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return `zola-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** One row per message: the approved template's name (Meta) or Content SID (Twilio), and the text to submit. */
function WhatsAppTemplates({ provider, register, texts }) {
  const [open, setOpen] = useState(null);
  const twilio = provider === 'twilio';
  return (
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium">Approved message templates</p>
        <p className="mt-0.5 text-xs text-muted">
          WhatsApp only delivers messages the salon starts (confirmations, reminders, thank-you notes) when they use a template approved by Meta.
          Submit each text below as a <strong>Utility</strong> template{twilio ? ' in the Twilio Content Template Builder' : ' in WhatsApp Manager'}, then enter its {twilio ? 'Content SID (HX…)' : 'name and language'} here.
          Answers to a customer&apos;s reply need no template.
        </p>
      </div>
      <div className="divide-y divide-line rounded-xl border border-line">
        {WHATSAPP_MESSAGES.map((message) => {
          const { numbered, names } = numberedTemplate(texts?.[message.key]);
          return (
            <div key={message.key} className="space-y-2 px-4 py-3">
              <div className="grid items-end gap-3 sm:grid-cols-[1fr_2fr_7rem]">
                <p className="text-sm font-medium sm:pb-2.5">{message.label}</p>
                <Input
                  label={twilio ? 'Content SID' : 'Template name'}
                  placeholder={twilio ? 'HX…' : `e.g. ${message.key}`}
                  {...register(`whatsapp_templates.${message.key}.name`)}
                />
                {twilio ? <span /> : <Input label="Language" placeholder="en" {...register(`whatsapp_templates.${message.key}.language`)} />}
              </div>
              <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setOpen(open === message.key ? null : message.key)}>
                {open === message.key ? 'Hide the text to submit' : 'Show the text to submit'}
              </button>
              {open === message.key ? (
                <div className="space-y-1.5 rounded-lg bg-surface-2/70 p-3 text-xs">
                  <p className="whitespace-pre-wrap text-fg">{numbered}</p>
                  <p className="text-muted">{names.map((name, i) => `{{${i + 1}}} = ${name.replace(/_/g, ' ')}`).join(' · ')}</p>
                  <Button size="sm" variant="secondary" icon={Copy} onClick={() => copy(numbered)}>Copy text</Button>
                  <p className="text-muted">Tip: add quick-reply buttons “Confirm” and “Running late” to the booking and reminder templates; the system understands both.</p>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
        <span className="flex size-9 items-center justify-center rounded-xl bg-brand-500/10 text-accent"><Icon className="size-4" /></span>
        <div>
          <h3 className="font-semibold">{title}</h3>
          <p className="text-sm text-muted">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

export function IntegrationSettings({ values, all }) {
  const save = useSaveSettings('integrations');
  const [cleared, setCleared] = useState({});
  const defaults = { ...values, ...Object.fromEntries(SECRET_KEYS.map((k) => [k, ''])) };
  const { register, handleSubmit, reset, control, watch, setValue, setError, formState: { errors, isDirty } } = useForm({ defaultValues: defaults });
  useEffect(() => {
    reset({ ...values, ...Object.fromEntries(SECRET_KEYS.map((k) => [k, ''])) });
    setCleared({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, reset]);

  const emailProvider = watch('email_provider');
  const smsProvider = watch('sms_provider');
  const waProvider = watch('whatsapp_provider');
  const aiProvider = watch('ai_provider');
  const publicUrl = (watch('public_url') || '').trim().replace(/\/+$/, '');
  const webhookUrl = `${publicUrl || window.location.origin}/api/webhooks/whatsapp`;
  // WhatsApp can only call an internet address over HTTPS.
  const reachable = /^https:\/\//.test(webhookUrl) && !/^https:\/\/(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(webhookUrl);

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

      <Block icon={MessageCircle} title="WhatsApp Business" description="Booking confirmations, reminders, thank-you messages and customer replies over WhatsApp. Step-by-step guide: docs/WHATSAPP.md.">
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
        {waProvider === 'twilio' ? (
          <p className="text-xs text-muted">Uses the Twilio account SID, auth token and sender number above (the sender must be your WhatsApp-enabled Twilio number).</p>
        ) : null}
        {waProvider === 'log' ? (
          <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-warning">
            Not connected: WhatsApp messages are written to the server log instead of being sent. Choose a provider to start sending.
          </p>
        ) : null}

        {waProvider !== 'log' ? (
          <>
            <WhatsAppTemplates provider={waProvider} register={register} texts={all?.notifications?.templates} />

            <div className="space-y-3 rounded-xl border border-line p-4">
              <div>
                <p className="text-sm font-medium">Customer replies</p>
                <p className="mt-0.5 text-xs text-muted">
                  So that YES, LATE and other replies reach the system, give WhatsApp this callback address{waProvider === 'meta_cloud' ? ' and verify token (WhatsApp Manager → Configuration → Webhook, subscribe to "messages")' : ' (Twilio → your WhatsApp sender → "A message comes in", HTTP POST)'}.
                  It must be an internet (https) address; a system that only runs on the salon network cannot receive replies.
                </p>
              </div>
              <Input
                label="Internet address of this system"
                placeholder="https://salon.example.com"
                hint="Leave blank if you open the system at its internet address."
                error={errors.public_url?.message}
                {...register('public_url')}
              />
              <div className="space-y-1.5">
                <p className="text-sm font-medium">Callback URL</p>
                <div className="flex gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-xs">{webhookUrl}</code>
                  <Button variant="secondary" icon={Copy} onClick={() => copy(webhookUrl)}>Copy</Button>
                </div>
                {!reachable ? <p className="text-xs text-warning">WhatsApp cannot reach this address. Enter the system&apos;s https internet address above.</p> : null}
              </div>
              {waProvider === 'meta_cloud' ? (
                <FieldGrid>
                  <div className="space-y-1.5">
                    <Input label="Verify token" hint="Any word; type the same in WhatsApp Manager." error={errors.whatsapp_verify_token?.message} {...register('whatsapp_verify_token')} />
                    <button type="button" className="text-xs font-medium text-accent hover:underline" onClick={() => setValue('whatsapp_verify_token', randomToken(), { shouldDirty: true })}>Generate one</button>
                  </div>
                  {secret('whatsapp_app_secret', 'App secret')}
                </FieldGrid>
              ) : null}
              <p className="text-xs text-muted">
                {waProvider === 'meta_cloud'
                  ? 'The app secret (Meta app → App settings → Basic) proves each reply really comes from WhatsApp; replies are refused until it is saved.'
                  : 'Replies are checked with the Twilio auth token above; replies are refused until it is saved.'}
              </p>
            </div>
          </>
        ) : null}
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
