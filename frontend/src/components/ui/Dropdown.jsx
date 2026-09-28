import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { cn } from '../../utils/cn';

/**
 * Popover menu anchored to a trigger. Closes on outside click / Escape and
 * supports arrow-key navigation between items.
 *
 * trigger: ({ open, toggle, props }) => element  (spread `props` on the button)
 */
export function Dropdown({ trigger, children, align = 'right', className, width = 'w-56' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => rootRef.current && !rootRef.current.contains(e.target) && setOpen(false);
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(rootRef.current?.querySelectorAll('[role="menuitem"]') || [])];
        if (!items.length) return;
        e.preventDefault();
        const index = items.indexOf(document.activeElement);
        const next = e.key === 'ArrowDown' ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
        items[next].focus();
      }
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className="relative">
      {trigger({
        open,
        toggle: () => setOpen((v) => !v),
        props: { 'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': menuId, onClick: () => setOpen((v) => !v) },
      })}
      <AnimatePresence>
        {open ? (
          <motion.div
            id={menuId}
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14 }}
            className={cn(
              'absolute z-40 mt-2 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-xl shadow-black/20',
              align === 'right' ? 'right-0' : 'left-0',
              width,
              className,
            )}
          >
            {typeof children === 'function' ? children({ close }) : children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function DropdownItem({ icon: Icon, children, onClick, danger, className, ...props }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors focus:outline-none',
        danger ? 'text-danger hover:bg-red-500/10 focus:bg-red-500/10' : 'text-fg hover:bg-surface-2 focus:bg-surface-2',
        className,
      )}
      {...props}
    >
      {Icon ? <Icon className="size-4 shrink-0 text-muted" aria-hidden /> : null}
      {children}
    </button>
  );
}
