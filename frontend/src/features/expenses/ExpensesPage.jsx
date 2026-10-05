import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Layers, Paperclip, Plus, Receipt, Trash2, Wallet } from 'lucide-react';
import {
  Badge, Button, Card, ConfirmDialog, DataTable, DateRange, EmptyState, FilterGroup, FilterSelect, Input, Modal, PageHeader, Pagination, SearchInput, Select, StatCard, Textarea, applyServerErrors,
} from '../../components/ui';
import { ChartCard } from '../../components/charts/ChartCard';
import { RankedBarChart } from '../../components/charts/Charts';
import { CategoryManagerModal } from '../../components/CategoryManagerModal';
import { http, openFile } from '../../api/client';
import { formatDate, formatMoney, formatNumber, getFormatSettings, titleCase, todayISO } from '../../utils/format';
import { usePermission, useDocumentTitle } from '../../hooks';
import { PAYMENT_METHODS } from '../pos/api';

const clean = (p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v !== undefined));

function useExpenseCategories(enabled = true) {
  return useQuery({ queryKey: ['expense-categories'], queryFn: () => http.get('/expenses/categories').then((r) => r.data), enabled, staleTime: 60_000 });
}

function ExpenseForm({ open, onClose, expense }) {
  const qc = useQueryClient();
  const categories = useExpenseCategories(open);
  const fileRef = useRef(null);
  const [file, setFile] = useState(null);
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm();

  useEffect(() => {
    if (!open) return;
    setFile(null);
    reset({
      categoryId: expense?.categoryId ? String(expense.categoryId) : '',
      expenseDate: expense?.expenseDate || todayISO(),
      amount: expense?.amount ?? '',
      description: expense?.description || '',
      paymentMethod: expense?.paymentMethod || 'cash',
      vendor: expense?.vendor || '',
      reference: expense?.reference || '',
    });
  }, [open, expense, reset]);

  const onSubmit = handleSubmit(async (values) => {
    const body = { ...values, categoryId: Number(values.categoryId), amount: Number(values.amount), vendor: values.vendor || null, reference: values.reference || null };
    try {
      const res = expense ? await http.patch(`/expenses/${expense.id}`, body) : await http.post('/expenses', body);
      if (file) await http.upload(`/expenses/${res.data.id}/attachment`, 'attachment', file);
      toast.success(res.message);
      qc.invalidateQueries({ queryKey: ['expenses'] });
      onClose();
    } catch (e) {
      if (!applyServerErrors(e, setError)) toast.error(e.errors?.[0]?.message || e.message);
    }
  });

  return (
    <Modal open={open} onClose={onClose} title={expense ? 'Edit expense' : 'Record expense'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={onSubmit} loading={isSubmitting}>{expense ? 'Save changes' : 'Record expense'}</Button></>}>
      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        <Select label="Category" required placeholder="Choose category" options={(categories.data || []).filter((c) => c.isActive).map((c) => ({ value: String(c.id), label: c.name }))} error={errors.categoryId?.message} {...register('categoryId', { required: 'Choose a category' })} />
        <Input label="Date" type="date" required max={todayISO()} error={errors.expenseDate?.message} {...register('expenseDate')} />
        <Input label={`Amount (${getFormatSettings().currency})`} required type="number" min="0" step="any" error={errors.amount?.message} {...register('amount', { required: 'Enter the amount' })} />
        <Select label="Paid with" options={PAYMENT_METHODS} {...register('paymentMethod')} />
        <Textarea label="Description" required rows={2} className="sm:col-span-2" error={errors.description?.message} {...register('description', { required: 'Describe the expense' })} />
        <Input label="Paid to (vendor)" error={errors.vendor?.message} {...register('vendor')} />
        <Input label="Reference / receipt no." error={errors.reference?.message} {...register('reference')} />
        <div className="sm:col-span-2">
          <p className="mb-1.5 text-sm font-medium">Receipt (optional)</p>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          <Button variant="secondary" size="sm" icon={Paperclip} onClick={() => fileRef.current?.click()}>{file ? file.name : expense?.attachment ? 'Replace receipt' : 'Attach image or PDF'}</Button>
        </div>
      </form>
    </Modal>
  );
}

export default function ExpensesPage() {
  useDocumentTitle('Expenses');
  const can = usePermission();
  const qc = useQueryClient();
  const [params, setParams] = useState({ page: 1, limit: 20, search: '', from: todayISO().slice(0, 8) + '01', to: todayISO(), categoryId: '', paymentMethod: '' });
  const expenses = useQuery({ queryKey: ['expenses', clean(params)], queryFn: () => http.get('/expenses', clean(params)), placeholderData: (p) => p });
  const categories = useExpenseCategories();
  const [form, setForm] = useState({ open: false, expense: null });
  const [deleting, setDeleting] = useState(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const set = (patch) => setParams((p) => ({ ...p, page: 1, ...patch }));
  const summary = expenses.data?.summary;
  const byCategory = summary?.byCategory || [];

  return (
    <div>
      <PageHeader
        title="Expenses"
        description="Rent, utilities, supplies, staff commission payouts and every other cost of running the salon."
        actions={can('expenses.manage') ? (
          <>
            <Button variant="secondary" icon={Layers} onClick={() => setCategoriesOpen(true)}>Categories</Button>
            <Button icon={Plus} onClick={() => setForm({ open: true, expense: null })}>Record expense</Button>
          </>
        ) : null}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <DateRange from={params.from} to={params.to} onChange={set} />
        <FilterGroup>
          <FilterSelect label="Category" value={params.categoryId} onChange={(categoryId) => set({ categoryId })}>
            <option value="">All categories</option>
            {(categories.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </FilterSelect>
          <FilterSelect label="Payment method" value={params.paymentMethod} onChange={(paymentMethod) => set({ paymentMethod })}>
            <option value="">Any method</option>
            {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </FilterSelect>
        </FilterGroup>
      </div>

      <div className="mb-5 grid gap-5 lg:grid-cols-[18rem_1fr]">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-1">
          <StatCard label="Total expenses" icon={Wallet} value={formatMoney(summary?.total)} loading={expenses.isPending} caption={`${formatDate(params.from)} – ${formatDate(params.to)}`} />
          <StatCard label="Entries" icon={Receipt} value={formatNumber(summary?.count)} loading={expenses.isPending} caption={byCategory[0] ? `Largest: ${byCategory[0].category}` : undefined} />
        </div>
        <ChartCard
          title="Expenses by category"
          loading={expenses.isPending}
          fetching={expenses.isFetching}
          isEmpty={!byCategory.length}
          height={Math.max(180, byCategory.length * 40)}
          table={{ columns: [{ key: 'category', header: 'Category' }, { key: 'total', header: 'Total', align: 'right', format: (v) => formatMoney(v) }], rows: byCategory }}
        >
          <RankedBarChart data={byCategory} nameKey="category" valueKey="total" label="Total" formatValue={(v) => formatMoney(v, { compact: true })} />
        </ChartCard>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-line p-4">
          <SearchInput placeholder="Search expenses…" className="sm:w-80" onChange={(search) => set({ search })} />
        </div>
        <DataTable
          rows={expenses.data?.data}
          loading={expenses.isPending}
          error={expenses.error}
          onRetry={expenses.refetch}
          onRowClick={can('expenses.manage') ? (e) => (e.payoutId ? toast.info('Commission payouts are managed from Employees → Commission payouts') : setForm({ open: true, expense: e })) : undefined}
          empty={<EmptyState icon={Wallet} title="No expenses recorded" description="Record rent, bills and purchases to see true profit." action={can('expenses.manage') ? <Button icon={Plus} onClick={() => setForm({ open: true, expense: null })}>Record expense</Button> : null} />}
          columns={[
            { key: 'expenseDate', header: 'Date', render: (e) => formatDate(e.expenseDate) },
            { key: 'description', header: 'Description', primary: true, render: (e) => <div><p className="font-medium">{e.description}</p><p className="text-xs text-muted">{e.vendor || e.recordedByName}</p></div> },
            { key: 'categoryName', header: 'Category', render: (e) => <Badge>{e.categoryName}</Badge> },
            { key: 'paymentMethod', header: 'Paid with', hideOnMobile: true, render: (e) => titleCase(e.paymentMethod) },
            { key: 'attachment', header: 'Receipt', hideOnMobile: true, render: (e) => (e.attachment ? (
              // Receipts are private: fetched with the signed-in user's access, then shown.
              <button
                type="button"
                onClick={(ev) => {
                  ev.stopPropagation();
                  openFile(`/expenses/${e.id}/attachment`).catch((err) => toast.error(err.message));
                }}
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <Paperclip className="size-3.5" />View
              </button>
            ) : '—') },
            { key: 'amount', header: 'Amount', align: 'right', render: (e) => <span className="font-medium">{formatMoney(e.amount)}</span> },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (e) => (can('expenses.manage') && !e.payoutId ? (
                <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-red-500/10 hover:text-danger" onClick={(ev) => { ev.stopPropagation(); setDeleting(e); }} aria-label="Delete expense"><Trash2 className="size-4" /></button>
              ) : null),
            },
          ]}
        />
        <Pagination pagination={expenses.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
      </Card>

      <ExpenseForm open={form.open} expense={form.expense} onClose={() => setForm({ open: false, expense: null })} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        danger
        title="Delete this expense?"
        message={deleting ? `${deleting.description} — ${formatMoney(deleting.amount)}` : ''}
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await http.delete(`/expenses/${deleting.id}`);
            toast.success('Expense deleted');
            qc.invalidateQueries({ queryKey: ['expenses'] });
          } catch (e) {
            toast.error(e.message);
          }
          setDeleting(null);
        }}
      />
      <CategoryManagerModal
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        title="Expense categories"
        query={categories}
        countOf={(c) => `${c.expenseCount} entries`}
        onCreate={(name) => http.post('/expenses/categories', { name })}
        onRename={(id, name) => http.patch(`/expenses/categories/${id}`, { name })}
        onDelete={(id) => http.delete(`/expenses/categories/${id}`)}
        onChanged={() => qc.invalidateQueries({ queryKey: ['expense-categories'] })}
      />
    </div>
  );
}
