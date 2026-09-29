import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, UserRoundCheck } from 'lucide-react';
import { Avatar, Badge, Button, Card, DataTable, EmptyState, PageHeader, Pagination, SearchInput, StatusBadge, Tabs } from '../../components/ui';
import { formatDate, formatMoney } from '../../utils/format';
import { usePermission, useDocumentTitle } from '../../hooks';
import { useEmployees } from './api';
import { EmployeeFormModal } from './EmployeeFormModal';
import { AttendancePanel } from './AttendancePanel';
import { LeavePanel } from './LeavePanel';
import { PayrollPanel } from './PayrollPanel';

function StaffList() {
  const can = usePermission();
  const navigate = useNavigate();
  const [params, setParams] = useState({ page: 1, limit: 20, search: '', status: '' });
  const employees = useEmployees(params);
  const [creating, setCreating] = useState(false);
  const canSeePay = can('employees.manage') || can('payroll.manage');

  const columns = [
    {
      key: 'name',
      header: 'Employee',
      primary: true,
      render: (e) => (
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar name={e.fullName} src={e.photo} size="sm" />
            <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full ring-2 ring-surface" style={{ background: e.calendarColor }} aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="truncate font-medium">{e.fullName}</p>
            <p className="truncate text-xs text-muted">{e.code} · {e.jobTitle}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', header: 'Phone', render: (e) => e.phone || '—' },
    { key: 'serviceCount', header: 'Services', align: 'right' },
    { key: 'commissionRate', header: 'Commission', align: 'right', render: (e) => `${e.commissionRate}%` },
    ...(canSeePay ? [{ key: 'salary', header: 'Salary', align: 'right', hideOnMobile: true, render: (e) => formatMoney(e.salary) }] : []),
    { key: 'employmentDate', header: 'Since', hideOnMobile: true, render: (e) => formatDate(e.employmentDate) },
    {
      key: 'status',
      header: 'Status',
      render: (e) => (
        <div className="flex flex-wrap gap-1">
          <StatusBadge status={e.status} />
          {e.userEmail ? <Badge tone="info">Has login</Badge> : null}
          {!e.isBookable ? <Badge>Not bookable</Badge> : null}
        </div>
      ),
    },
  ];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
        <SearchInput placeholder="Search staff…" className="sm:w-72" onChange={(search) => setParams((p) => ({ ...p, search, page: 1 }))} />
        <select aria-label="Status" className="h-10 rounded-xl border border-line bg-surface px-3 text-sm" value={params.status} onChange={(e) => setParams((p) => ({ ...p, status: e.target.value, page: 1 }))}>
          <option value="">Current staff</option>
          <option value="active">Active</option>
          <option value="on_leave">On leave</option>
          <option value="inactive">Inactive</option>
          <option value="terminated">Terminated</option>
        </select>
        {can('employees.manage') ? <Button className="sm:ml-auto" icon={Plus} onClick={() => setCreating(true)}>New employee</Button> : null}
      </div>
      <DataTable
        columns={columns}
        rows={employees.data?.data}
        loading={employees.isPending}
        error={employees.error}
        onRetry={employees.refetch}
        onRowClick={(e) => navigate(`/employees/${e.id}`)}
        empty={<EmptyState icon={UserRoundCheck} title="No staff found" description="Add your stylists, barbers and front-desk team." />}
      />
      <Pagination pagination={employees.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
      <EmployeeFormModal open={creating} onClose={() => setCreating(false)} onSaved={(e) => navigate(`/employees/${e.id}`)} />
    </Card>
  );
}

export default function EmployeesPage() {
  useDocumentTitle('Employees');
  const can = usePermission();
  const [params, setParams] = useSearchParams();
  const tabs = [
    { value: 'staff', label: 'Staff' },
    ...(can(['attendance.view', 'attendance.manage']) ? [{ value: 'attendance', label: 'Attendance' }] : []),
    ...(can(['leave.manage', 'employees.view']) ? [{ value: 'leave', label: 'Leave' }] : []),
    ...(can('payroll.manage') ? [{ value: 'payroll', label: 'Payroll' }] : []),
  ];
  const tab = tabs.some((t) => t.value === params.get('tab')) ? params.get('tab') : 'staff';

  return (
    <div>
      <PageHeader title="Employees" description="Staff profiles, schedules, attendance, leave and performance." />
      <Tabs className="mb-5" tabs={tabs} value={tab} onChange={(value) => setParams({ tab: value })} />
      {tab === 'staff' ? <StaffList /> : null}
      {tab === 'attendance' ? <AttendancePanel /> : null}
      {tab === 'leave' ? <LeavePanel /> : null}
      {tab === 'payroll' ? <PayrollPanel /> : null}
    </div>
  );
}
