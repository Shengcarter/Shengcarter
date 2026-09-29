import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, Input, Modal, SkeletonRows, Textarea } from '../../components/ui';
import { http } from '../../api/client';
import { cn } from '../../utils/cn';
import { titleCase } from '../../utils/format';
import { usePermissionCatalog, useRoles, useApiMutation } from './api';

function NewRoleModal({ open, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(null);
  const create = useApiMutation((body) => http.post('/roles', body), [['roles']]);
  useEffect(() => {
    if (open) {
      setName('');
      setDescription('');
      setError(null);
    }
  }, [open]);

  const submit = async () => {
    try {
      const res = await create.mutateAsync({ name, description, permissions: ['dashboard.view'] });
      onCreated(res.data.id);
      onClose();
    } catch (e) {
      setError(e.errors?.[0]?.message || e.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="New role"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={create.isPending}>Create role</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="Role name" required value={name} onChange={(e) => setName(e.target.value)} error={error} />
        <Textarea label="Description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </Modal>
  );
}

export function RolesSettings() {
  const roles = useRoles();
  const catalog = usePermissionCatalog();
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(new Set());
  const [newOpen, setNewOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selected = useMemo(() => roles.data?.find((r) => r.id === selectedId) || roles.data?.[0], [roles.data, selectedId]);
  useEffect(() => {
    if (selected) setDraft(new Set(selected.permissions));
  }, [selected]);

  const save = useApiMutation((perms) => http.patch(`/roles/${selected.id}`, { permissions: perms }), [['roles']]);
  const remove = useApiMutation(() => http.delete(`/roles/${selected.id}`), [['roles']]);

  const isSuperAdmin = selected?.slug === 'super_admin';
  const dirty = selected && (draft.size !== selected.permissions.length || selected.permissions.some((p) => !draft.has(p)));

  const toggle = (code) => {
    if (isSuperAdmin) return;
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const toggleModule = (codes, on) => {
    if (isSuperAdmin) return;
    setDraft((prev) => {
      const next = new Set(prev);
      codes.forEach((c) => (on ? next.add(c) : next.delete(c)));
      return next;
    });
  };

  if (roles.isPending || catalog.isPending) return <SkeletonRows />;

  return (
    <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
      <Card className="h-fit p-2">
        <div className="flex items-center justify-between px-3 py-2">
          <p className="text-sm font-semibold">Roles</p>
          <Button size="xs" variant="ghost" icon={Plus} onClick={() => setNewOpen(true)}>New</Button>
        </div>
        <ul className="space-y-1">
          {roles.data.map((role) => (
            <li key={role.id}>
              <button
                type="button"
                onClick={() => setSelectedId(role.id)}
                className={cn('flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm', selected?.id === role.id ? 'bg-brand-500/10 ring-1 ring-brand-500/25' : 'hover:bg-surface-2')}
              >
                <span>
                  <span className="block font-medium">{role.name}</span>
                  <span className="block text-xs text-muted">{role.userCount} user(s) · {role.permissions.length} permissions</span>
                </span>
                {role.isSystem ? <Badge>Built-in</Badge> : null}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      {selected ? (
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-accent" /> {selected.name}</h2>
              <p className="text-sm text-muted">{selected.description || 'Custom role'}</p>
            </div>
            <div className="flex gap-2">
              {!selected.isSystem ? (
                <Button variant="danger-ghost" size="sm" icon={Trash2} onClick={() => setConfirmDelete(true)}>Delete role</Button>
              ) : null}
              <Button size="sm" icon={Save} disabled={!dirty || isSuperAdmin} loading={save.isPending} onClick={() => save.mutate([...draft])}>
                Save permissions
              </Button>
            </div>
          </div>
          {isSuperAdmin ? (
            <p className="border-b border-line bg-brand-500/5 px-5 py-3 text-sm text-accent">Super Admin always has every permission. It cannot be restricted.</p>
          ) : null}
          <div className="divide-y divide-line">
            {catalog.data.map((group) => {
              const codes = group.permissions.map((p) => p.code);
              const allOn = codes.every((c) => draft.has(c));
              return (
                <fieldset key={group.module} className="px-5 py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <legend className="text-sm font-semibold">{titleCase(group.module)}</legend>
                    {!isSuperAdmin ? (
                      <button type="button" className="text-xs text-accent hover:underline" onClick={() => toggleModule(codes, !allOn)}>
                        {allOn ? 'Clear all' : 'Select all'}
                      </button>
                    ) : null}
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.permissions.map((perm) => (
                      <label key={perm.code} className={cn('flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3 py-2.5', draft.has(perm.code) && 'border-brand-500/40 bg-brand-500/5')}>
                        <input type="checkbox" className="mt-0.5 size-4 accent-brand-500" checked={draft.has(perm.code)} disabled={isSuperAdmin} onChange={() => toggle(perm.code)} />
                        <span className="text-sm">
                          <span className="block font-medium">{perm.description}</span>
                          <code className="text-[11px] text-muted">{perm.code}</code>
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </Card>
      ) : (
        <EmptyState title="No role selected" />
      )}

      <NewRoleModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={setSelectedId} />
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title={`Delete role "${selected?.name}"?`}
        message="Users must be moved to another role first. This cannot be undone."
        confirmLabel="Delete role"
        loading={remove.isPending}
        onConfirm={async () => {
          try {
            await remove.mutateAsync();
            setSelectedId(null);
            setConfirmDelete(false);
          } catch (e) {
            toast.error(e.message);
          }
        }}
      />
    </div>
  );
}
