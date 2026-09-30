import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Download, FileSpreadsheet, FileText, Sheet } from 'lucide-react';
import { Button, DateRange, Dropdown, DropdownItem, FilterSelect, PageHeader, Tabs } from '../../components/ui';
import { usePermission, useDocumentTitle } from '../../hooks';
import { formatDate } from '../../utils/format';
import { reportsApi } from './api';
import { PRESETS, presetRange } from './periods';
import { CustomersReport, SalesReport, ServicesReport, StaffReport } from './SalesReports';
import { BranchesReport, ExpensesReport, InventoryReport, ProfitReport } from './FinanceReports';
import { InsightsPanel } from './InsightsPanel';
import { CostingReport } from './CostingReport';

const TABS = [
  { value: 'insights', label: 'Insights', permission: 'insights.view', component: InsightsPanel },
  { value: 'sales', label: 'Sales', permission: 'reports.view', component: SalesReport },
  { value: 'customers', label: 'Customers', permission: 'reports.view', component: CustomersReport },
  { value: 'services', label: 'Services', permission: 'reports.view', component: ServicesReport },
  { value: 'staff', label: 'Staff', permission: 'reports.view', component: StaffReport },
  { value: 'inventory', label: 'Inventory', permission: 'reports.view', component: InventoryReport },
  { value: 'expenses', label: 'Expenses', permission: 'reports.financial', component: ExpensesReport },
  { value: 'profit', label: 'Profit & loss', permission: 'reports.financial', component: ProfitReport },
  { value: 'costing', label: 'Service costing', permission: 'reports.financial', component: CostingReport },
  { value: 'branches', label: 'Branches', permission: ['reports.financial', 'branches.manage'], all: true, component: BranchesReport },
];

const FORMATS = [
  { value: 'pdf', label: 'PDF document', icon: FileText },
  { value: 'xlsx', label: 'Excel workbook', icon: FileSpreadsheet },
  { value: 'csv', label: 'CSV (spreadsheet data)', icon: Sheet },
];

export default function ReportsPage() {
  useDocumentTitle('Reports');
  const can = usePermission();
  const [search, setSearch] = useSearchParams();
  const tabs = useMemo(
    () => TABS.filter((t) => (Array.isArray(t.permission) && t.all ? t.permission.every((p) => can(p)) : can(t.permission))),
    [can],
  );
  const tab = tabs.find((t) => t.value === search.get('tab')) || tabs[0];
  const preset = search.get('preset') || (tab?.value === 'insights' ? 'last_30' : 'this_month');
  const range = preset === 'custom' ? { from: search.get('from') || presetRange('this_month').from, to: search.get('to') || presetRange('this_month').to } : presetRange(preset);
  const groupBy = search.get('groupBy') || '';
  const params = { ...range, groupBy };
  const [exporting, setExporting] = useState(null);

  const update = (patch) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearch(next, { replace: true });
  };

  const exportAs = async (format) => {
    setExporting(format);
    try {
      await reportsApi.export(tab.value, params, format);
      toast.success('Report downloaded');
    } catch (error) {
      toast.error(error.message);
    } finally {
      setExporting(null);
    }
  };

  if (!tab) return null;
  const Component = tab.component;
  const canExport = tab.value !== 'insights' && can('reports.export');

  return (
    <div>
      <PageHeader
        title="Reports"
        description={`${formatDate(range.from)} – ${formatDate(range.to)}`}
        actions={canExport ? (
          <Dropdown
            width="w-60"
            trigger={({ props }) => <Button {...props} variant="secondary" icon={Download} loading={Boolean(exporting)}>Export</Button>}
          >
            {({ close }) => (
              <>
                <p className="px-3 pt-1 pb-2 text-xs font-semibold tracking-wider text-muted uppercase">Download {tab.label.toLowerCase()} report</p>
                {FORMATS.map((f) => (
                  <DropdownItem key={f.value} icon={f.icon} onClick={() => { close(); exportAs(f.value); }}>{f.label}</DropdownItem>
                ))}
              </>
            )}
          </Dropdown>
        ) : null}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <FilterSelect label="Period" className="w-full sm:w-auto" value={preset} onChange={(value) => update({ preset: value, from: value === 'custom' ? range.from : '', to: value === 'custom' ? range.to : '' })}>
          {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </FilterSelect>
        {preset === 'custom' ? <DateRange from={range.from} to={range.to} onChange={(r) => update({ from: r.from, to: r.to })} /> : null}
        {tab.value !== 'insights' ? (
          <FilterSelect label="Group by" className="w-full sm:w-auto" value={groupBy} onChange={(value) => update({ groupBy: value })}>
            <option value="">Automatic grouping</option>
            <option value="day">By day</option>
            <option value="week">By week</option>
            <option value="month">By month</option>
            <option value="year">By year</option>
          </FilterSelect>
        ) : null}
      </div>

      <Tabs className="mb-6" tabs={tabs.map(({ value, label }) => ({ value, label }))} value={tab.value} onChange={(value) => update({ tab: value })} />
      <Component params={params} />
    </div>
  );
}
