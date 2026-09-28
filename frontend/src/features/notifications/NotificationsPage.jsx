import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BellOff, CheckCheck } from 'lucide-react';
import { Button, Card, EmptyState, ErrorState, PageHeader, Pagination, SkeletonRows, Tabs } from '../../components/ui';
import { NotificationItem } from './NotificationItem';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from './api';
import { usePermission, useDocumentTitle } from '../../hooks';
import { MessagesPanel } from './MessagesPanel';

const CATEGORIES = [
  { value: '', label: 'All' },
  { value: 'appointment', label: 'Appointments' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'payment', label: 'Payments' },
  { value: 'customer', label: 'Customers' },
  { value: 'system', label: 'System' },
];

function Inbox() {
  const navigate = useNavigate();
  const [params, setParams] = useState({ page: 1, limit: 20, category: '', unreadOnly: false });
  const query = useNotifications(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v !== false)));
  const unread = useUnreadCount();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 md:flex-row md:items-center md:justify-between">
        <Tabs tabs={CATEGORIES} value={params.category} onChange={(category) => setParams((p) => ({ ...p, category, page: 1 }))} />
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" className="size-4 accent-gold-500" checked={params.unreadOnly} onChange={(e) => setParams((p) => ({ ...p, unreadOnly: e.target.checked, page: 1 }))} />
            Unread only
          </label>
          <Button size="sm" variant="secondary" icon={CheckCheck} disabled={!unread.data?.count} loading={markAll.isPending} onClick={() => markAll.mutate()}>
            Mark all read
          </Button>
        </div>
      </div>
      <div className="p-2">
        {query.isPending ? (
          <SkeletonRows className="p-2" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={query.refetch} />
        ) : query.data.data.length ? (
          query.data.data.map((n) => (
            <NotificationItem
              key={n.id}
              notification={n}
              onClick={() => {
                if (!n.readAt) markRead.mutate(n.id);
                if (n.link) navigate(n.link);
              }}
            />
          ))
        ) : (
          <EmptyState icon={BellOff} title="No notifications" description="New appointments, low stock alerts and payments will appear here." />
        )}
      </div>
      <Pagination pagination={query.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
    </Card>
  );
}

export default function NotificationsPage() {
  useDocumentTitle('Notifications');
  const can = usePermission();
  const [tab, setTab] = useState('inbox');
  const canMessage = can('notifications.send');

  return (
    <div>
      <PageHeader title="Notifications" description="Alerts for you, and messages sent to customers." />
      {canMessage ? (
        <Tabs
          className="mb-5"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'inbox', label: 'My notifications' },
            { value: 'messages', label: 'Customer messages' },
          ]}
        />
      ) : null}
      {tab === 'messages' && canMessage ? <MessagesPanel /> : <Inbox />}
    </div>
  );
}
