import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Building2, Pencil, Plus } from 'lucide-react';
import { Badge, Button, Card, DataTable, IconButton, Input, Modal, StatusBadge, Switch, Textarea, applyServerErrors } from '../../components/ui';
import { http } from '../../api/client';
import { useBranches, useApiMutation } from './api';
import { reloadSession } from '../auth/api';

function BranchForm({ open, onClose, branch }) {
  const isEdit = Boolean(branch);
  const { register, handleSubmit, reset, watch, setValue, setError, formState: { errors, isSubmitting } } = useForm();
  useEffect(() => {
    if (open) reset({ code: branch?.code || '', name: branch?.name || '', phone: branch?.phone || '', email: branch?.email || '', address: branch?.address || '', isActive: branch ? branch.isActive : true, isDefault: branch?.isDefault || false });
  }, [open, branch, reset]);
  const mutation = useApiMutation((body) => (isEdit ? http.patch(`/branches/${branch.id}`, body) : http.post('/branches', body)), [['branches']]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await mutation.mutateAsync(values);
      await reloadSession();
      onClose();
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit branch' : 'New branch'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSubmit} loading={isSubmitting}>{isEdit ? 'Save changes' : 'Create branch'}</Button>
        </>
      }
    >
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Input label="Branch name" required error={errors.name?.message} {...register('name')} />
        <Input label="Code" required hint="Short unique code, e.g. MSK" error={errors.code?.message} {...register('code')} />
        <Input label="Phone" error={errors.phone?.message} {...register('phone')} />
        <Input label="Email" type="email" error={errors.email?.message} {...register('email')} />
        <Textarea label="Address" rows={2} className="sm:col-span-2" error={errors.address?.message} {...register('address')} />
        <Switch className="sm:col-span-2" label="Active" description="Inactive branches are hidden from the branch selector." checked={watch('isActive')} onChange={(v) => setValue('isActive', v)} />
        <Switch className="sm:col-span-2" label="Default branch" description="Used for users who are not assigned to a branch." checked={watch('isDefault')} onChange={(v) => setValue('isDefault', v)} />
      </form>
    </Modal>
  );
}

export function BranchesSettings() {
  const branches = useBranches();
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);

  const columns = [
    {
      key: 'name',
      header: 'Branch',
      primary: true,
      render: (b) => (
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-xl bg-brand-500/10 text-accent"><Building2 className="size-4" /></span>
          <div>
            <p className="font-medium">{b.name} {b.isDefault ? <Badge tone="brand" className="ml-1">Default</Badge> : null}</p>
            <p className="text-xs text-muted">{b.code} · {b.address || 'No address'}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', render: (b) => b.phone || '—' },
    { key: 'employeeCount', header: 'Staff', align: 'right' },
    { key: 'userCount', header: 'Users', align: 'right' },
    { key: 'isActive', header: 'Status', render: (b) => <StatusBadge status={b.isActive ? 'active' : 'inactive'} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      render: (b) => <IconButton icon={Pencil} size="sm" label={`Edit ${b.name}`} onClick={(e) => { e.stopPropagation(); setEditing(b); setOpen(true); }} />,
    },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-line p-4">
        <p className="text-sm text-muted">Each branch has its own staff, stock, appointments, sales and expenses. Customers and services are shared.</p>
        <Button icon={Plus} onClick={() => { setEditing(null); setOpen(true); }}>New branch</Button>
      </div>
      <DataTable columns={columns} rows={branches.data} loading={branches.isPending} error={branches.error} onRetry={branches.refetch} onRowClick={(b) => { setEditing(b); setOpen(true); }} />
      <BranchForm open={open} onClose={() => setOpen(false)} branch={editing} />
    </Card>
  );
}
