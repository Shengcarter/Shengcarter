import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Menu, X } from 'lucide-react';
import { useEffect } from 'react';
import { cn } from '../../utils/cn';
import { MOBILE_PRIORITY } from '../../routes/navigation';
import { SidebarContent } from './Sidebar';

/** Slide-in navigation drawer for phones and tablets. */
export function MobileDrawer({ open, onClose, items, unreadCount }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="no-print fixed inset-0 z-50 lg:hidden">
          <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="relative h-full w-72 max-w-[85vw] border-r border-line bg-surface shadow-2xl"
          >
            <button type="button" onClick={onClose} className="absolute top-5 right-3 rounded-lg p-2 text-muted hover:bg-surface-2" aria-label="Close navigation">
              <X className="size-5" />
            </button>
            <SidebarContent items={items} onNavigate={onClose} unreadCount={unreadCount} />
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}

/** Bottom tab bar on phones: the four most-used modules plus "More". */
export function BottomNav({ items, onMore }) {
  const primary = MOBILE_PRIORITY.map((to) => items.find((i) => i.to === to)).filter(Boolean).slice(0, 4);
  return (
    <nav aria-label="Quick navigation" className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="grid grid-cols-5">
        {primary.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.end}
              className={({ isActive }) => cn('flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium', isActive ? 'text-accent' : 'text-muted')}
            >
              <item.icon className="size-5" aria-hidden />
              {item.label}
            </NavLink>
          </li>
        ))}
        <li className={cn(primary.length < 4 && 'col-start-5')}>
          <button type="button" onClick={onMore} className="flex w-full flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted">
            <Menu className="size-5" aria-hidden />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
}
