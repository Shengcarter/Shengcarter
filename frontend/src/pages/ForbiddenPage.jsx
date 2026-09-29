import { ShieldAlert } from 'lucide-react';
import { EmptyState, ButtonLink } from '../components/ui';
import { useDocumentTitle } from '../hooks';

export default function ForbiddenPage() {
  useDocumentTitle('Access denied');
  return (
    <EmptyState
      icon={ShieldAlert}
      title="You don't have access to this page"
      description="Your role does not include permission for this module. Ask your administrator if you need access."
      action={<ButtonLink to="/" variant="secondary">Go to home</ButtonLink>}
      className="min-h-[60vh]"
    />
  );
}
