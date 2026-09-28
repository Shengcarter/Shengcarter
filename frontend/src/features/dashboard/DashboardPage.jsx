import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { Card, PageHeader } from '../../components/ui';
import { useAuthStore, hasPermission } from '../../store/authStore';
import { NAV_ITEMS } from '../../routes/navigation';
import { useDocumentTitle } from '../../hooks';
import { nowInBusinessZone } from '../../utils/format';

/** Interim dashboard (replaced by the analytics dashboard in the analytics phase). */
export default function DashboardPage() {
  useDocumentTitle('Dashboard');
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const modules = useMemo(() => NAV_ITEMS.filter((i) => i.to !== '/' && (!i.permission || hasPermission({ user, permissions }, i.permission))), [user, permissions]);
  const hour = nowInBusinessZone().hour;
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <div>
      <PageHeader title={`${greeting}, ${user?.fullName?.split(' ')[0] || ''}`} description="ZOLA STYLISH MANAGEMENT SYSTEM" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {modules.map((m) => (
          <Link key={m.to} to={m.to}>
            <Card className="flex items-center gap-4 p-5 transition-colors hover:border-gold-500/40">
              <span className="flex size-11 items-center justify-center rounded-xl bg-gold-500/10 text-accent"><m.icon className="size-5" /></span>
              <span className="font-medium">{m.label}</span>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
