import { Save } from 'lucide-react';
import { Button, Card } from '../../components/ui';

/** Consistent card wrapper for a settings form section. */
export function SettingsSection({ title, description, children, onSubmit, saving, dirty = true, footer }) {
  return (
    <Card as="form" onSubmit={onSubmit} noValidate className="overflow-hidden">
      <div className="border-b border-line px-5 py-4 sm:px-6">
        <h2 className="text-base font-semibold">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      <div className="space-y-5 px-5 py-5 sm:px-6">{children}</div>
      {onSubmit ? (
        <div className="flex items-center justify-end gap-3 border-t border-line bg-surface-2/40 px-5 py-3.5 sm:px-6">
          {footer}
          <Button type="submit" loading={saving} disabled={!dirty} icon={Save}>
            Save changes
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

export function FieldGrid({ children, cols = 2 }) {
  return <div className={cols === 3 ? 'grid gap-5 sm:grid-cols-2 lg:grid-cols-3' : 'grid gap-5 sm:grid-cols-2'}>{children}</div>;
}
