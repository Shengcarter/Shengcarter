import { useId } from 'react';
import { cn } from '../../utils/cn';

export const SYSTEM_NAME = 'ZOLA STYLISH MANAGEMENT SYSTEM';

/** Rose-pink "Z" monogram on navy, used when no custom logo is uploaded. */
export function BrandMark({ className, logo }) {
  // Unique gradient id per instance: a duplicate id inside a hidden element breaks the fill.
  const gradientId = `zola-mark-${useId().replace(/:/g, '')}`;
  if (logo) {
    return <img src={logo} alt="" className={cn('size-10 shrink-0 rounded-xl object-contain', className)} />;
  }
  return (
    <svg viewBox="0 0 64 64" className={cn('size-10 shrink-0', className)} aria-hidden>
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8BBA" />
          <stop offset="0.5" stopColor="#E3166A" />
          <stop offset="1" stopColor="#B10D52" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="#141A2E" />
      <rect x="1" y="1" width="62" height="62" rx="15" fill="none" stroke={`url(#${gradientId})`} strokeOpacity="0.35" />
      <path d="M18 18h28v4.5L25.5 42H46v4H18v-4.5L38.5 22H18z" fill={`url(#${gradientId})`} />
    </svg>
  );
}

/** Full brand lock-up: monogram + the official system name. */
export function Logo({ className, compact = false, logo, subtitle }) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <BrandMark logo={logo} />
      {!compact ? (
        <div className="min-w-0 leading-tight">
          <p className="font-display text-[15px] font-bold tracking-[0.14em] text-fg">
            <span className="brand-text">ZOLA</span> STYLISH
          </p>
          <p className="text-[10px] font-medium tracking-[0.22em] text-muted">MANAGEMENT SYSTEM</p>
          {subtitle ? <p className="mt-0.5 truncate text-[11px] text-muted">{subtitle}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
