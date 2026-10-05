import { useNavigate } from 'react-router-dom';
import { ArrowRight, CircleCheck, FileSpreadsheet, ReceiptText, Users } from 'lucide-react';
import { Button, Card } from '../../components/ui';
import { usePermission } from '../../hooks';

/**
 * One place for bringing in records kept before the system: customer lists
 * and past sales from Excel or CSV. Each opens the import on its own page.
 */
const IMPORTS = [
  {
    permission: 'customers.import',
    icon: Users,
    title: 'Customer list',
    description: 'Names, phone numbers, emails, birthdays and notes. Phone numbers already registered are skipped.',
    to: '/customers?import=1',
    action: 'Import customers',
  },
  {
    permission: 'sales.import',
    icon: ReceiptText,
    title: 'Past sales',
    description: 'Sales recorded before the system, e.g. in an Excel sheet. Each service is split with its own financial rule, as at the till; they count in reports, staff performance and customer history, but do not change stock, and staff shares are recorded as commission already paid.',
    to: '/pos/sales?import=1',
    action: 'Import past sales',
  },
];

const STEPS = [
  'Add your services, products and staff first (Services, Inventory and Employees pages): past sales are matched to them by name.',
  'Import your customer list, so past sales link to the right customers.',
  'Import past sales. Start from the template: it lists your services and staff in drop-downs.',
  'Check the preview. Nothing is saved until you press Import, and rows with problems are explained.',
];

export function ImportSettings() {
  const can = usePermission();
  const navigate = useNavigate();
  const available = IMPORTS.filter((i) => can(i.permission));

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-accent"><FileSpreadsheet className="size-4" aria-hidden /></span>
          <div>
            <h2 className="font-semibold">Import data from Excel</h2>
            <p className="mt-0.5 text-sm text-muted">Bring in the records you kept before using ZOLA STYLISH MANAGEMENT SYSTEM. Excel (.xlsx) and CSV files work, up to 5,000 rows each.</p>
          </div>
        </div>
        <ol className="mt-4 space-y-2">
          {STEPS.map((step, i) => (
            <li key={step} className="flex gap-3 text-sm">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs font-semibold">{i + 1}</span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {available.map((item) => (
          <Card key={item.title} className="flex flex-col p-5">
            <div className="flex items-center gap-2">
              <item.icon className="size-5 text-accent" aria-hidden />
              <h3 className="font-semibold">{item.title}</h3>
            </div>
            <p className="mt-2 flex-1 text-sm text-muted">{item.description}</p>
            <Button className="mt-4 self-start" icon={ArrowRight} onClick={() => navigate(item.to)}>{item.action}</Button>
          </Card>
        ))}
      </div>

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <CircleCheck className="size-3.5 text-success" aria-hidden />
        Importing the same file twice adds nothing twice: registered phone numbers and receipt numbers already imported are skipped.
      </p>
    </div>
  );
}
