import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Button, Card, IconButton, Input, Modal, SkeletonRows, Switch } from '../../components/ui';
import { http } from '../../api/client';
import { formatMoney, formatNumber, getFormatSettings } from '../../utils/format';
import { refreshAppSettings } from './api';

function TierModal({ tier, onClose }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (tier) setForm({ name: tier.name || '', minPoints: tier.minPoints ?? '', pointsMultiplier: tier.pointsMultiplier ?? 1, color: tier.color || '#E3166A', benefits: tier.benefits || '' });
  }, [tier]);
  if (!tier || !form) return null;
  const submit = async () => {
    setBusy(true);
    try {
      const body = { ...form, minPoints: Number(form.minPoints), pointsMultiplier: Number(form.pointsMultiplier) };
      const res = tier.id ? await http.patch(`/loyalty/tiers/${tier.id}`, body) : await http.post('/loyalty/tiers', body);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['loyalty-tiers'] });
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={Boolean(tier)} onClose={onClose} size="sm" title={tier.id ? 'Edit tier' : 'New tier'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Save</Button></>}>
      <div className="grid grid-cols-2 gap-4">
        <Input label="Name" className="col-span-2" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Lifetime points needed" type="number" min="0" value={form.minPoints} onChange={(e) => setForm({ ...form, minPoints: e.target.value })} />
        <Input label="Points multiplier" type="number" min="0" step="0.05" hint="1.25 = 25% bonus points" value={form.pointsMultiplier} onChange={(e) => setForm({ ...form, pointsMultiplier: e.target.value })} />
        <Input label="Colour" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
        <Input label="Benefits" className="col-span-2" value={form.benefits} onChange={(e) => setForm({ ...form, benefits: e.target.value })} />
      </div>
    </Modal>
  );
}

export function LoyaltySettings() {
  const qc = useQueryClient();
  const program = useQuery({ queryKey: ['loyalty-program'], queryFn: () => http.get('/loyalty/program').then((r) => r.data) });
  const tiers = useQuery({ queryKey: ['loyalty-tiers'], queryFn: () => http.get('/loyalty/tiers').then((r) => r.data) });
  const [rules, setRules] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editingTier, setEditingTier] = useState(null);

  useEffect(() => {
    if (program.data) setRules({ ...program.data });
  }, [program.data]);

  const save = async () => {
    setSaving(true);
    try {
      await http.put('/loyalty/program', {
        enabled: rules.enabled,
        earn_amount_unit: Number(rules.earnAmountUnit),
        points_per_unit: Number(rules.pointsPerUnit),
        redeem_value_per_point: Number(rules.redeemValuePerPoint),
        min_redeem_points: Number(rules.minRedeemPoints),
        max_redeem_percent: Number(rules.maxRedeemPercent),
      });
      toast.success('Loyalty program saved');
      qc.invalidateQueries({ queryKey: ['loyalty-program'] });
      refreshAppSettings();
    } catch (e) {
      toast.error(e.errors?.map((x) => `${x.field}: ${x.message}`).join(' · ') || e.message);
    } finally {
      setSaving(false);
    }
  };

  const removeTier = async (tier) => {
    try {
      await http.delete(`/loyalty/tiers/${tier.id}`);
      toast.success('Tier deleted');
      qc.invalidateQueries({ queryKey: ['loyalty-tiers'] });
    } catch (e) {
      toast.error(e.message);
    }
  };

  if (!rules) return <SkeletonRows rows={6} />;
  const currency = getFormatSettings().currency;
  const set = (k) => (e) => setRules((r) => ({ ...r, [k]: e.target.value }));
  const exampleSpend = Number(rules.earnAmountUnit) * 50 || 50000;
  const examplePoints = Math.floor(exampleSpend / (Number(rules.earnAmountUnit) || 1)) * (Number(rules.pointsPerUnit) || 0);

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden">
        <div className="border-b border-line px-6 py-4">
          <h2 className="font-semibold">Program rules</h2>
          <p className="text-sm text-muted">Points are earned automatically on completed sales (before tax, after discounts) and can be redeemed at the POS.</p>
        </div>
        <div className="space-y-5 px-6 py-5">
          <Switch label="Loyalty program enabled" checked={rules.enabled} onChange={(v) => setRules((r) => ({ ...r, enabled: v }))} />
          <div className="grid gap-5 sm:grid-cols-3">
            <Input label={`For every (${currency})`} type="number" min="1" value={rules.earnAmountUnit} onChange={set('earnAmountUnit')} />
            <Input label="Customer earns (points)" type="number" min="0" value={rules.pointsPerUnit} onChange={set('pointsPerUnit')} />
            <Input label={`1 point is worth (${currency})`} type="number" min="0" value={rules.redeemValuePerPoint} onChange={set('redeemValuePerPoint')} />
            <Input label="Minimum points to redeem" type="number" min="0" value={rules.minRedeemPoints} onChange={set('minRedeemPoints')} />
            <Input label="Points can pay at most (%)" type="number" min="0" max="100" value={rules.maxRedeemPercent} onChange={set('maxRedeemPercent')} />
          </div>
          <p className="rounded-xl bg-brand-500/5 px-4 py-3 text-sm">
            Example: spending <strong>{formatMoney(exampleSpend)}</strong> earns <strong>{formatNumber(examplePoints)}</strong> points, worth <strong>{formatMoney(examplePoints * (Number(rules.redeemValuePerPoint) || 0))}</strong> on a future visit (Bronze tier).
          </p>
        </div>
        <div className="flex justify-end border-t border-line bg-surface-2/40 px-6 py-3.5">
          <Button icon={Save} loading={saving} onClick={save}>Save rules</Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <h2 className="font-semibold">Tiers</h2>
            <p className="text-sm text-muted">Customers move up tiers by lifetime points and earn bonus points.</p>
          </div>
          <Button size="sm" icon={Plus} onClick={() => setEditingTier({})}>New tier</Button>
        </div>
        {tiers.isPending ? <SkeletonRows rows={4} className="p-5" /> : (
          <ul className="divide-y divide-line">
            {tiers.data.map((t) => (
              <li key={t.id} className="flex items-center gap-4 px-6 py-3.5">
                <span className="size-4 shrink-0 rounded-full" style={{ background: t.color }} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{t.name} <span className="text-xs font-normal text-muted">from {formatNumber(t.minPoints)} pts · ×{t.pointsMultiplier}</span></p>
                  <p className="truncate text-sm text-muted">{t.benefits || '—'}</p>
                </div>
                <span className="text-sm text-muted">{formatNumber(t.members)} customers</span>
                <IconButton icon={Pencil} size="sm" label={`Edit ${t.name}`} onClick={() => setEditingTier(t)} />
                <IconButton icon={Trash2} size="sm" label={`Delete ${t.name}`} disabled={t.minPoints === 0} onClick={() => removeTier(t)} />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <TierModal tier={editingTier} onClose={() => setEditingTier(null)} />
    </div>
  );
}
