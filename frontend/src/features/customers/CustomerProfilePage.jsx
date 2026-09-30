import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, CalendarPlus, Camera, Gift, Mail, MapPin, Pencil, Phone, ShoppingBag, StickyNote, Trash2, TriangleAlert,
} from 'lucide-react';
import {
  Avatar, Badge, Button, Card, ConfirmDialog, DataTable, Detail, EmptyState, ErrorState, IconButton, Input, Modal,
  Pagination, SkeletonRows, StatCard, StatusBadge, Tabs, Textarea,
} from '../../components/ui';
import { formatDate, formatDateTime, formatMoney, formatNumber, titleCase } from '../../utils/format';
import { usePermission, useDocumentTitle } from '../../hooks';
import { customerApi, customerKeys, useCustomer, useCustomerHistory, useCustomerNotes } from './api';
import { CustomerFormModal } from './CustomerFormModal';

function HistoryTable({ customerId, kind, columns, empty, onRowClick }) {
  const [page, setPage] = useState(1);
  const query = useCustomerHistory(customerId, kind, { page, limit: 10 });
  return (
    <>
      <DataTable columns={columns} rows={query.data?.data} loading={query.isPending} error={query.error} onRetry={query.refetch} empty={empty} onRowClick={onRowClick} />
      <Pagination pagination={query.data?.pagination} onPageChange={setPage} />
    </>
  );
}

function NotesPanel({ customerId, canEdit }) {
  const notes = useCustomerNotes(customerId);
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    setSaving(true);
    try {
      await customerApi.addNote(customerId, text);
      setText('');
      qc.invalidateQueries({ queryKey: customerKeys.notes(customerId) });
      toast.success('Note added');
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setSaving(false);
    }
  };
  const remove = async (noteId) => {
    await customerApi.deleteNote(customerId, noteId);
    qc.invalidateQueries({ queryKey: customerKeys.notes(customerId) });
  };

  return (
    <div className="p-4 sm:p-5">
      {canEdit ? (
        <div className="mb-5 space-y-2">
          <Textarea label="Add a note" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="E.g. prefers medium braids, allergic to ammonia…" />
          <div className="flex justify-end">
            <Button size="sm" disabled={!text.trim()} loading={saving} onClick={add}>Save note</Button>
          </div>
        </div>
      ) : null}
      {notes.isPending ? (
        <SkeletonRows rows={3} />
      ) : notes.data?.length ? (
        <ul className="space-y-3">
          {notes.data.map((n) => (
            <li key={n.id} className="rounded-xl border border-line bg-surface-2/40 p-4">
              <p className="text-sm whitespace-pre-wrap">{n.note}</p>
              <div className="mt-2 flex items-center justify-between text-xs text-muted">
                <span>{n.createdByName || 'Staff'} · {formatDateTime(n.createdAt)}</span>
                {canEdit ? <button type="button" className="text-danger hover:underline" onClick={() => remove(n.id)}>Delete</button> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={StickyNote} title="No notes yet" description="Notes help your team personalise every visit." />
      )}
    </div>
  );
}

function AdjustPointsModal({ open, onClose, customer }) {
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const submit = async () => {
    setBusy(true);
    try {
      await customerApi.adjustLoyalty(customer.id, { points: Number(points), reason });
      toast.success('Loyalty points adjusted');
      qc.invalidateQueries({ queryKey: customerKeys.detail(customer.id) });
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Adjust loyalty points" description={`Current balance: ${formatNumber(customer?.loyaltyPoints)} points`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy} disabled={!Number(points) || !reason.trim()}>Save</Button></>}>
      <div className="space-y-4">
        <Input label="Points" type="number" hint="Use a negative number to remove points" value={points} onChange={(e) => setPoints(e.target.value)} />
        <Input label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Modal>
  );
}

export default function CustomerProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const can = usePermission();
  const qc = useQueryClient();
  const customer = useCustomer(id);
  useDocumentTitle(customer.data?.fullName || 'Customer');
  const [tab, setTab] = useState('appointments');
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const photoInput = useRef(null);

  if (customer.isPending) return <SkeletonRows rows={8} />;
  if (customer.isError) return <ErrorState error={customer.error} onRetry={customer.refetch} />;
  const c = customer.data;

  const uploadPhoto = async (file) => {
    if (!file) return;
    try {
      await customerApi.uploadPhoto(c.id, file);
      qc.invalidateQueries({ queryKey: customerKeys.detail(c.id) });
      toast.success('Photo updated');
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    }
  };

  const remove = async () => {
    setDeleteBusy(true);
    try {
      const res = await customerApi.remove(c.id);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: customerKeys.all });
      navigate('/customers', { replace: true });
    } catch (e) {
      toast.error(e.message);
      setDeleteBusy(false);
    }
  };

  const tabs = [
    { value: 'appointments', label: 'Appointments' },
    { value: 'purchases', label: 'Purchases' },
    { value: 'payments', label: 'Payments' },
    { value: 'loyalty', label: 'Loyalty' },
    { value: 'notes', label: 'Notes' },
  ];

  return (
    <div>
      <Link to="/customers" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> Customers
      </Link>

      <Card className="mb-6 overflow-hidden">
        <div className="h-16 bg-gradient-to-r from-brand-500/25 via-blush-200/20 to-transparent" />
        <div className="flex flex-col gap-5 px-5 pb-5 sm:flex-row sm:items-start sm:px-6">
          <div className="relative -mt-10 w-fit shrink-0">
            <Avatar name={c.fullName} src={c.photo} size="xl" className="ring-4 ring-surface" />
            {can('customers.update') ? (
              <>
                <button type="button" onClick={() => photoInput.current?.click()} className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full bg-brand-500 text-white ring-2 ring-surface" aria-label="Change photo">
                  <Camera className="size-4" />
                </button>
                <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadPhoto(e.target.files?.[0])} />
              </>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 sm:pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-2xl font-semibold sm:text-3xl">{c.fullName}</h1>
              {c.tier ? <Badge tone="brand"><span className="size-2 rounded-full" style={{ background: c.tier.color }} aria-hidden />{c.tier.name}</Badge> : null}
              {c.isDemo ? <Badge tone="pink">Demo</Badge> : null}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
              <span>{c.code}</span>
              <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 hover:text-fg"><Phone className="size-3.5" />{c.phone}</a>
              {c.email ? <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-fg"><Mail className="size-3.5" />{c.email}</a> : null}
              {c.address ? <span className="inline-flex items-center gap-1.5"><MapPin className="size-3.5" />{c.address}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:pt-3">
            {can('appointments.create') ? <Button icon={CalendarPlus} onClick={() => navigate(`/appointments?new=1&customer=${c.id}`)}>Book</Button> : null}
            {can('pos.create') ? <Button variant="secondary" icon={ShoppingBag} onClick={() => navigate(`/pos?customer=${c.id}`)}>New sale</Button> : null}
            {can('customers.update') ? <IconButton icon={Pencil} label="Edit customer" variant="secondary" onClick={() => setEditing(true)} /> : null}
            {can('customers.delete') ? <IconButton icon={Trash2} label="Delete customer" variant="secondary" className="text-danger" onClick={() => setDeleting(true)} /> : null}
          </div>
        </div>
      </Card>

      {c.notes ? (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <p className="whitespace-pre-wrap">{c.notes}</p>
        </div>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total spent" value={formatMoney(c.totalSpent)} caption={`Average ${formatMoney(c.stats.averageSpend)} per visit`} index={0} />
        <StatCard label="Visits" value={formatNumber(c.visitCount)} caption={c.lastVisitAt ? `Last ${formatDate(c.lastVisitAt)}` : 'No visits yet'} index={1} />
        <StatCard
          label="Loyalty points"
          icon={Gift}
          value={formatNumber(c.loyalty.points)}
          caption={c.loyalty.nextTier ? `${formatNumber(c.loyalty.pointsToNext)} to ${c.loyalty.nextTier.name}` : 'Top tier reached'}
          onClick={can('loyalty.manage') ? () => setAdjusting(true) : undefined}
          index={2}
        />
        <StatCard
          label="Outstanding balance"
          value={formatMoney(c.stats.outstandingBalance)}
          tone={c.stats.outstandingBalance > 0 ? 'danger' : 'neutral'}
          caption={`${c.stats.noShows} no-show(s) · ${c.stats.cancelledAppointments} cancelled`}
          index={3}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card className="min-w-0 overflow-hidden">
          <div className="border-b border-line px-3 pt-3">
            <Tabs tabs={tabs} value={tab} onChange={setTab} />
          </div>
          {tab === 'appointments' ? (
            <HistoryTable
              customerId={c.id}
              kind="appointments"
              onRowClick={(a) => navigate(`/appointments?appointment=${a.id}`)}
              empty={<EmptyState title="No appointments yet" />}
              columns={[
                { key: 'startTime', header: 'Date', primary: true, render: (a) => <div><p className="font-medium">{formatDateTime(a.startTime)}</p><p className="text-xs text-muted">{a.code}</p></div> },
                { key: 'services', header: 'Services', render: (a) => <span className="line-clamp-1">{a.services}</span> },
                { key: 'employeeName', header: 'Staff' },
                { key: 'totalPrice', header: 'Value', align: 'right', render: (a) => formatMoney(a.totalPrice) },
                { key: 'status', header: 'Status', render: (a) => <StatusBadge status={a.status} /> },
              ]}
            />
          ) : null}
          {tab === 'purchases' ? (
            <HistoryTable
              customerId={c.id}
              kind="purchases"
              onRowClick={can('sales.view') ? (s) => navigate(`/pos/sales/${s.id}`) : undefined}
              empty={<EmptyState icon={ShoppingBag} title="No purchases yet" />}
              columns={[
                { key: 'soldAt', header: 'Date', primary: true, render: (s) => <div><p className="font-medium">{formatDateTime(s.soldAt)}</p><p className="text-xs text-muted">{s.invoiceNumber}</p></div> },
                { key: 'items', header: 'Items', render: (s) => <span className="line-clamp-2">{s.items?.map((i) => `${i.description}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join(', ')}</span> },
                { key: 'total', header: 'Total', align: 'right', render: (s) => formatMoney(s.total) },
                { key: 'balanceDue', header: 'Balance', align: 'right', render: (s) => (s.balanceDue > 0 ? <span className="text-danger">{formatMoney(s.balanceDue)}</span> : '—') },
                { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status === 'refunded' ? 'refunded' : s.paymentStatus} /> },
              ]}
            />
          ) : null}
          {tab === 'payments' ? (
            <HistoryTable
              customerId={c.id}
              kind="payments"
              empty={<EmptyState title="No payments yet" />}
              columns={[
                { key: 'paidAt', header: 'Date', primary: true, render: (p) => formatDateTime(p.paidAt) },
                { key: 'invoiceNumber', header: 'Invoice' },
                { key: 'method', header: 'Method', render: (p) => titleCase(p.method) },
                { key: 'type', header: 'Type', render: (p) => <Badge tone={p.type === 'refund' ? 'danger' : 'success'}>{titleCase(p.type)}</Badge> },
                { key: 'amount', header: 'Amount', align: 'right', render: (p) => formatMoney(p.amount) },
              ]}
            />
          ) : null}
          {tab === 'loyalty' ? (
            <HistoryTable
              customerId={c.id}
              kind="loyalty"
              empty={<EmptyState icon={Gift} title="No loyalty activity yet" description="Points are earned automatically on every completed sale." />}
              columns={[
                { key: 'createdAt', header: 'Date', primary: true, render: (t) => formatDateTime(t.createdAt) },
                { key: 'type', header: 'Type', render: (t) => <Badge tone={t.points > 0 ? 'success' : 'warning'}>{titleCase(t.type)}</Badge> },
                { key: 'description', header: 'Details', render: (t) => t.description || t.invoiceNumber || '—' },
                { key: 'points', header: 'Points', align: 'right', render: (t) => <span className={t.points > 0 ? 'text-success' : 'text-danger'}>{t.points > 0 ? '+' : ''}{formatNumber(t.points)}</span> },
                { key: 'balanceAfter', header: 'Balance', align: 'right', render: (t) => formatNumber(t.balanceAfter) },
              ]}
            />
          ) : null}
          {tab === 'notes' ? <NotesPanel customerId={c.id} canEdit={can('customers.update')} /> : null}
        </Card>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-semibold">Details</h2>
            <dl className="grid grid-cols-2 gap-4">
              <Detail label="Gender">{titleCase(c.gender)}</Detail>
              <Detail label="Birthday">{c.dateOfBirth ? formatDate(c.dateOfBirth, 'dd LLL') : '—'}</Detail>
              <Detail label="Contact via">{titleCase(c.preferredChannel)}</Detail>
              <Detail label="Promotions">{c.marketingOptIn ? 'Opted in' : 'Opted out'}</Detail>
              <Detail label="Registered">{formatDate(c.createdAt)}</Detail>
              <Detail label="Branch">{c.branchName}</Detail>
              <Detail label="Favourite service" className="col-span-2">{c.stats.favouriteService || '—'}</Detail>
            </dl>
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Next appointment</h2>
            {c.upcomingAppointment ? (
              <button type="button" onClick={() => navigate(`/appointments?appointment=${c.upcomingAppointment.id}`)} className="w-full rounded-xl border border-line p-3 text-left hover:border-brand-500/40">
                <p className="font-medium">{formatDateTime(c.upcomingAppointment.startTime)}</p>
                <p className="text-sm text-muted">with {c.upcomingAppointment.employeeName} · {c.upcomingAppointment.code}</p>
                <div className="mt-2"><StatusBadge status={c.upcomingAppointment.status} /></div>
              </button>
            ) : (
              <p className="text-sm text-muted">No upcoming appointments.</p>
            )}
          </Card>
        </div>
      </div>

      <CustomerFormModal open={editing} onClose={() => setEditing(false)} customer={c} />
      <AdjustPointsModal open={adjusting} onClose={() => setAdjusting(false)} customer={c} />
      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        onConfirm={remove}
        loading={deleteBusy}
        danger
        title={`Delete ${c.fullName}?`}
        message="Customers with appointments or purchases are archived so reports stay accurate. Customers without history are permanently deleted."
        confirmLabel="Delete customer"
      />
    </div>
  );
}
