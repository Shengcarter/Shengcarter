import { NavLink } from 'react-router-dom';
import { motion } from 'framer-motion';
import { cn } from '../../utils/cn';
import { Logo } from '../ui';
import { useAuthStore } from '../../store/authStore';

function NavItem({ item, onNavigate, badge }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
          isActive ? 'text-white' : 'text-muted hover:bg-surface-2 hover:text-fg',
        )
      }
    >
      {({ isActive }) => (
        <>
          {isActive ? (
            <motion.span
              layoutId="sidebar-active"
              className="absolute inset-0 rounded-xl bg-brand-500 shadow-md shadow-brand-900/40"
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            />
          ) : null}
          <item.icon className={cn('relative size-[18px] shrink-0', isActive ? 'text-white' : 'text-muted group-hover:text-fg')} aria-hidden />
          <span className="relative flex-1">{item.label}</span>
          {badge ? (
            <span className={cn('relative rounded-full px-1.5 text-[10px] leading-4 font-bold', isActive ? 'bg-white text-brand-600' : 'bg-brand-500 text-white')}>{badge > 99 ? '99+' : badge}</span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

/** Navigation list shared by the desktop sidebar and the mobile drawer. */
export function SidebarContent({ items, onNavigate, unreadCount }) {
  const settings = useAuthStore((s) => s.settings);
  const branches = useAuthStore((s) => s.branches);
  const currentBranchId = useAuthStore((s) => s.currentBranchId);
  const branch = branches.find((b) => b.id === currentBranchId);

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-6 pb-5">
        <Logo logo={settings?.business?.logo || undefined} subtitle={branch ? branch.name : undefined} />
      </div>
      <nav aria-label="Main navigation" className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 pb-4">
        {items.map((item) => (
          <NavItem key={item.to} item={item} onNavigate={onNavigate} badge={item.to === '/notifications' ? unreadCount : 0} />
        ))}
      </nav>
      <div className="border-t border-line px-5 py-4">
        <p className="text-[11px] leading-relaxed text-muted">
          {settings?.business?.salon_name || 'Zola Stylish'}
          <br />
          <span className="text-muted/70">ZOLA STYLISH MANAGEMENT SYSTEM</span>
        </p>
      </div>
    </div>
  );
}

export function Sidebar({ items, unreadCount }) {
  return (
    <aside className="theme-sidebar no-print fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line lg:block">
      <SidebarContent items={items} unreadCount={unreadCount} />
    </aside>
  );
}
