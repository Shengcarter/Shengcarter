import { useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Badge, Button, IconButton, Input, Modal, SkeletonRows } from '../../components/ui';
import { serviceApi, serviceKeys, useServiceCategories } from './api';

export function CategoriesModal({ open, onClose }) {
  const categories = useServiceCategories({ enabled: open });
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: serviceKeys.categories });
    qc.invalidateQueries({ queryKey: serviceKeys.all });
  };
  const run = async (fn) => {
    try {
      const res = await fn();
      toast.success(res.message);
      refresh();
      return true;
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
      return false;
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Service categories" description="Group services on the menu, POS and reports.">
      <form
        className="mb-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => serviceApi.createCategory({ name: newName }))) setNewName('');
        }}
      >
        <Input className="flex-1" aria-label="New category name" placeholder="New category name" value={newName} onChange={(e) => setNewName(e.target.value)} />
        <Button type="submit" icon={Plus} disabled={!newName.trim()}>Add</Button>
      </form>
      {categories.isPending ? (
        <SkeletonRows rows={5} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {categories.data.map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              {editing?.id === c.id ? (
                <>
                  <Input className="flex-1" aria-label="Category name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  <IconButton icon={Check} size="sm" label="Save" onClick={async () => (await run(() => serviceApi.updateCategory(c.id, { name: editing.name }))) && setEditing(null)} />
                  <IconButton icon={X} size="sm" label="Cancel" onClick={() => setEditing(null)} />
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium">{c.name}</span>
                  <Badge>{c.serviceCount} services</Badge>
                  <IconButton icon={Pencil} size="sm" label={`Rename ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })} />
                  <IconButton icon={Trash2} size="sm" label={`Delete ${c.name}`} disabled={c.serviceCount > 0} onClick={() => run(() => serviceApi.removeCategory(c.id))} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
