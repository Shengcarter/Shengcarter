import { Bell, CheckCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Dropdown, IconButton, Spinner } from '../ui';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '../../features/notifications/api';
import { NotificationItem } from '../../features/notifications/NotificationItem';

export function NotificationBell() {
  const navigate = useNavigate();
  const unread = useUnreadCount();
  const markRead = useMarkRead();
  const markAll = useMarkAllRead();
  const count = unread.data?.count || 0;

  return (
    <Dropdown
      width="w-[22rem] max-w-[calc(100vw-1.5rem)]"
      trigger={({ props }) => <IconButton icon={Bell} label={`Notifications${count ? ` (${count} unread)` : ''}`} badge={count} {...props} />}
    >
      {({ close }) => <Panel close={close} navigate={navigate} markRead={markRead} markAll={markAll} count={count} />}
    </Dropdown>
  );
}

function Panel({ close, navigate, markRead, markAll, count }) {
  const list = useNotifications({ limit: 8 });
  const open = (n) => {
    if (!n.readAt) markRead.mutate(n.id);
    close();
    if (n.link) navigate(n.link);
  };

  return (
    <div>
      <div className="flex items-center justify-between px-2 pt-1 pb-2">
        <p className="text-sm font-semibold">Notifications</p>
        <button
          type="button"
          onClick={() => markAll.mutate()}
          disabled={!count || markAll.isPending}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-accent hover:bg-brand-500/10 disabled:opacity-40"
        >
          <CheckCheck className="size-3.5" /> Mark all read
        </button>
      </div>
      <div className="scrollbar-thin max-h-96 overflow-y-auto">
        {list.isPending ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : list.data?.data?.length ? (
          list.data.data.map((n) => <NotificationItem key={n.id} notification={n} onClick={() => open(n)} compact />)
        ) : (
          <p className="px-3 py-8 text-center text-sm text-muted">You're all caught up.</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => {
          close();
          navigate('/notifications');
        }}
        className="mt-1 w-full rounded-lg py-2 text-center text-sm font-medium text-accent hover:bg-brand-500/10"
      >
        View all notifications
      </button>
    </div>
  );
}
