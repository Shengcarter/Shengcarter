import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '../../components/ui';
import { TwoStepSetup } from '../../features/auth/TwoStep';
import { useAuthStore } from '../../store/authStore';
import { logout } from '../../features/auth/api';
import { useDocumentTitle } from '../../hooks';

/** Shown when the salon requires two-step sign-in for this account and it is not set up yet. */
export default function SetupTwoStepPage() {
  useDocumentTitle('Set up two-step sign-in');
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-lg">
        <Logo className="mb-10 justify-center" />
        <div className="card p-6 sm:p-8">
          <div className="mb-6 flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-accent">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <div>
              <h1 className="font-display text-xl font-semibold">Set up two-step sign-in</h1>
              <p className="mt-1 text-sm text-muted">
                {user?.fullName ? `${user.fullName}, your` : 'Your'} salon requires a code from an authenticator app on your phone, as well as your password, to sign in to this account.
              </p>
            </div>
          </div>
          <TwoStepSetup onDone={() => navigate('/', { replace: true })} />
        </div>
        <button type="button" onClick={() => logout()} className="mt-6 w-full text-center text-sm text-muted hover:text-fg">
          Sign out
        </button>
      </div>
    </div>
  );
}
