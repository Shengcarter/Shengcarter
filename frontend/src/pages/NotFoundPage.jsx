import { Compass } from 'lucide-react';
import { EmptyState, ButtonLink } from '../components/ui';
import { useDocumentTitle } from '../hooks';

export default function NotFoundPage() {
  useDocumentTitle('Page not found');
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <EmptyState
        icon={Compass}
        title="Page not found"
        description="The page you are looking for does not exist or has been moved."
        action={<ButtonLink to="/">Back to dashboard</ButtonLink>}
      />
    </div>
  );
}
