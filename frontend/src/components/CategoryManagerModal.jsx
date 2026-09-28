import { useState } from 'react';
import { toast } from 'sonner';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Badge, Button, IconButton, Input, Modal, SkeletonRows } from './ui';

/**
 * Generic add / rename / delete list for simple categories
 * (product categories, expense categories).
 */
export function CategoryManagerModal({ open, onClose, title, description, query, countOf, onCreate, onRename, onDelete, onChanged }) {
  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null);

  const run = async (fn) => {
    try {
      const res = await fn();
      toast.success(res?.message || 'Saved');
      onChanged?.();
      return true;
    } catch (e) {
      toast.error(e.errors?.[0]?.message || e.message);
      return false;
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title} description={description}>
      <form
        className="mb-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run(() => onCreate(name))) setName('');
        }}
      >
        <Input className="flex-1" aria-label="New category name" placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" icon={Plus} disabled={!name.trim()}>Add</Button>
      </form>
      {query.isPending ? (
        <SkeletonRows rows={5} />
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {(query.data || []).map((c) => (
            <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
              {editing?.id === c.id ? (
                <>
                  <Input className="flex-1" aria-label="Category name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
                  <IconButton icon={Check} size="sm" label="Save" onClick={async () => (await run(() => onRename(c.id, editing.name))) && setEditing(null)} />
                  <IconButton icon={X} size="sm" label="Cancel" onClick={() => setEditing(null)} />
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium">{c.name}</span>
                  <Badge>{countOf(c)}</Badge>
                  <IconButton icon={Pencil} size="sm" label={`Rename ${c.name}`} onClick={() => setEditing({ id: c.id, name: c.name })} />
                  <IconButton icon={Trash2} size="sm" label={`Delete ${c.name}`} onClick={() => run(() => onDelete(c.id))} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
