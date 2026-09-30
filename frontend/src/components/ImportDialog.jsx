import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { Badge, Button, Checkbox, Modal, Segmented } from './ui';
import { downloadFile, http } from '../api/client';
import { cn } from '../utils/cn';
import { formatNumber } from '../utils/format';

const STATUS = {
  ready: { label: 'Ready', tone: 'success' },
  skip: { label: 'Skipped', tone: 'neutral' },
  error: { label: 'Problem', tone: 'danger' },
};
const MAX_SHOWN = 200;

function Tile({ label, value, tone }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn('text-lg font-semibold tabular-nums', tone)}>{value}</p>
    </div>
  );
}

/**
 * Import records from an Excel (.xlsx) or CSV file in three steps: choose a
 * file (or download the template), check the preview, then import. The
 * server checks every row twice (preview and import) and saves all or nothing.
 *
 * type: 'customers' | 'sales'; columns: [{ key, header, render? }] for the
 * preview table (keys of each row's `display`); noun: ['customer', 'customers'].
 */
export function ImportDialog({ open, onClose, type, title, intro, notice, columns, noun, summaryTiles, invalidate = [] }) {
  const qc = useQueryClient();
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [filter, setFilter] = useState('all');
  const [dragging, setDragging] = useState(false);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setError(null);
    setSkipInvalid(false);
    setFilter('all');
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const check = async (chosen) => {
    setFile(chosen);
    setPreview(null);
    setError(null);
    setBusy(true);
    try {
      const res = await http.upload(`/imports/${type}/preview`, 'file', chosen);
      setPreview(res.data);
      setFilter(res.data.summary.errors ? 'error' : 'all');
    } catch (e) {
      setError(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (list) => {
    const chosen = list?.[0];
    if (chosen) check(chosen);
  };

  const runImport = async () => {
    setBusy(true);
    try {
      const res = await http.upload(`/imports/${type}`, 'file', file, { skipInvalid: String(skipInvalid) });
      setResult(res.data);
      toast.success(res.message);
      for (const key of invalidate) qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  const template = () => downloadFile(`/imports/${type}/template`, {}, `${type}-import-template.xlsx`).catch((e) => toast.error(e.message));

  const rows = useMemo(() => (preview ? preview.rows.filter((r) => filter === 'all' || r.status === filter) : []), [preview, filter]);
  const s = preview?.summary;
  const canImport = s && s.ready > 0 && (!s.errors || skipInvalid);
  const plural = (n) => `${formatNumber(n)} ${n === 1 ? noun[0] : noun[1]}`;

  let footer = null;
  if (result) {
    footer = <Button onClick={close}>Done</Button>;
  } else if (preview) {
    footer = (
      <>
        <Button variant="ghost" onClick={() => inputRef.current?.click()} disabled={busy}>Choose another file</Button>
        <Button icon={Upload} loading={busy} disabled={!canImport} onClick={runImport}>
          {s.ready ? `Import ${plural(type === 'sales' ? s.sales : s.ready)}` : 'Nothing to import'}
        </Button>
      </>
    );
  } else {
    footer = <Button variant="ghost" onClick={close}>Cancel</Button>;
  }

  return (
    <Modal open={open} onClose={close} title={title} size="xl" footer={footer}>
      <input ref={inputRef} type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />

      {result ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <CheckCircle2 className="size-12 text-success" aria-hidden />
          <p className="font-display text-xl font-semibold">Import complete</p>
          <p className="text-sm text-muted">
            {plural(result.imported)} imported from {result.fileName}
            {result.summary.skipped ? ` · ${formatNumber(result.summary.skipped)} skipped` : ''}
            {result.summary.errors ? ` · ${formatNumber(result.summary.errors)} rows with problems left out` : ''}
            {result.newCustomers ? ` · ${formatNumber(result.newCustomers)} new customer${result.newCustomers === 1 ? '' : 's'} added` : ''}.
          </p>
        </div>
      ) : !preview ? (
        <div className="space-y-4">
          {intro ? <div className="space-y-1.5 text-sm text-muted">{intro}</div> : null}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files); }}
            disabled={busy}
            className={cn(
              'flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragging ? 'border-brand-500 bg-brand-500/5' : 'border-line hover:border-brand-500/50 hover:bg-surface-2',
            )}
          >
            <FileSpreadsheet className="size-10 text-accent" aria-hidden />
            <span className="font-medium">{busy ? `Checking ${file?.name}…` : 'Choose an Excel or CSV file'}</span>
            <span className="text-xs text-muted">or drag it here · .xlsx or .csv · up to 5,000 rows</span>
          </button>
          {error ? <p className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-danger" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface-2 px-4 py-3 text-sm">
            <span className="text-muted">New to this? Start from the template: it has the right columns and drop-down lists.</span>
            <Button size="sm" variant="secondary" icon={Download} onClick={template}>Download template</Button>
          </div>
          {notice ? <p className="text-xs text-muted">{notice}</p> : null}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Rows in file" value={formatNumber(s.rows)} />
            <Tile label="Ready to import" value={formatNumber(s.ready)} tone="text-success" />
            <Tile label="Skipped" value={formatNumber(s.skipped)} />
            <Tile label="With problems" value={formatNumber(s.errors)} tone={s.errors ? 'text-danger' : undefined} />
            {summaryTiles ? summaryTiles(s).map((t) => <Tile key={t.label} {...t} />) : null}
          </div>
          <p className="text-xs text-muted">
            <span className="font-medium text-fg">{preview.fileName}</span> · columns read: {preview.columns.mapped.map((c) => (c.header === c.label ? c.label : `${c.label} (“${c.header}”)`)).join(', ')}
            {preview.columns.ignored.length ? ` · ignored: ${preview.columns.ignored.join(', ')}` : ''}
          </p>
          {error ? <p className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-danger" role="alert"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}</p> : null}
          <Segmented
            size="sm"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: `All (${formatNumber(s.rows)})` },
              { value: 'error', label: `Problems (${formatNumber(s.errors)})` },
              { value: 'skip', label: `Skipped (${formatNumber(s.skipped)})` },
              { value: 'ready', label: `Ready (${formatNumber(s.ready)})` },
            ]}
          />
          <div className="max-h-[45vh] overflow-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="sticky top-0 bg-surface-2 text-xs text-muted uppercase">
                <tr>
                  <th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  {columns.map((c) => <th key={c.key} className={cn('px-3 py-2 font-medium', c.align === 'right' && 'text-right')}>{c.header}</th>)}
                  <th className="px-3 py-2 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.slice(0, MAX_SHOWN).map((r) => (
                  <tr key={r.rowNumber} className="align-top">
                    <td className="px-3 py-2 text-muted tabular-nums">{r.rowNumber}</td>
                    <td className="px-3 py-2"><Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge></td>
                    {columns.map((c) => (
                      <td key={c.key} className={cn('px-3 py-2', c.align === 'right' && 'text-right tabular-nums')}>{c.render ? c.render(r.display) : r.display[c.key] || '—'}</td>
                    ))}
                    <td className={cn('px-3 py-2 text-xs', r.status === 'error' ? 'text-danger' : 'text-muted')}>{r.messages.join(' ') || '—'}</td>
                  </tr>
                ))}
                {!rows.length ? <tr><td colSpan={columns.length + 3} className="px-3 py-6 text-center text-muted">No rows here.</td></tr> : null}
              </tbody>
            </table>
          </div>
          {rows.length > MAX_SHOWN ? <p className="text-xs text-muted">Showing the first {MAX_SHOWN} of {formatNumber(rows.length)} rows.</p> : null}
          {s.errors ? (
            <Checkbox
              checked={skipInvalid}
              onChange={(e) => setSkipInvalid(e.target.checked)}
              label={`Skip the ${formatNumber(s.errors)} row${s.errors === 1 ? '' : 's'} with problems and import the rest`}
              description="Or fix them in your file and choose it again."
            />
          ) : null}
          {notice ? <p className="text-xs text-muted">{notice}</p> : null}
        </div>
      )}
    </Modal>
  );
}
