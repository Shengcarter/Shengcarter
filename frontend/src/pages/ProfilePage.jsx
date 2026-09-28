import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Camera } from 'lucide-react';
import { Avatar, Card, Detail, PageHeader, Tabs } from '../components/ui';
import { ChangePasswordForm } from '../features/auth/ChangePasswordForm';
import { useAuthStore } from '../store/authStore';
import { http } from '../api/client';
import { reloadSession } from '../features/auth/api';
import { useDocumentTitle } from '../hooks';

export default function ProfilePage() {
  useDocumentTitle('My profile');
  const user = useAuthStore((s) => s.user);
  const branches = useAuthStore((s) => s.branches);
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'profile';
  const fileInput = useRef(null);
  const [uploading, setUploading] = useState(false);

  const uploadAvatar = async (file) => {
    if (!file) return;
    setUploading(true);
    try {
      await http.upload('/users/me/avatar', 'avatar', file);
      await reloadSession();
      toast.success('Profile photo updated');
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="My profile" description="Your account details and security." />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(value) => setParams({ tab: value })}
        tabs={[
          { value: 'profile', label: 'Profile' },
          { value: 'password', label: 'Password' },
        ]}
      />
      {tab === 'profile' ? (
        <Card className="p-6">
          <div className="flex flex-col items-center gap-5 sm:flex-row">
            <div className="relative">
              <Avatar name={user?.fullName} src={user?.avatar} size="xl" />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                className="absolute -right-1 -bottom-1 flex size-8 items-center justify-center rounded-full bg-gold-500 text-ink-950 shadow ring-2 ring-surface"
                aria-label="Change profile photo"
              >
                <Camera className="size-4" />
              </button>
              <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => uploadAvatar(e.target.files?.[0])} />
            </div>
            <div className="text-center sm:text-left">
              <h2 className="font-display text-2xl font-semibold">{user?.fullName}</h2>
              <p className="text-sm text-muted">{user?.email}</p>
            </div>
          </div>
          <dl className="mt-8 grid gap-5 sm:grid-cols-2">
            <Detail label="Role">{user?.role?.name}</Detail>
            <Detail label="Branch">{branches.find((b) => b.id === user?.branchId)?.name || 'Default branch'}</Detail>
            <Detail label="Phone">{user?.phone}</Detail>
            <Detail label="Employee profile">{user?.employeeId ? 'Linked' : 'Not linked'}</Detail>
          </dl>
          <p className="mt-6 text-xs text-muted">To change your name, email or role, ask an administrator.</p>
        </Card>
      ) : (
        <Card className="p-6">
          <h2 className="mb-1 font-semibold">Change password</h2>
          <p className="mb-6 text-sm text-muted">Other devices will be signed out after the change.</p>
          <ChangePasswordForm />
        </Card>
      )}
    </div>
  );
}
