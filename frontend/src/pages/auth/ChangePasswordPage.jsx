import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { Logo } from '../../components/ui';
import { ChangePasswordForm } from '../../features/auth/ChangePasswordForm';
import { useAuthStore } from '../../store/authStore';
import { logout } from '../../features/auth/api';
import { useDocumentTitle } from '../../hooks';

/** Shown when an administrator requires the user to set a new password. */
export default function ChangePasswordPage() {
  useDocumentTitle('Change password');
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <Logo className="mb-10 justify-center" />
        <div className="card p-6 sm:p-8">
          <div className="mb-6 flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-gold-500/10 text-accent">
              <ShieldCheck className="size-5" aria-hidden />
            </div>
            <div>
              <h1 className="font-display text-xl font-semibold">Set a new password</h1>
              <p className="mt-1 text-sm text-muted">
                Welcome{user?.fullName ? `, ${user.fullName}` : ''}. For your security, please replace the temporary password before continuing.
              </p>
            </div>
          </div>
          <ChangePasswordForm submitLabel="Save and continue" onDone={() => navigate('/', { replace: true })} />
        </div>
        <button
          type="button"
          onClick={async () => {
            await logout();
            navigate('/login', { replace: true });
          }}
          className="mt-6 w-full text-center text-sm text-muted hover:text-fg"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
