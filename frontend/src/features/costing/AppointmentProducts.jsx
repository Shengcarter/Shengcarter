import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Package, PencilLine } from 'lucide-react';
import { Button } from '../../components/ui';
import { formatNumber } from '../../utils/format';
import { ProductsUsedEditor, cleanUsage } from './ProductsUsedEditor';
import { costingApi, useAppointmentProducts, useUsableProducts } from './api';

const SOURCE = {
  recorded: (u) => `Recorded by ${u.recordedBy || 'staff'}`,
  recipe: () => 'Usual amounts, not confirmed yet',
  none: () => 'None recorded',
};

/**
 * The products used on an appointment's services. The stylist records them
 * during or after the service; checkout starts from them. Stock only moves
 * when the appointment is billed.
 */
export function AppointmentProducts({ appointment, canRecord }) {
  const qc = useQueryClient();
  const usage = useAppointmentProducts(appointment.id);
  const editable = canRecord && !appointment.saleId && !['cancelled', 'no_show'].includes(appointment.status);
  const products = useUsableProducts({ enabled: editable });
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  if (['cancelled', 'no_show'].includes(appointment.status) || !usage.data) return null;
  const nameOf = (serviceId) => appointment.services.find((s) => s.serviceId === serviceId)?.serviceName || 'Service';

  const start = () => setDraft(Object.fromEntries(usage.data.map((u) => [u.serviceId, u.products.map((p) => ({ ...p, quantity: String(p.quantity) }))])));
  const save = async () => {
    setBusy(true);
    try {
      const res = await costingApi.recordAppointmentProducts(appointment.id, Object.entries(draft).map(([serviceId, rows]) => ({ serviceId: Number(serviceId), products: cleanUsage(rows) })));
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['appointments', appointment.id, 'products'] });
      setDraft(null);
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Package className="size-4 text-muted" aria-hidden />Products used</p>
        {editable && !draft ? <Button size="xs" variant="ghost" icon={PencilLine} onClick={start}>Record</Button> : null}
      </div>
      <ul className="divide-y divide-line rounded-2xl border border-line">
        {usage.data.map((u) => (
          <li key={u.serviceId} className="px-4 py-2.5 text-sm">
            <p className="font-medium">{nameOf(u.serviceId)}</p>
            {draft ? (
              <ProductsUsedEditor
                className="mt-2"
                value={draft[u.serviceId] || []}
                onChange={(rows) => setDraft({ ...draft, [u.serviceId]: rows })}
                products={products.data || []}
                idPrefix={`appt-${u.serviceId}`}
                emptyText="No products used for this service."
              />
            ) : (
              <>
                <p className="text-xs text-muted">{SOURCE[u.source](u)}</p>
                {u.products.length ? (
                  <p className="mt-1 text-xs">{u.products.map((p) => `${p.name} × ${formatNumber(p.quantity, { maximumFractionDigits: 3 })} ${p.unit}`).join(' · ')}</p>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul>
      {draft ? (
        <div className="mt-2 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDraft(null)}>Cancel</Button>
          <Button size="sm" loading={busy} onClick={save}>Save products used</Button>
        </div>
      ) : null}
      {appointment.saleId ? <p className="mt-1.5 text-xs text-muted">Billed: the products used are on the invoice.</p> : null}
    </div>
  );
}
