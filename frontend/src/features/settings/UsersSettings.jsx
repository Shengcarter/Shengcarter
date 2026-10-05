import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { KeyRound, LockOpen, Pencil, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  Avatar, Badge, Button, Card, DataTable, IconButton, Input, Modal, Pagination, PasswordInput,
  SearchInput, Select, StatusBadge, Switch, applyServerErrors, ConfirmDialog,
} from '../../components/ui';
import { http } from '../../api/client';
import { formatDateTime } from '../../utils/format';
import { passwordRule, PASSWORD_HINT } from '../auth/passwordSchema';
import { useBranches, useRoles, useUsers, useApiMutation } from './api';
import { useAuthStore } from '../../store/authStore';

const baseSchema = {
  fullName: z.string().trim().min(1, 'Full name is required').max(120),
  email: z.string().trim().min(1, 'Email is required').email('Enter a valid email'),
  phone: z.string().trim().max(30).optional(),
  roleId: z.coerce.number({ error: 'Choose a role' }).int().positive('Choose a role'),
  branchId: z.string().optional(),
  employeeId: z.string().optional(),
  isActive: z.boolean(),
};
const createSchema = z.object({ ...baseSchema, password: passwordRule });
const editSchema = z.object(baseSchema);

function UserForm({ open, onClose, user }) {
  const isEdit = Boolean(user);
  const roles = useRoles(open);
  const branches = useBranches(open);
  const employees = useQuery({
    queryKey: ['employees', 'options'],
    queryFn: () => http.get('/employees/options').then((r) => r.data),
    enabled: open,
    retry: false,
  });
  const { register, handleSubmit, reset, setValue, watch, setError, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(isEdit ? editSchema : createSchema),
  });

  useEffect(() => {
    if (!open) return;
    reset({
      fullName: user?.fullName || '',
      email: user?.email || '',
      phone: user?.phone || '',
      roleId: user?.roleId || '',
      branchId: user?.branchId ? String(user.branchId) : '',
      employeeId: user?.employeeId ? String(user.employeeId) : '',
      isActive: user ? user.isActive : true,
      password: '',
    });
  }, [open, user, reset]);

  const mutation = useApiMutation(
    (values) => (isEdit ? http.patch(`/users/${user.id}`, values) : http.post('/users', values)),
    [['users']],
  );

  const onSubmit = handleSubmit(async (values) => {
    const payload = {
      ...values,
      phone: values.phone || null,
      branchId: values.branchId ? Number(values.branchId) : null,
      employeeId: values.employeeId ? Number(values.employeeId) : null,
    };
    try {
      await mutation.mutateAsync(payload);
      onClose();
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit user' : 'Add user'}
      description={isEdit ? user.email : 'New users must change their password when they first sign in.'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} loading={isSubmitting}>{isEdit ? 'Save changes' : 'Create user'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Full name" required className="sm:col-span-2" error={errors.fullName?.message} {...register('fullName')} />
        <Input label="Email" type="email" required error={errors.email?.message} {...register('email')} />
        <Input label="Phone" error={errors.phone?.message} {...register('phone')} />
        <Select
          label="Role"
          required
          placeholder="Choose a role"
          options={(roles.data || []).map((r) => ({ value: r.id, label: r.name }))}
          error={errors.roleId?.message}
          {...register('roleId')}
        />
        <Select
          label="Branch"
          placeholder="Default branch"
          options={(branches.data || []).filter((b) => b.isActive).map((b) => ({ value: String(b.id), label: b.name }))}
          error={errors.branchId?.message}
          {...register('branchId')}
        />
        <Select
          label="Linked employee profile"
          className="sm:col-span-2"
          hint="Link stylists to their employee profile so they see their own appointments and commissions."
          placeholder="Not linked"
          options={(employees.data || []).map((e) => ({ value: String(e.id), label: `${e.fullName} — ${e.jobTitle}` }))}
          error={errors.employeeId?.message}
          {...register('employeeId')}
        />
        {!isEdit ? (
          <PasswordInput label="Temporary password" required className="sm:col-span-2" hint={PASSWORD_HINT} autoComplete="new-password" error={errors.password?.message} {...register('password')} />
        ) : null}
        <Switch className="sm:col-span-2" label="Account active" description="Inactive users cannot sign in." checked={watch('isActive')} onChange={(v) => setValue('isActive', v, { shouldDirty: true })} />
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose }) {
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(z.object({ password: passwordRule })) });
  useEffect(() => reset({ password: '' }), [user, reset]);
  const mutation = useApiMutation((values) => http.post(`/users/${user.id}/reset-password`, values), [['users']]);
  const onSubmit = handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync(values);
      onClose();
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });
  return (
    <Modal
      open={Boolean(user)}
      onClose={onClose}
      size="sm"
      title="Reset password"
      description={user ? `Set a temporary password for ${user.fullName}. They will be asked to change it at next sign-in.` : ''}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} loading={isSubmitting}>Reset password</Button>
        </>
      }
    >
      <PasswordInput label="Temporary password" hint={PASSWORD_HINT} autoComplete="new-password" error={errors.password?.message} {...register('password')} />
    </Modal>
  );
}

export function UsersSettings() {
  const currentUserId = useAuthStore((s) => s.user?.id);
  const [params, setParams] = useState({ page: 1, limit: 20, search: '', roleId: '', status: '' });
  const users = useUsers(params);
  const roles = useRoles();
  const [editing, setEditing] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [resetting, setResetting] = useState(null);
  const unlock = useApiMutation((id) => http.post(`/users/${id}/unlock`), [['users']]);
  const resetTwoStep = useApiMutation((id) => http.post(`/users/${id}/reset-two-factor`), [['users']]);
  const [resettingTwoStep, setResettingTwoStep] = useState(null);

  const columns = [
    {
      key: 'fullName',
      header: 'User',
      primary: true,
      render: (u) => (
        <div className="flex items-center gap-3">
          <Avatar name={u.fullName} src={u.avatar} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium">
              {u.fullName} {u.id === currentUserId ? <span className="text-xs text-muted">(you)</span> : null}
            </p>
            <p className="truncate text-xs text-muted">{u.email}</p>
          </div>
          {u.isDemo ? <Badge tone="pink">Demo</Badge> : null}
          {u.twoFactorEnabled ? <span title="Two-step sign-in is on"><ShieldCheck className="size-4 shrink-0 text-success" aria-label="Two-step sign-in on" /></span> : null}
        </div>
      ),
    },
    { key: 'roleName', header: 'Role', render: (u) => <Badge tone="brand">{u.roleName}</Badge> },
    { key: 'branchName', header: 'Branch', render: (u) => u.branchName || '—' },
    { key: 'lastLoginAt', header: 'Last sign-in', hideOnMobile: true, render: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : 'Never') },
    {
      key: 'status',
      header: 'Status',
      render: (u) =>
        u.lockedUntil && new Date(u.lockedUntil) > new Date() ? <Badge tone="danger" dot>Locked</Badge> : <StatusBadge status={u.isActive ? 'active' : 'inactive'} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      hideOnMobile: false,
      render: (u) => (
        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {u.lockedUntil && new Date(u.lockedUntil) > new Date() ? (
            <IconButton icon={LockOpen} size="sm" label="Unlock account" onClick={() => unlock.mutate(u.id)} />
          ) : null}
          <IconButton icon={KeyRound} size="sm" label="Reset password" onClick={() => setResetting(u)} />
          {u.twoFactorEnabled ? <IconButton icon={ShieldOff} size="sm" label="Reset two-step sign-in" onClick={() => setResettingTwoStep(u)} /> : null}
          <IconButton icon={Pencil} size="sm" label="Edit user" onClick={() => { setEditing(u); setFormOpen(true); }} />
        </div>
      ),
    },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <SearchInput placeholder="Search users…" className="sm:w-72" onChange={(search) => setParams((p) => ({ ...p, search, page: 1 }))} />
        <select
          aria-label="Filter by role"
          className="h-10 rounded-xl border border-line bg-surface px-3 text-sm"
          value={params.roleId}
          onChange={(e) => setParams((p) => ({ ...p, roleId: e.target.value, page: 1 }))}
        >
          <option value="">All roles</option>
          {(roles.data || []).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <select
          aria-label="Filter by status"
          className="h-10 rounded-xl border border-line bg-surface px-3 text-sm"
          value={params.status}
          onChange={(e) => setParams((p) => ({ ...p, status: e.target.value, page: 1 }))}
        >
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <Button className="sm:ml-auto" icon={UserPlus} onClick={() => { setEditing(null); setFormOpen(true); }}>
          Add user
        </Button>
      </div>
      <DataTable
        columns={columns}
        rows={users.data?.data}
        loading={users.isPending}
        error={users.error}
        onRetry={users.refetch}
        onRowClick={(u) => { setEditing(u); setFormOpen(true); }}
      />
      <Pagination pagination={users.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
      <UserForm open={formOpen} onClose={() => setFormOpen(false)} user={editing} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
      <ConfirmDialog
        open={Boolean(resettingTwoStep)}
        onClose={() => setResettingTwoStep(null)}
        danger
        loading={resetTwoStep.isPending}
        title={`Reset two-step sign-in for ${resettingTwoStep?.fullName}?`}
        message="Only for someone who lost their phone and their recovery codes. Two-step sign-in is turned off and they are signed out everywhere; if it is required for them, they set it up again right after signing in. Make sure it is really them asking."
        confirmLabel="Reset two-step sign-in"
        onConfirm={async () => {
          await resetTwoStep.mutateAsync(resettingTwoStep.id).catch((e) => toast.error(e.message));
          setResettingTwoStep(null);
        }}
      />
    </Card>
  );
}
