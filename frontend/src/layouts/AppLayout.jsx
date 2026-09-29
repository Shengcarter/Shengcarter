import { Suspense, useMemo, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Sidebar } from '../components/layout/Sidebar';
import { Header } from '../components/layout/Header';
import { BottomNav, MobileDrawer } from '../components/layout/MobileNav';
import { PageLoader } from '../components/ui';
import { NAV_ITEMS } from '../routes/navigation';
import { useAuthStore, hasPermission } from '../store/authStore';
import { useUnreadCount } from '../features/notifications/api';

export default function AppLayout() {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const unread = useUnreadCount();

  // Only modules the signed-in user may access are shown.
  const items = useMemo(
    () => NAV_ITEMS.filter(
      (item) => (!item.permission || hasPermission({ user, permissions }, item.permission)) && !(item.hideIf && hasPermission({ user, permissions }, item.hideIf)),
    ),
    [user, permissions],
  );
  const section = location.pathname.split('/')[1] || 'dashboard';

  return (
    <div className="min-h-dvh">
      <a href="#main" className="sr-only z-50 rounded-lg bg-gold-500 px-4 py-2 text-ink-950 focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <Sidebar items={items} unreadCount={unread.data?.count} />
      <MobileDrawer open={navOpen} onClose={() => setNavOpen(false)} items={items} unreadCount={unread.data?.count} />
      <div className="lg:pl-64">
        <Header onOpenNav={() => setNavOpen(true)} />
        <main id="main" className="mx-auto w-full max-w-[1600px] px-4 pt-6 pb-28 sm:px-6 lg:pb-12">
          <Suspense fallback={<PageLoader />}>
            <motion.div key={section} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }}>
              <Outlet />
            </motion.div>
          </Suspense>
        </main>
      </div>
      <BottomNav items={items} onMore={() => setNavOpen(true)} />
    </div>
  );
}
