import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDownLeft, ArrowUpRight, Megaphone, RotateCcw, Send } from 'lucide-react';
import { Badge, Button, Card, DataTable, EmptyState, IconButton, Input, Modal, Pagination, SearchInput, Select, StatusBadge, Textarea } from '../../components/ui';
import { http } from '../../api/client';
import { formatDateTime, titleCase } from '../../utils/format';
import { useApiMutation } from '../settings/api';

function SendMessageModal({ open, onClose }) {
  const [form, setForm] = useState({ channel: 'sms', audience: 'all_opted_in', tierId: '', inactiveDays: '60', subject: '', message: '' });
  const tiers = useQuery({ queryKey: ['loyalty-tiers'], queryFn: () => http.get('/loyalty/tiers').then((r) => r.data), enabled: open, retry: false });
  const send = useApiMutation((body) => http.post('/messages/send', body), [['messages']]);
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    try {
      await send.mutateAsync({
        channel: form.channel,
        audience: form.audience,
        tierId: form.audience === 'tier' ? Number(form.tierId) : undefined,
        inactiveDays: form.audience === 'inactive' ? Number(form.inactiveDays) : undefined,
        subject: form.channel === 'email' ? form.subject : undefined,
        message: form.message,
      });
      setForm((f) => ({ ...f, message: '' }));
      onClose();
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    }
  };

  const length = form.message.length;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Send a promotion"
      description="Only customers who opted in to marketing messages are included."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button icon={Send} onClick={submit} loading={send.isPending} disabled={!form.message.trim()}>Queue messages</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select label="Channel" value={form.channel} onChange={set('channel')} options={[{ value: 'sms', label: 'SMS' }, { value: 'whatsapp', label: 'WhatsApp' }, { value: 'email', label: 'Email' }]} />
        <Select
          label="Audience"
          value={form.audience}
          onChange={set('audience')}
          options={[
            { value: 'all_opted_in', label: 'All opted-in customers' },
            { value: 'inactive', label: 'Customers who have not visited recently' },
            { value: 'birthday', label: 'Birthdays in the next 7 days' },
            ...(tiers.data?.length ? [{ value: 'tier', label: 'A loyalty tier' }] : []),
          ]}
        />
        {form.audience === 'inactive' ? (
          <Select
            className="sm:col-span-2"
            label="Last visit more than"
            value={form.inactiveDays}
            onChange={set('inactiveDays')}
            options={[{ value: '30', label: '30 days ago' }, { value: '60', label: '60 days ago' }, { value: '90', label: '90 days ago' }, { value: '180', label: '6 months ago' }]}
          />
        ) : null}
        {form.audience === 'tier' ? (
          <Select className="sm:col-span-2" label="Loyalty tier" placeholder="Choose tier" value={form.tierId} onChange={set('tierId')} options={(tiers.data || []).map((t) => ({ value: t.id, label: t.name }))} />
        ) : null}
        {form.channel === 'email' ? <Input className="sm:col-span-2" label="Subject" value={form.subject} onChange={set('subject')} /> : null}
        <Textarea
          className="sm:col-span-2"
          label="Message"
          rows={5}
          value={form.message}
          onChange={set('message')}
          hint={`${length}/1000 characters${form.channel === 'sms' ? ` · about ${Math.max(1, Math.ceil(length / 160))} SMS each` : ''}. Use {{customer_name}} and {{salon_name}} to personalise.`}
        />
      </div>
    </Modal>
  );
}

const TYPES = {
  appointment_confirmation: 'Booking confirmation',
  appointment_reminder: 'Reminder',
  appointment_cancelled: 'Cancellation',
  payment_receipt: 'Thank-you',
  reply_confirmed: 'Answer: confirmed',
  reply_late: 'Answer: running late',
  reply_received: 'Answer: will call back',
  incoming_confirmed: 'Confirmed',
  incoming_late: 'Running late',
  incoming_cancel_request: 'Wants to cancel or change',
  incoming_message: 'Message',
  incoming_stop: 'Stopped messages',
  promotion: 'Promotion',
  manual: 'Message',
};
const CHANNELS = { sms: 'SMS', whatsapp: 'WhatsApp', email: 'Email' };
const SUMMARY = [
  { status: 'queued', label: 'Waiting to send' },
  { status: 'sent', label: 'Sent' },
  { status: 'failed', label: 'Failed' },
  { status: 'received', label: 'Replies received' },
];

export function MessagesPanel() {
  const [params, setParams] = useState({ page: 1, limit: 20, search: '', channel: '', status: '', direction: '' });
  const [open, setOpen] = useState(false);
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== ''));
  const messages = useQuery({ queryKey: ['messages', clean], queryFn: () => http.get('/messages', clean), placeholderData: (p) => p, refetchInterval: 15_000 });
  const retry = useApiMutation((id) => http.post(`/messages/${id}/retry`), [['messages']]);
  const summary = messages.data?.summary || {};

  const columns = [
    { key: 'createdAt', header: 'Time', render: (m) => <span className="whitespace-nowrap">{formatDateTime(m.createdAt)}</span> },
    {
      key: 'recipient',
      header: 'Customer',
      primary: true,
      render: (m) => (
        <div className="flex items-start gap-2">
          {m.direction === 'inbound'
            ? <ArrowDownLeft className="mt-0.5 size-4 shrink-0 text-success" aria-label="From the customer" />
            : <ArrowUpRight className="mt-0.5 size-4 shrink-0 text-muted" aria-label="To the customer" />}
          <div><p className="font-medium">{m.customerName || m.recipient}</p><p className="text-xs text-muted">{m.recipient}</p></div>
        </div>
      ),
    },
    { key: 'channel', header: 'Channel', render: (m) => <Badge tone="brand">{CHANNELS[m.channel] || titleCase(m.channel)}</Badge> },
    { key: 'template', header: 'Type', hideOnMobile: true, render: (m) => TYPES[m.template] || titleCase(m.template || 'manual') },
    { key: 'body', header: 'Message', hideOnMobile: true, render: (m) => <span className={m.direction === 'inbound' ? 'line-clamp-3 max-w-sm text-fg' : 'line-clamp-2 max-w-sm text-muted'}>{m.body}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (m) => (
        <div>
          <StatusBadge status={m.status} />
          {m.provider === 'log' && m.status === 'sent' ? <p className="mt-0.5 text-[11px] text-muted">log only</p> : null}
          {m.status === 'failed' && m.lastError ? <p className="mt-0.5 line-clamp-2 max-w-48 text-[11px] text-danger">{m.lastError}</p> : null}
        </div>
      ),
    },
    { key: 'actions', header: <span className="sr-only">Actions</span>, align: 'right', render: (m) => (m.status === 'failed' ? <IconButton icon={RotateCcw} size="sm" label="Retry" onClick={() => retry.mutate(m.id)} /> : null) },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-2 gap-3 border-b border-line p-4 sm:grid-cols-4">
        {SUMMARY.map((s) => (
          <div key={s.status} className="rounded-xl bg-surface-2/60 px-3 py-2">
            <p className="text-xs text-muted">{s.label} (30 days)</p>
            <p className="font-display text-xl font-semibold">{summary[s.status] || 0}</p>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchInput placeholder="Search recipient or text…" className="sm:w-72" onChange={(search) => setParams((p) => ({ ...p, search, page: 1 }))} />
        <select aria-label="Direction" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={params.direction} onChange={(e) => setParams((p) => ({ ...p, direction: e.target.value, page: 1 }))}>
          <option value="">Sent and received</option>
          <option value="outbound">Sent to customers</option>
          <option value="inbound">Replies from customers</option>
        </select>
        <select aria-label="Channel" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={params.channel} onChange={(e) => setParams((p) => ({ ...p, channel: e.target.value, page: 1 }))}>
          <option value="">All channels</option>
          <option value="sms">SMS</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </select>
        <select aria-label="Status" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={params.status} onChange={(e) => setParams((p) => ({ ...p, status: e.target.value, page: 1 }))}>
          <option value="">Any status</option>
          <option value="queued">Queued</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
        <Button className="sm:ml-auto" icon={Megaphone} onClick={() => setOpen(true)}>Send promotion</Button>
      </div>
      <DataTable
        columns={columns}
        rows={messages.data?.data}
        loading={messages.isPending}
        error={messages.error}
        onRetry={messages.refetch}
        empty={<EmptyState icon={Send} title="No messages yet" description="Booking confirmations, reminders, thank-you messages, promotions and customers' replies will be listed here." />}
      />
      <Pagination pagination={messages.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
      <SendMessageModal open={open} onClose={() => setOpen(false)} />
    </Card>
  );
}
