import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button, ConfirmDialog, Input, Modal, Select, Switch, Textarea, applyServerErrors } from '../../components/ui';
import { formatMoney, getFormatSettings } from '../../utils/format';
import { inventoryApi, useProductCategories, useSupplierOptions } from './api';

const optionalNumber = z.union([z.literal(''), z.coerce.number().int().min(0)]);
const optionalQuantity = z.union([z.literal(''), z.coerce.number().min(0)]);

// Units a salon counts, buys and uses products in. Other units can still be typed.
export const UNITS = ['pcs', 'pack', 'bundle', 'piece', 'bottle', 'tube', 'jar', 'sachet', 'kit', 'box', 'g', 'kg', 'ml', 'l', 'unit'];
const USAGE_UNITS = ['ml', 'g', 'pcs', 'piece', 'strand'];
const schema = z.object({
  name: z.string().trim().min(1, 'Product name is required').max(150),
  sku: z.string().trim().min(1, 'SKU is required').max(60).regex(/^[A-Za-z0-9._\-/]+$/, 'Letters, numbers, - _ . / only'),
  barcode: z.string().trim().max(64).optional(),
  categoryId: z.string().optional(),
  supplierId: z.string().optional(),
  unit: z.string().trim().min(1).max(20),
  usageUnit: z.string().trim().max(20),
  usagePerUnit: z.union([z.literal(''), z.coerce.number().positive('Must be more than 0')]),
  purchasePrice: z.coerce.number({ error: 'Enter a price' }).min(0),
  sellingPrice: z.coerce.number({ error: 'Enter a price' }).min(0),
  minStock: z.coerce.number().int().min(0),
  maxStock: optionalNumber,
  expiryDate: z.string().optional(),
  status: z.enum(['active', 'inactive', 'discontinued']),
  isRetail: z.boolean(),
  openingStock: optionalQuantity,
  description: z.string().max(2000).optional(),
}).refine((v) => !v.usageUnit === (v.usagePerUnit === ''), { path: ['usagePerUnit'], message: 'Give both the unit used and how many are in one' });

function suggestSku(name) {
  const letters = name.toUpperCase().replace(/[^A-Z0-9 ]/g, '').split(/\s+/).filter(Boolean).map((w) => w.slice(0, 3)).slice(0, 3).join('-');
  return letters ? `${letters}-${Math.floor(100 + Math.random() * 900)}` : '';
}

export function ProductFormModal({ open, onClose, product }) {
  const isEdit = Boolean(product);
  const qc = useQueryClient();
  const categories = useProductCategories({ enabled: open });
  const suppliers = useSupplierOptions({ enabled: open });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { register, handleSubmit, reset, control, setValue, getValues, setError, watch, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (!open) return;
    reset({
      name: product?.name || '',
      sku: product?.sku || '',
      barcode: product?.barcode || '',
      categoryId: product?.categoryId ? String(product.categoryId) : '',
      supplierId: product?.supplierId ? String(product.supplierId) : '',
      unit: product?.unit || 'pcs',
      usageUnit: product?.usageUnit || '',
      usagePerUnit: product?.usagePerUnit ?? '',
      purchasePrice: product?.purchasePrice ?? '',
      sellingPrice: product?.sellingPrice ?? '',
      minStock: product?.minStock ?? 5,
      maxStock: product?.maxStock ?? '',
      expiryDate: product?.expiryDate || '',
      status: product?.status || 'active',
      isRetail: product ? product.isRetail : true,
      openingStock: '',
      description: product?.description || '',
    });
  }, [open, product, reset]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['inventory'] });
  };

  const onSubmit = handleSubmit(async (values) => {
    const body = {
      ...values,
      barcode: values.barcode || null,
      categoryId: values.categoryId ? Number(values.categoryId) : null,
      supplierId: values.supplierId ? Number(values.supplierId) : null,
      maxStock: values.maxStock === '' ? null : values.maxStock,
      usageUnit: values.usageUnit || null,
      usagePerUnit: values.usagePerUnit === '' ? null : values.usagePerUnit,
      expiryDate: values.expiryDate || null,
      description: values.description || null,
      ...(isEdit ? {} : { openingStock: values.openingStock === '' ? 0 : values.openingStock }),
    };
    if (isEdit) delete body.openingStock;
    try {
      const res = isEdit ? await inventoryApi.updateProduct(product.id, body) : await inventoryApi.createProduct(body);
      toast.success(res.message);
      refresh();
      onClose();
    } catch (error) {
      if (!applyServerErrors(error, setError)) toast.error(error.message);
    }
  });

  const currency = getFormatSettings().currency;
  const [unit, usageUnit, usagePerUnit, purchasePrice] = watch(['unit', 'usageUnit', 'usagePerUnit', 'purchasePrice']);
  const costPerUse = usageUnit && Number(usagePerUnit) > 0 && Number(purchasePrice) >= 0 ? Number(purchasePrice) / Number(usagePerUnit) : null;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        size="lg"
        title={isEdit ? 'Edit product' : 'New product'}
        description={isEdit ? `${product.sku} · ${product.quantity} ${product.unit} in stock (change stock with “Adjust stock”)` : 'Products are stocked per branch.'}
        footer={
          <>
            {isEdit ? <Button variant="danger-ghost" className="sm:mr-auto" onClick={() => setConfirmDelete(true)}>Delete</Button> : null}
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={onSubmit} loading={isSubmitting}>{isEdit ? 'Save changes' : 'Create product'}</Button>
          </>
        }
      >
        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Product name"
            required
            className="sm:col-span-2"
            error={errors.name?.message}
            {...register('name', { onBlur: () => !isEdit && !getValues('sku') && setValue('sku', suggestSku(getValues('name'))) })}
          />
          <Input label="SKU" required error={errors.sku?.message} {...register('sku')} />
          <Input label="Barcode" hint="Scan into this field" error={errors.barcode?.message} {...register('barcode')} />
          <Select label="Category" placeholder="No category" options={(categories.data || []).map((c) => ({ value: String(c.id), label: c.name }))} {...register('categoryId')} />
          <Select label="Supplier" placeholder="No supplier" options={(suppliers.data || []).map((s) => ({ value: String(s.id), label: s.name }))} {...register('supplierId')} />
          <Input label={`Purchase price (${currency})`} required type="number" min="0" step="any" error={errors.purchasePrice?.message} {...register('purchasePrice')} />
          <Input label={`Selling price (${currency})`} required type="number" min="0" step="any" error={errors.sellingPrice?.message} {...register('sellingPrice')} />
          <Input label="Stock unit" list="product-units" placeholder="pcs, pack, bottle…" hint="How the product is counted and bought" error={errors.unit?.message} {...register('unit')} />
          <datalist id="product-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist>
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-line p-3 sm:col-span-2">
            <p className="col-span-2 text-xs text-muted">
              Used in services in a smaller unit? E.g. jelly bought by the bottle but used by the ml. Leave blank if services use whole {unit || 'units'}.
            </p>
            <Input label="Used in services by" list="usage-units" placeholder="ml, g…" error={errors.usageUnit?.message} {...register('usageUnit')} />
            <datalist id="usage-units">{USAGE_UNITS.map((u) => <option key={u} value={u} />)}</datalist>
            <Input label={`How many in one ${unit || 'unit'}`} type="number" min="0" step="any" placeholder="500" error={errors.usagePerUnit?.message} {...register('usagePerUnit')} />
            {costPerUse !== null ? (
              <p className="col-span-2 text-xs text-muted">
                1 {unit} = {usagePerUnit} {usageUnit}, so services are costed at {formatMoney(costPerUse, { maxDecimals: 2 })} per {usageUnit}.
              </p>
            ) : null}
          </div>
          <Input label="Expiry date" type="date" {...register('expiryDate')} />
          <Input label="Minimum stock" type="number" min="0" hint="Low-stock alert at or below this" error={errors.minStock?.message} {...register('minStock')} />
          <Input label="Maximum stock" type="number" min="0" error={errors.maxStock?.message} {...register('maxStock')} />
          {!isEdit ? <Input label="Opening stock" type="number" min="0" step="any" hint={`${unit || 'Units'} on hand right now`} error={errors.openingStock?.message} {...register('openingStock')} /> : null}
          <Select
            label="Status"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Inactive' },
              { value: 'discontinued', label: 'Discontinued' },
            ]}
            {...register('status')}
          />
          <Controller control={control} name="isRetail" render={({ field }) => <Switch className="sm:col-span-2" label="Sold at the POS" description="Turn off for salon-use supplies (hair, jelly, towels, chemicals). Both kinds can be recorded as used on services." checked={field.value} onChange={field.onChange} />} />
          <Textarea label="Description" rows={2} className="sm:col-span-2" {...register('description')} />
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        danger
        title={`Delete ${product?.name}?`}
        message="Products with sales or purchase history are marked discontinued instead of deleted."
        confirmLabel="Delete product"
        onConfirm={async () => {
          try {
            const res = await inventoryApi.deleteProduct(product.id);
            toast.success(res.message);
            refresh();
            setConfirmDelete(false);
            onClose();
          } catch (e) {
            toast.error(e.message);
          }
        }}
      />
    </>
  );
}
