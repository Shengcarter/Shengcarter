import { Suspense, lazy, useMemo } from 'react';
import { NavLink, Navigate, useParams } from 'react-router-dom';
import { Building, Building2, CircleDollarSign, Cog, Gift, History, Plug, ShieldCheck, BellRing, Users } from 'lucide-react';
import { PageHeader, PageLoader, SkeletonRows, ErrorState } from '../../components/ui';
import { usePermission, useDocumentTitle } from '../../hooks';
import { cn } from '../../utils/cn';
import { useAdminSettings } from './api';

const BusinessSettings = lazy(() => import('./BusinessSettings').then((m) => ({ default: m.BusinessSettings })));
const FinancialSettings = lazy(() => import('./FinancialSettings').then((m) => ({ default: m.FinancialSettings })));
const SystemSettings = lazy(() => import('./SystemSettings').then((m) => ({ default: m.SystemSettings })));
const UsersSettings = lazy(() => import('./UsersSettings').then((m) => ({ default: m.UsersSettings })));
const RolesSettings = lazy(() => import('./RolesSettings').then((m) => ({ default: m.RolesSettings })));
const BranchesSettings = lazy(() => import('./BranchesSettings').then((m) => ({ default: m.BranchesSettings })));
const ActivityLogSettings = lazy(() => import('./ActivityLogSettings').then((m) => ({ default: m.ActivityLogSettings })));
const NotificationSettings = lazy(() => import('./NotificationSettings').then((m) => ({ default: m.NotificationSettings })));
const IntegrationSettings = lazy(() => import('./IntegrationSettings').then((m) => ({ default: m.IntegrationSettings })));
const LoyaltySettings = lazy(() => import('./LoyaltySettings').then((m) => ({ default: m.LoyaltySettings })));

/** Sections that edit a settings group need the admin settings payload. */
const SECTIONS = [
  { slug: 'business', label: 'Business', icon: Building, permission: 'settings.manage', group: 'business', component: BusinessSettings },
  { slug: 'financial', label: 'Financial', icon: CircleDollarSign, permission: 'settings.manage', group: 'financial', component: FinancialSettings },
  { slug: 'loyalty', label: 'Loyalty program', icon: Gift, permission: 'loyalty.manage', component: LoyaltySettings },
  { slug: 'system', label: 'System', icon: Cog, permission: 'settings.manage', group: 'system', component: SystemSettings },
  { slug: 'notifications', label: 'Notifications', icon: BellRing, permission: 'settings.manage', group: 'notifications', component: NotificationSettings },
  { slug: 'integrations', label: 'Integrations', icon: Plug, permission: 'settings.manage', group: 'integrations', component: IntegrationSettings },
  { slug: 'users', label: 'Users', icon: Users, permission: 'users.manage', component: UsersSettings },
  { slug: 'roles', label: 'Roles & permissions', icon: ShieldCheck, permission: 'roles.manage', component: RolesSettings },
  { slug: 'branches', label: 'Branches', icon: Building2, permission: 'branches.manage', component: BranchesSettings },
  { slug: 'activity', label: 'Activity log', icon: History, permission: 'audit.view', component: ActivityLogSettings },
];

function GroupSection({ section }) {
  const settings = useAdminSettings();
  if (settings.isPending) return <SkeletonRows rows={6} />;
  if (settings.isError) return <ErrorState error={settings.error} onRetry={settings.refetch} />;
  const Component = section.component;
  return <Component values={settings.data[section.group]} all={settings.data} onReload={settings.refetch} />;
}

export default function SettingsPage() {
  useDocumentTitle('Settings');
  const can = usePermission();
  const params = useParams();
  const sections = useMemo(() => SECTIONS.filter((s) => can(s.permission)), [can]);
  const slug = params['*']?.split('/')[0];
  const current = sections.find((s) => s.slug === slug);

  if (!current) return sections.length ? <Navigate to={`/settings/${sections[0].slug}`} replace /> : null;

  return (
    <div>
      <PageHeader title="Settings" description="Configure ZOLA STYLISH MANAGEMENT SYSTEM for your salon." />
      <div className="grid gap-6 lg:grid-cols-[15rem_1fr]">
        <nav aria-label="Settings sections" className="scrollbar-thin -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
          {sections.map((s) => (
            <NavLink
              key={s.slug}
              to={`/settings/${s.slug}`}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-gold-500/10 text-fg ring-1 ring-gold-500/25' : 'text-muted hover:bg-surface-2 hover:text-fg',
                )
              }
            >
              <s.icon className="size-4" aria-hidden />
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          <Suspense fallback={<PageLoader />}>
            {current.group ? <GroupSection section={current} /> : <current.component />}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
