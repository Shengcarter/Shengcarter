import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowDownUp, Boxes, Layers, Package, PackageX, Pencil, Plus, Wallet } from 'lucide-react';
import {
  Badge, Button, Card, DataTable, DateRange, Detail, Drawer, EmptyState, FilterGroup, FilterSelect, IconButton, PageHeader, Pagination, SearchInput, SkeletonRows, StatCard, Tabs,
} from '../../components/ui';
import { ChartCard } from '../../components/charts/ChartCard';
import { RankedBarChart } from '../../components/charts/Charts';
import { CategoryManagerModal } from '../../components/CategoryManagerModal';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '../../utils/format';
import { cn } from '../../utils/cn';
import { usePermission, useDocumentTitle } from '../../hooks';
import { MOVEMENT_LABELS, inventoryApi, useProduct, useProductCategories, useProductList, useStockTransactions, useValuation } from './api';
import { ProductFormModal } from './ProductFormModal';
import { AdjustStockModal } from './AdjustStockModal';

function StockBadge({ product }) {
  if (product.quantity === 0) return <Badge tone="danger" dot>Out of stock</Badge>;
  if (product.isLowStock) return <Badge tone="warning" dot>Low stock</Badge>;
  return <Badge tone="success" dot>In stock</Badge>;
}

function ProductDrawer({ productId, onClose, onEdit, onAdjust }) {
  const can = usePermission();
  const product = useProduct(productId);
  const p = product.data;
  return (
    <Drawer
      open={Boolean(productId)}
      onClose={onClose}
      title={p?.name || 'Product'}
      footer={can('inventory.manage') && p ? (
        <>
          <Button variant="secondary" icon={Pencil} onClick={() => onEdit(p)}>Edit</Button>
          <Button icon={ArrowDownUp} onClick={() => onAdjust(p)}>Adjust stock</Button>
        </>
      ) : null}
    >
      {product.isPending ? <SkeletonRows rows={6} /> : p ? (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="text-4xl font-semibold">{formatNumber(p.quantity)}</div>
            <div className="text-sm text-muted">{p.unit} in stock<br />minimum {p.minStock}{p.maxStock ? ` · maximum ${p.maxStock}` : ''}</div>
            <div className="ml-auto"><StockBadge product={p} /></div>
          </div>
          <dl className="grid grid-cols-2 gap-4">
            <Detail label="SKU">{p.sku}</Detail>
            <Detail label="Barcode">{p.barcode || '—'}</Detail>
            <Detail label="Category">{p.categoryName || '—'}</Detail>
            <Detail label="Supplier">{p.supplierName || '—'}</Detail>
            <Detail label="Purchase price">{formatMoney(p.purchasePrice)}</Detail>
            <Detail label="Selling price">{formatMoney(p.sellingPrice)}</Detail>
            <Detail label="Margin">{p.sellingPrice > 0 ? `${(((p.sellingPrice - p.purchasePrice) / p.sellingPrice) * 100).toFixed(1)}%` : '—'}</Detail>
            <Detail label="Expiry">{p.expiryDate ? formatDate(p.expiryDate) : '—'}</Detail>
            <Detail label="Sold (30 days)">{formatNumber(p.last30Days.unitsSold)} {p.unit}</Detail>
            <Detail label="Revenue (30 days)">{formatMoney(p.last30Days.revenue)}</Detail>
            <Detail label="Sold at POS">{p.isRetail ? 'Yes' : 'No (salon use)'}</Detail>
            <Detail label="Status">{p.status}</Detail>
          </dl>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Recent stock movements</h3>
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {p.recentMovements.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block font-medium">{MOVEMENT_LABELS[m.type]}</span>
                    <span className="block truncate text-xs text-muted">{formatDateTime(m.createdAt)}{m.createdByName ? ` · ${m.createdByName}` : ''}{m.reason ? ` · ${m.reason}` : ''}</span>
                  </span>
                  <span className="text-right">
                    <span className={cn('block font-semibold tabular-nums', m.quantityChange > 0 ? 'text-success' : 'text-danger')}>{m.quantityChange > 0 ? '+' : ''}{m.quantityChange}</span>
                    <span className="block text-xs text-muted tabular-nums">{m.quantityBefore} → {m.quantityAfter}</span>
                  </span>
                </li>
              ))}
              {!p.recentMovements.length ? <li className="px-4 py-3 text-sm text-muted">No movements yet.</li> : null}
            </ul>
          </div>
        </div>
      ) : null}
    </Drawer>
  );
}

function ProductsTab({ onOpen, onEdit, onAdjust }) {
  const can = usePermission();
  const categories = useProductCategories();
  const valuation = useValuation();
  const [params, setParams] = useState({ page: 1, limit: 25, search: '', categoryId: '', stock: '', sortBy: 'name', sortOrder: 'asc' });
  const products = useProductList(params);
  const set = (patch) => setParams((p) => ({ ...p, page: 1, ...patch }));
  const t = valuation.data?.totals;

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Products" icon={Package} value={formatNumber(t?.products)} loading={valuation.isPending} caption={`${formatNumber(t?.units)} units on hand`} />
        <StatCard label="Low stock" icon={AlertTriangle} tone="warning" value={formatNumber(t?.lowStock)} loading={valuation.isPending} onClick={() => set({ stock: 'low' })} />
        <StatCard label="Out of stock" icon={PackageX} tone="danger" value={formatNumber(t?.outOfStock)} loading={valuation.isPending} onClick={() => set({ stock: 'out' })} />
        <StatCard label="Stock value (cost)" icon={Wallet} value={formatMoney(t?.costValue)} loading={valuation.isPending} caption={`${formatMoney(t?.retailValue)} at retail`} />
      </div>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
          <SearchInput placeholder="Name, SKU or barcode…" className="w-full sm:w-72" onChange={(search) => set({ search })} />
          <FilterGroup>
            <FilterSelect label="Category" value={params.categoryId} onChange={(categoryId) => set({ categoryId })}>
              <option value="">All categories</option>
              {(categories.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FilterSelect>
            <FilterSelect label="Stock level" value={params.stock} onChange={(stock) => set({ stock })}>
              <option value="">Any stock level</option>
              <option value="attention">Needs attention</option>
              <option value="low">Low stock</option>
              <option value="out">Out of stock</option>
              <option value="in">In stock</option>
            </FilterSelect>
          </FilterGroup>
        </div>
        <DataTable
          rows={products.data?.data}
          loading={products.isPending}
          error={products.error}
          onRetry={products.refetch}
          onRowClick={(p) => onOpen(p.id)}
          sort={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
          onSortChange={(sort) => set(sort)}
          empty={<EmptyState icon={Boxes} title="No products found" description={params.search || params.stock ? 'Try another filter.' : 'Add the products you sell and use.'} />}
          columns={[
            { key: 'name', header: 'Product', sortable: true, primary: true, render: (p) => <div><p className="font-medium">{p.name}</p><p className="text-xs text-muted">{p.sku}{p.categoryName ? ` · ${p.categoryName}` : ''}{!p.isRetail ? ' · salon use' : ''}</p></div> },
            { key: 'quantity', header: 'Stock', sortable: true, align: 'right', render: (p) => <span className={cn('font-semibold', p.quantity === 0 ? 'text-danger' : p.isLowStock ? 'text-warning' : '')}>{formatNumber(p.quantity)} <span className="text-xs font-normal text-muted">{p.unit}</span></span> },
            { key: 'status', header: 'Level', render: (p) => <StockBadge product={p} /> },
            { key: 'purchasePrice', header: 'Cost', align: 'right', hideOnMobile: true, render: (p) => formatMoney(p.purchasePrice) },
            { key: 'sellingPrice', header: 'Price', sortable: true, align: 'right', render: (p) => (p.isRetail ? formatMoney(p.sellingPrice) : '—') },
            { key: 'expiryDate', header: 'Expiry', sortable: true, hideOnMobile: true, render: (p) => (p.expiryDate ? formatDate(p.expiryDate) : '—') },
            {
              key: 'actions',
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              render: (p) => (can('inventory.manage') ? (
                <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                  <IconButton icon={ArrowDownUp} size="sm" label={`Adjust stock of ${p.name}`} onClick={() => onAdjust(p)} />
                  <IconButton icon={Pencil} size="sm" label={`Edit ${p.name}`} onClick={() => onEdit(p)} />
                </div>
              ) : null),
            },
          ]}
        />
        <Pagination pagination={products.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
      </Card>
    </>
  );
}

function MovementsTab() {
  const [params, setParams] = useState({ page: 1, limit: 25, type: '', from: '', to: '' });
  const tx = useStockTransactions(params);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4">
        <FilterSelect label="Movement type" className="w-full sm:w-auto" value={params.type} onChange={(type) => setParams((p) => ({ ...p, type, page: 1 }))}>
          <option value="">All movements</option>
          {Object.entries(MOVEMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </FilterSelect>
        <DateRange from={params.from} to={params.to} onChange={(range) => setParams((p) => ({ ...p, ...range, page: 1 }))} />
      </div>
      <DataTable
        rows={tx.data?.data}
        loading={tx.isPending}
        error={tx.error}
        onRetry={tx.refetch}
        empty={<EmptyState icon={ArrowDownUp} title="No stock movements" />}
        columns={[
          { key: 'createdAt', header: 'When', render: (m) => <span className="whitespace-nowrap">{formatDateTime(m.createdAt)}</span> },
          { key: 'productName', header: 'Product', primary: true, render: (m) => <div><p className="font-medium">{m.productName}</p><p className="text-xs text-muted">{m.sku}</p></div> },
          { key: 'type', header: 'Movement', render: (m) => MOVEMENT_LABELS[m.type] },
          { key: 'quantityChange', header: 'Change', align: 'right', render: (m) => <span className={cn('font-semibold', m.quantityChange > 0 ? 'text-success' : 'text-danger')}>{m.quantityChange > 0 ? '+' : ''}{m.quantityChange}</span> },
          { key: 'balance', header: 'Stock', align: 'right', render: (m) => `${m.quantityBefore} → ${m.quantityAfter}` },
          { key: 'reference', header: 'Reference', hideOnMobile: true, render: (m) => m.referenceCode || m.reason || '—' },
          { key: 'createdByName', header: 'By', hideOnMobile: true, render: (m) => m.createdByName || '—' },
        ]}
      />
      <Pagination pagination={tx.data?.pagination} onPageChange={(page) => setParams((p) => ({ ...p, page }))} />
    </Card>
  );
}

function ValuationTab() {
  const valuation = useValuation();
  const rows = valuation.data?.categories || [];
  return (
    <ChartCard
      title="Stock value by category"
      description={valuation.data ? `Total at cost ${formatMoney(valuation.data.totals.costValue)} · at retail ${formatMoney(valuation.data.totals.retailValue)}` : undefined}
      loading={valuation.isPending}
      error={valuation.error}
      onRetry={valuation.refetch}
      isEmpty={!rows.length}
      height={Math.max(220, rows.length * 44)}
      table={{
        columns: [
          { key: 'category', header: 'Category' },
          { key: 'products', header: 'Products', align: 'right' },
          { key: 'units', header: 'Units', align: 'right', format: (v) => formatNumber(v) },
          { key: 'costValue', header: 'Value at cost', align: 'right', format: (v) => formatMoney(v) },
          { key: 'retailValue', header: 'Value at retail', align: 'right', format: (v) => formatMoney(v) },
        ],
        rows,
      }}
    >
      <RankedBarChart data={rows} nameKey="category" valueKey="costValue" label="Value at cost" formatValue={(v) => formatMoney(v, { compact: true })} />
    </ChartCard>
  );
}

export default function InventoryPage() {
  useDocumentTitle('Inventory');
  const can = usePermission();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState('products');
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState({ open: false, product: null });
  const [adjusting, setAdjusting] = useState(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const categories = useProductCategories({ enabled: categoriesOpen });

  // Deep links from global search and low-stock notifications: /inventory?product=12
  useEffect(() => {
    const id = Number(params.get('product'));
    if (id) {
      setOpenId(id);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Products, stock levels and the full stock movement history."
        actions={can('inventory.manage') ? (
          <>
            <Button variant="secondary" icon={Layers} onClick={() => setCategoriesOpen(true)}>Categories</Button>
            <Button icon={Plus} onClick={() => setEditing({ open: true, product: null })}>New product</Button>
          </>
        ) : null}
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'products', label: 'Products' },
          { value: 'movements', label: 'Stock movements' },
          { value: 'valuation', label: 'Valuation' },
        ]}
      />
      {tab === 'products' ? <ProductsTab onOpen={setOpenId} onEdit={(p) => setEditing({ open: true, product: p })} onAdjust={setAdjusting} /> : null}
      {tab === 'movements' ? <MovementsTab /> : null}
      {tab === 'valuation' ? <ValuationTab /> : null}

      <ProductDrawer productId={openId} onClose={() => setOpenId(null)} onEdit={(p) => { setOpenId(null); setEditing({ open: true, product: p }); }} onAdjust={(p) => { setOpenId(null); setAdjusting(p); }} />
      <ProductFormModal open={editing.open} product={editing.product} onClose={() => setEditing({ open: false, product: null })} />
      <AdjustStockModal product={adjusting} onClose={() => setAdjusting(null)} />
      <CategoryManagerModal
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        title="Product categories"
        query={categories}
        countOf={(c) => `${c.productCount} products`}
        onCreate={(name) => inventoryApi.createCategory({ name })}
        onRename={(id, name) => inventoryApi.updateCategory(id, { name })}
        onDelete={(id) => inventoryApi.deleteCategory(id)}
        onChanged={() => qc.invalidateQueries({ queryKey: ['product-categories'] })}
      />
    </div>
  );
}
