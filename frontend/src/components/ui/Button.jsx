import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '../../utils/cn';

const VARIANTS = {
  primary:
    'bg-gold-500 text-ink-950 hover:bg-gold-400 active:bg-gold-600 shadow-sm shadow-gold-900/20 disabled:bg-gold-500/50',
  secondary:
    'bg-surface-2 text-fg border border-line hover:bg-surface-3 disabled:opacity-50',
  outline:
    'border border-gold-500/60 text-accent hover:bg-gold-500/10 disabled:opacity-50',
  ghost: 'text-fg hover:bg-surface-2 disabled:opacity-50',
  danger: 'bg-red-600 text-white hover:bg-red-500 disabled:opacity-50',
  'danger-ghost': 'text-danger hover:bg-red-500/10 disabled:opacity-50',
};

const SIZES = {
  xs: 'h-7 px-2.5 text-xs gap-1.5 rounded-lg',
  sm: 'h-9 px-3 text-sm gap-2 rounded-xl',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2.5 rounded-xl',
};

const BASE =
  'inline-flex shrink-0 select-none items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 disabled:cursor-not-allowed';

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], className)}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
      {IconRight && !loading ? <IconRight className="size-4" aria-hidden /> : null}
    </button>
  );
}

/** A router link styled as a button (never nest a <button> inside an <a>). */
export function ButtonLink({ to, variant = 'primary', size = 'md', icon: Icon, className, children, ...props }) {
  return (
    <Link to={to} className={cn(BASE, VARIANTS[variant], SIZES[size], className)} {...props}>
      {Icon ? <Icon className="size-4" aria-hidden /> : null}
      {children}
    </Link>
  );
}

export function IconButton({ icon: Icon, label, variant = 'ghost', size = 'md', className, badge, ...props }) {
  const dims = { sm: 'size-8', md: 'size-10', lg: 'size-12' }[size];
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-xl transition-colors duration-150 disabled:opacity-50',
        VARIANTS[variant],
        dims,
        className,
      )}
      {...props}
    >
      <Icon className="size-[18px]" aria-hidden />
      {badge ? (
        <span className="absolute -top-0.5 -right-0.5 flex min-w-4.5 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] leading-4.5 font-bold text-ink-950">
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
    </button>
  );
}
