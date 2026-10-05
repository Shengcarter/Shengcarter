import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CircleCheck, CircleX } from 'lucide-react';
import { Card, CardHeader, applyServerErrors } from '../../components/ui';
import { http } from '../../api/client';
import { cn } from '../../utils/cn';
import { SettingsSection } from './SettingsSection';
import { useSaveSettings } from './api';

const OPTIONS = [
  { value: 'none', label: 'Optional', description: 'Anyone may turn it on for their own account (My profile → Two-step sign-in).' },
  { value: 'admins', label: 'Required for administrators', description: 'The Super Admin and anyone who can manage users, roles, settings or backups must use it. Recommended.' },
  { value: 'all', label: 'Required for everyone', description: 'Every account needs a code from an authenticator app to sign in.' },
];

const ICONS = { ok: CircleCheck, warn: AlertTriangle, fail: CircleX };
const TONES = { ok: 'text-success', warn: 'text-warning', fail: 'text-danger' };

/** How this installation is protected (from the server's configuration; no secret values). */
function SecurityChecklist() {
  const query = useQuery({ queryKey: ['settings', 'security-check'], queryFn: () => http.get('/settings/security-check').then((r) => r.data) });
  if (!query.data) return null;
  const problems = query.data.checks.filter((c) => c.status !== 'ok').length;
  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Security checklist"
        description={problems ? `${problems} thing${problems === 1 ? '' : 's'} to fix before real use (most are set in the server's .env file).` : 'Everything checked here is in place.'}
      />
      <ul className="divide-y divide-line">
        {query.data.checks.map((c) => {
          const Icon = ICONS[c.status];
          return (
            <li key={c.id} className="flex items-start gap-3 px-5 py-3 sm:px-6">
              <Icon className={cn('mt-0.5 size-4 shrink-0', TONES[c.status])} aria-label={c.status} />
              <div className="min-w-0 text-sm">
                <p className="font-medium">{c.label}</p>
                <p className="text-muted">{c.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** Settings → Security: the checklist, and who must use two-step sign-in. */
export function SecuritySettings(props) {
  return (
    <div className="space-y-6">
      <SecurityChecklist />
      <TwoStepPolicy {...props} />
    </div>
  );
}

function TwoStepPolicy({ values }) {
  const save = useSaveSettings('security');
  const { register, handleSubmit, reset, watch, setError, formState: { isDirty } } = useForm({ defaultValues: values });
  useEffect(() => reset(values), [values, reset]);
  const chosen = watch('two_factor_required');

  const onSubmit = handleSubmit(async (data) => {
    try {
      await save.mutateAsync({ two_factor_required: data.two_factor_required });
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  return (
    <SettingsSection
      title="Two-step sign-in"
      description="A 6-digit code from an authenticator app on the phone, after the password. A stolen password alone then cannot open the account."
      onSubmit={onSubmit}
      saving={save.isPending}
      dirty={isDirty}
    >
      <fieldset className="space-y-2">
        <legend className="sr-only">Who must use two-step sign-in</legend>
        {OPTIONS.map((o) => (
          <label key={o.value} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3', chosen === o.value ? 'border-brand-500/50 bg-brand-500/5' : 'border-line')}>
            <input type="radio" value={o.value} className="mt-1 size-4 accent-brand-500" {...register('two_factor_required')} />
            <span>
              <span className="block text-sm font-medium">{o.label}</span>
              <span className="block text-xs text-muted">{o.description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {chosen !== 'none' ? (
        <p className="flex items-start gap-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          People it applies to who have not set it up yet (possibly you) are asked to set it up straight away, before they can do anything else. Each person keeps recovery codes; an administrator can reset it for someone who loses their phone (Settings → Users).
        </p>
      ) : null}
    </SettingsSection>
  );
}
