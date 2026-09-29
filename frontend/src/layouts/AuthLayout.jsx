import { Suspense, useId } from 'react';
import { Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, Sparkles, ShieldCheck } from 'lucide-react';
import { http } from '../api/client';
import { Logo, PageLoader } from '../components/ui';

/** Abstract art: flowing rose-pink "hair strand" curves over a deep navy backdrop. */
function SalonArt() {
  const uid = useId().replace(/:/g, '');
  const id = (name) => `${name}-${uid}`;
  return (
    <svg className="absolute inset-0 size-full" viewBox="0 0 800 1000" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <radialGradient id={id('glow-brand')} cx="75%" cy="20%" r="60%">
          <stop offset="0" stopColor="#E3166A" stopOpacity="0.4" />
          <stop offset="1" stopColor="#E3166A" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('glow-pink')} cx="10%" cy="90%" r="55%">
          <stop offset="0" stopColor="#FFC3DC" stopOpacity="0.16" />
          <stop offset="1" stopColor="#FFC3DC" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('strand')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FF8BBA" stopOpacity="0" />
          <stop offset="0.45" stopColor="#E3166A" stopOpacity="0.9" />
          <stop offset="1" stopColor="#B10D52" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="1000" fill="#141A2E" />
      <rect width="800" height="1000" fill={`url(#${id('glow-brand')})`} />
      <rect width="800" height="1000" fill={`url(#${id('glow-pink')})`} />
      <g fill="none" stroke={`url(#${id('strand')})`} strokeLinecap="round">
        {Array.from({ length: 14 }).map((_, i) => (
          <path
            key={i}
            strokeWidth={i % 4 === 0 ? 1.6 : 0.8}
            opacity={0.25 + (i % 5) * 0.12}
            d={`M ${-80 + i * 22} ${1040 - i * 8} C ${180 + i * 18} ${760 - i * 26}, ${120 + i * 30} ${420 - i * 12}, ${520 + i * 16} ${200 - i * 10} S ${860 + i * 6} ${-40 + i * 4}, ${900} ${-60 + i * 14}`}
          />
        ))}
      </g>
      <g stroke="#E3166A" strokeOpacity="0.1">
        {Array.from({ length: 9 }).map((_, i) => (
          <line key={i} x1={0} y1={110 * i + 40} x2={800} y2={110 * i - 60} />
        ))}
      </g>
    </svg>
  );
}

const HIGHLIGHTS = [
  { icon: CalendarCheck, text: 'Appointments, staff schedules and QR check-in' },
  { icon: Sparkles, text: 'Point of sale, inventory and loyalty rewards' },
  { icon: ShieldCheck, text: 'Secure, role-based access for every team member' },
];

export default function AuthLayout() {
  const branding = useQuery({
    queryKey: ['branding'],
    queryFn: () => http.get('/public/branding').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
  const salonName = branding.data?.salonName;

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden lg:block">
        <SalonArt />
        <div className="relative flex h-full flex-col justify-between p-12 text-white xl:p-16">
          <Logo className="[&_p]:text-white/90" logo={branding.data?.logo || undefined} />
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <p className="mb-4 text-xs font-semibold tracking-[0.3em] text-brand-300/90 uppercase">{salonName || 'Luxury salon operations'}</p>
            <h1 className="font-display text-4xl leading-tight font-semibold xl:text-5xl">
              <span className="brand-text">ZOLA STYLISH</span>
              <br />
              MANAGEMENT SYSTEM
            </h1>
            <p className="mt-5 max-w-md text-base leading-relaxed text-white/70">
              Everything your salon runs on — beautifully organised in one place.
            </p>
            <ul className="mt-10 space-y-4">
              {HIGHLIGHTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3 text-sm text-white/80">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-white/5 ring-1 ring-brand-500/30">
                    <Icon className="size-4 text-brand-400" aria-hidden />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </motion.div>
          <p className="text-xs text-white/40">© {new Date().getFullYear()} ZOLA STYLISH MANAGEMENT SYSTEM</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="relative flex flex-col">
        <div className="relative h-40 overflow-hidden lg:hidden">
          <SalonArt />
          <div className="relative flex h-full items-end p-6">
            <Logo className="[&_p]:text-white/90" logo={branding.data?.logo || undefined} />
          </div>
        </div>
        <main className="flex flex-1 items-center justify-center px-5 py-10 sm:px-10">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="w-full max-w-md"
          >
            <Suspense fallback={<PageLoader />}>
              <Outlet context={{ branding: branding.data }} />
            </Suspense>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
