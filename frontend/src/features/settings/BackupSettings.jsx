import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, DatabaseBackup, Download, HardDriveDownload, Info, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardHeader, ConfirmDialog, DataTable, EmptyState, ErrorState, Input, Select, SkeletonRows, StatusBadge, Switch } from '../../components/ui';
import { downloadFile, http } from '../../api/client';
import { formatDateTime, formatNumber } from '../../utils/format';

const SCHEDULES = [
  { value: '0 23 * * *', label: 'Every day at 23:00' },
  { value: '0 2 * * *', label: 'Every day at 02:00' },
  { value: '0 13,23 * * *', label: 'Twice a day (13:00 and 23:00)' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
  { value: '0 23 * * 0', label: 'Every Sunday at 23:00' },
  { value: 'custom', label: 'Custom (cron expression)' },
];

function size(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, { maximumFractionDigits: 0 })} KB`;
  return `${formatNumber(bytes / 1024 / 1024, { maximumFractionDigits: 1 })} MB`;
}

function ScheduleForm({ settings, onSaved }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const known = SCHEDULES.some((s) => s.value === form.cron);
  const [mode, setMode] = useState(known ? form.cron : 'custom');
  useEffect(() => setForm(settings), [settings]);

  const save = async () => {
    setSaving(true);
    try {
      await http.put('/backups/settings', { auto_enabled: form.auto_enabled, cron: form.cron, retention_count: Number(form.retention_count) });
      toast.success('Backup schedule saved');
      onSaved();
    } catch (error) {
      toast.error(error.errors?.[0]?.message || error.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Automatic backups" description="Runs on the server even when nobody is signed in." icon={DatabaseBackup} />
      <div className="space-y-4 px-5 pb-5">
        <Switch label="Back up automatically" description="Recommended: a nightly backup after closing time." checked={Boolean(form.auto_enabled)} onChange={(v) => setForm({ ...form, auto_enabled: v })} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Schedule"
            value={mode}
            disabled={!form.auto_enabled}
            onChange={(e) => {
              setMode(e.target.value);
              if (e.target.value !== 'custom') setForm({ ...form, cron: e.target.value });
            }}
            options={SCHEDULES}
          />
          <Input
            label="Keep the latest"
            type="number"
            min="1"
            max="365"
            hint="Older automatic backups are deleted. Manual backups are always kept."
            value={form.retention_count}
            onChange={(e) => setForm({ ...form, retention_count: e.target.value })}
          />
          {mode === 'custom' ? (
            <Input
              label="Cron expression"
              className="sm:col-span-2"
              hint="minute hour day month weekday, in the business time zone — e.g. 30 22 * * 1-6"
              value={form.cron}
              disabled={!form.auto_enabled}
              onChange={(e) => setForm({ ...form, cron: e.target.value })}
            />
          ) : null}
        </div>
        <div className="flex justify-end">
          <Button icon={Save} loading={saving} onClick={save}>Save schedule</Button>
        </div>
      </div>
    </Card>
  );
}

export function BackupSettings() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['backups'], queryFn: () => http.get('/backups').then((r) => r.data) });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => qc.invalidateQueries({ queryKey: ['backups'] });

  const create = async () => {
    setCreating(true);
    try {
      const res = await http.post('/backups', {});
      toast.success(`${res.message}: ${res.data.filename}`);
      refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setCreating(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await http.delete(`/backups/${deleting.id}`);
      toast.success('Backup deleted');
      setDeleting(null);
      refresh();
    } catch (error) {
      toast.error(error.message);
    } finally {
      setBusy(false);
    }
  };

  if (query.isPending) return <SkeletonRows rows={6} />;
  if (query.isError) return <ErrorState error={query.error} onRetry={query.refetch} />;
  const { backups, settings, protection = {} } = query.data;
  const last = backups.find((b) => b.status === 'completed');

  return (
    <div className="space-y-6">
      <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-brand-500/12 text-accent ring-1 ring-brand-500/20"><HardDriveDownload className="size-5" aria-hidden /></span>
        <div className="flex-1">
          <p className="font-semibold">Database backup</p>
          <p className="text-sm text-muted">{last ? `Last successful backup ${formatDateTime(last.completedAt || last.createdAt)} (${size(last.sizeBytes)}).` : 'No backup has been made yet.'}</p>
        </div>
        <Button icon={DatabaseBackup} loading={creating} onClick={create}>Back up now</Button>
      </Card>

      <Card className="space-y-2 p-5 text-sm">
        <p className="font-medium">Protection of the backup files</p>
        {[
          [protection.encrypted, 'Encrypted', 'Files are encrypted: a stolen copy cannot be read without the key.', 'Not encrypted: set BACKUP_ENCRYPTION_KEY in .env (and keep the key somewhere safe off this server).'],
          [protection.copied, 'Second copy', 'Every backup is also copied to the second location set in BACKUP_COPY_DIR.', 'Only on this server: set BACKUP_COPY_DIR in .env to a USB drive, NAS or cloud-synced folder, or download copies regularly.'],
        ].map(([ok, label, good, bad]) => (
          <p key={label} className={ok ? 'flex items-start gap-2 text-success' : 'flex items-start gap-2 text-warning'}>
            {ok ? <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />}
            <span><span className="font-medium">{label}:</span> {ok ? good : bad}</span>
          </p>
        ))}
      </Card>

      <ScheduleForm settings={settings} onSaved={refresh} />

      <Card className="overflow-hidden">
        <CardHeader title="Backup files" description="Stored on the server in the protected backup folder. Download copies to a USB drive or cloud storage regularly." />
        <DataTable
          rows={backups}
          empty={<EmptyState icon={DatabaseBackup} title="No backups yet" description="Create the first one with “Back up now”." />}
          columns={[
            { key: 'filename', header: 'File', primary: true, render: (b) => <span className="font-mono text-xs break-all">{b.filename}</span> },
            { key: 'type', header: 'Type', render: (b) => <Badge tone={b.type === 'scheduled' ? 'info' : 'brand'}>{b.type === 'scheduled' ? 'Automatic' : 'Manual'}</Badge> },
            { key: 'status', header: 'Status', render: (b) => <span title={b.error || undefined}><StatusBadge status={b.status} /></span> },
            { key: 'size', header: 'Size', align: 'right', render: (b) => <span className="whitespace-nowrap">{size(b.sizeBytes)}</span> },
            {
              key: 'createdAt', header: 'Created', hideOnMobile: true,
              render: (b) => <span className="whitespace-nowrap">{formatDateTime(b.createdAt)}<span className="block text-xs text-muted">{b.createdByName || (b.type === 'scheduled' ? 'Scheduler' : 'Command line')}</span></span>,
            },
            {
              key: 'actions',
              header: '',
              align: 'right',
              render: (b) => (
                <div className="flex justify-end gap-1">
                  {b.status === 'completed' && b.fileExists ? (
                    <Button size="xs" variant="secondary" icon={Download} onClick={() => downloadFile(`/backups/${b.id}/download`, {}, b.filename).catch((e) => toast.error(e.message))}>Download</Button>
                  ) : null}
                  {b.status !== 'running' ? (
                    <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-red-500/10 hover:text-danger" onClick={() => setDeleting(b)} aria-label={`Delete ${b.filename}`}><Trash2 className="size-4" /></button>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Card className="p-5">
        <div className="flex gap-3">
          <Info className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div className="space-y-2 text-sm text-muted">
            <p className="font-medium text-fg">Restoring a backup</p>
            <p>Restoring replaces all current data, so it is done on the server, not in the browser. Stop the application, then run:</p>
            <pre className="overflow-x-auto rounded-xl bg-surface-2 px-4 py-3 font-mono text-xs text-fg">cd backend{'\n'}npm run restore -- storage/backups/&lt;file name&gt;</pre>
            <p>An encrypted backup (<span className="font-mono text-fg">.enc</span>) needs the same <span className="font-mono text-fg">BACKUP_ENCRYPTION_KEY</span> in <span className="font-mono text-fg">.env</span>; it is checked in full before anything is changed, so a damaged or altered file is refused.</p>
            <p>On Windows you can also double-click <span className="font-mono text-fg">restore.bat</span> in the installation folder. Uploaded files (logo, photos, receipts) live in <span className="font-mono text-fg">backend/storage/uploads</span> — the Windows <span className="font-mono text-fg">backup.bat</span> copies them too.</p>
          </div>
        </div>
      </Card>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        danger
        loading={busy}
        title="Delete this backup?"
        message={`${deleting?.filename} will be permanently removed from the server.`}
        confirmLabel="Delete backup"
      />
    </div>
  );
}
