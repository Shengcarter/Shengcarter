import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore, hasPermission } from '../store/authStore';
import { BrandMark, Spinner } from '../components/ui';
import ForbiddenPage from '../pages/ForbiddenPage';
import { NAV_ITEMS } from './navigation';

export function SplashScreen() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6">
      <BrandMark className="size-14 animate-pulse" />
      <p className="text-xs font-semibold tracking-[0.3em] text-muted">ZOLA STYLISH MANAGEMENT SYSTEM</p>
      <Spinner label="Loading ZOLA STYLISH MANAGEMENT SYSTEM" />
    </div>
  );
}

/** Requires a signed-in user; enforces the first-login password change and required two-step sign-in. */
export function RequireAuth({ children, allowPasswordChange = false, allowTwoFactorSetup = false }) {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const location = useLocation();

  if (status === 'loading') return <SplashScreen />;
  if (status !== 'authenticated') return <Navigate to="/login" replace state={{ from: location }} />;
  if (user?.mustChangePassword && !allowPasswordChange) return <Navigate to="/change-password" replace />;
  if (!user?.mustChangePassword && user?.twoFactorSetupRequired && !allowTwoFactorSetup) return <Navigate to="/setup-two-step" replace />;
  return children;
}

/** Pages like /login redirect away when already signed in. */
export function PublicOnly({ children }) {
  const status = useAuthStore((s) => s.status);
  if (status === 'loading') return <SplashScreen />;
  if (status === 'authenticated') return <Navigate to="/" replace />;
  return children;
}

/** Route-level permission check (the API enforces the same rules). */
export function RequirePermission({ permission, children }) {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  if (!hasPermission({ user, permissions }, permission)) return <ForbiddenPage />;
  return children;
}

/** Home: dashboard if allowed, otherwise the first module the user can use. */
export function HomeRedirect({ children }) {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  if (hasPermission({ user, permissions }, 'dashboard.view')) return children;
  const first = NAV_ITEMS.find((i) => i.to !== '/' && (!i.permission || hasPermission({ user, permissions }, i.permission)));
  return <Navigate to={first?.to || '/notifications'} replace />;
}
