'use strict';

const {
  z, id, optionalId, nullableId, money, positiveMoney, percent, isoDate, optionalDate, requiredText, optionalText,
  optionalEmail, optionalPhone, paymentMethod, listQuery, dateRangeQuery, booleanish, emptyToUndefined,
} = require('./common');

// ---- Products & inventory ------------------------------------------------------------
// Stock is counted to 3 decimal places (2.5 packs, 0.2 of a bottle).
const threeDecimals = (v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6;
const stockQuantity = z.coerce.number().min(0, 'Quantity cannot be negative').max(1_000_000).refine(threeDecimals, 'Use at most 3 decimal places');
const usedQuantity = z.coerce.number().positive('Quantity must be more than 0').max(100_000).refine(threeDecimals, 'Use at most 3 decimal places');
const unitName = z.string().trim().min(1).max(20);

const productBody = z.object({
  name: requiredText(150, 'Product name'),
  sku: z.string().trim().min(1, 'SKU is required').max(60).regex(/^[A-Za-z0-9._\-/]+$/, 'Letters, numbers, - _ . / only'),
  barcode: z.preprocess((v) => (v === '' ? null : v), z.string().trim().max(64).regex(/^[A-Za-z0-9-]+$/, 'Invalid barcode').nullable().optional()),
  categoryId: nullableId,
  supplierId: nullableId,
  description: optionalText(2000),
  unit: unitName.optional().default('pcs'),
  // Used in services in a smaller unit than it is stocked in: "1 bottle = 500 ml".
  usageUnit: z.preprocess((v) => (v === '' ? null : v), unitName.nullable().optional()),
  usagePerUnit: z.preprocess((v) => (v === '' ? null : v), usedQuantity.nullable().optional()),
  purchasePrice: money,
  sellingPrice: money,
  minStock: z.coerce.number().int().min(0).max(1_000_000).optional().default(5),
  maxStock: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().int().min(0).max(1_000_000).nullable().optional()),
  expiryDate: optionalDate,
  status: z.enum(['active', 'inactive', 'discontinued']).optional().default('active'),
  isRetail: z.boolean().optional().default(true),
  openingStock: stockQuantity.optional().default(0),
});

const usageBothOrNeither = (d) => (d.usageUnit === undefined && d.usagePerUnit === undefined) || Boolean(d.usageUnit) === Boolean(d.usagePerUnit);
const usageMessage = { path: ['usagePerUnit'], message: 'Give both the unit used in services and how many are in one stock unit' };

const productUpdate = productBody
  .omit({ openingStock: true })
  .extend({
    unit: unitName.optional(),
    minStock: z.coerce.number().int().min(0).max(1_000_000).optional(),
    status: z.enum(['active', 'inactive', 'discontinued']).optional(),
    isRetail: z.boolean().optional(),
  })
  .partial()
  .refine(usageBothOrNeither, usageMessage);

const productList = listQuery.extend({
  categoryId: optionalId,
  supplierId: optionalId,
  status: z.enum(['active', 'inactive', 'discontinued']).optional(),
  stock: z.enum(['low', 'out', 'in', 'attention']).optional(),
  retail: booleanish.optional(),
  expiring: booleanish.optional(),
});

const stockAdjustment = z.object({
  productId: id,
  type: z.enum(['stock_in', 'stock_out', 'adjustment', 'damage', 'internal_use']),
  quantity: stockQuantity,
  unitCost: z.preprocess(emptyToUndefined, money.optional()),
  reason: requiredText(255, 'Reason'),
}).refine((d) => d.type === 'adjustment' || d.quantity > 0, { path: ['quantity'], message: 'Quantity must be more than 0' });

const transactionQuery = listQuery.merge(dateRangeQuery).extend({
  productId: optionalId,
  type: z.enum(['opening', 'purchase', 'sale', 'refund', 'adjustment', 'stock_in', 'stock_out', 'damage', 'internal_use', 'service_use']).optional(),
});

const categoryBody = z.object({ name: requiredText(80, 'Category name'), description: optionalText(255), isActive: z.boolean().optional() });

// ---- Suppliers & purchases -------------------------------------------------------------
const supplierBody = z.object({
  name: requiredText(150, 'Supplier name'),
  contactPerson: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(255),
  taxNumber: optionalText(50),
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
});

const purchaseBody = z.object({
  supplierId: id,
  supplierInvoiceNo: optionalText(60),
  purchaseDate: isoDate,
  items: z
    .array(z.object({ productId: id, quantity: z.coerce.number().int().positive('Quantity must be at least 1').max(1_000_000), unitCost: money }))
    .min(1, 'Add at least one product')
    .max(200),
  discountAmount: money.optional().default(0),
  taxAmount: money.optional().default(0),
  notes: optionalText(2000),
  receiveNow: z.boolean().optional().default(false),
  initialPayment: z.object({ amount: money, paymentMethod, reference: optionalText(100) }).optional(),
});

const supplierPayment = z.object({
  amount: positiveMoney,
  paymentMethod,
  paymentDate: isoDate,
  reference: optionalText(100),
  notes: optionalText(255),
});

const purchaseList = listQuery.merge(dateRangeQuery).extend({
  supplierId: optionalId,
  status: z.enum(['ordered', 'received', 'cancelled']).optional(),
  paymentStatus: z.enum(['unpaid', 'partial', 'paid']).optional(),
});

// ---- Sales / POS ------------------------------------------------------------------------
// Who performed a service: employeeIds (several people share the commission
// equally), or a single employeeId from older clients.
const staffIds = z.array(id).max(6, 'At most 6 people per service').refine((ids) => new Set(ids).size === ids.length, 'Each person can be chosen once');

// Products actually used on a service, in each product's usage unit. An empty
// list means none were used; leaving it out is refused for services with a recipe.
const consumption = z
  .array(z.object({ productId: id, quantity: usedQuantity }))
  .max(30, 'At most 30 products per service')
  .refine((rows) => new Set(rows.map((r) => r.productId)).size === rows.length, 'List each product once per service');

// `price` is only for services with a price range (priced by length or complexity).
const serviceLine = {
  type: z.literal('service'), serviceId: id, employeeId: optionalId, employeeIds: staffIds.optional(),
  quantity: z.coerce.number().int().min(1).max(20).optional().default(1),
  price: z.preprocess(emptyToUndefined, money.optional()),
  consumption: consumption.optional(),
};

const saleItem = z.discriminatedUnion('type', [
  z.object(serviceLine)
    .refine((item) => item.employeeId || item.employeeIds?.length, { path: ['employeeIds'], message: 'Choose who performed this service' }),
  z.object({ type: z.literal('product'), productId: id, employeeId: optionalId, quantity: z.coerce.number().int().min(1, 'Quantity must be at least 1').max(1000) }),
]);

const salePayment = z.object({ method: paymentMethod, amount: money, reference: optionalText(100) });

// Correcting a completed service: any of price, staff and products used (whose
// unit cost can be corrected too), always with a reason for the audit trail.
const serviceCorrection = z.object({
  price: z.preprocess(emptyToUndefined, money.optional()),
  employeeIds: staffIds.min(1, 'A service needs at least one person who performed it').optional(),
  consumption: z
    .array(z.object({ productId: id, quantity: usedQuantity, unitCost: z.preprocess(emptyToUndefined, money.optional()) }))
    .max(30)
    .refine((rows) => new Set(rows.map((r) => r.productId)).size === rows.length, 'List each product once')
    .optional(),
  reason: requiredText(500, 'Reason'),
}).refine((d) => d.price !== undefined || d.employeeIds || d.consumption, { path: ['reason'], message: 'Change the price, the staff or the products used' });

const serviceReview = z.object({ note: requiredText(500, 'Note') });

// Quotes (live POS preview) accept service lines before a stylist is chosen.
const quoteItem = z.discriminatedUnion('type', [
  z.object(serviceLine),
  z.object({ type: z.literal('product'), productId: id, employeeId: optionalId, quantity: z.coerce.number().int().min(1).max(1000) }),
]);

const saleBody = z.object({
  customerId: optionalId,
  appointmentId: optionalId,
  items: z.array(saleItem).min(1, 'Add at least one service or product').max(100),
  discount: z
    .object({ type: z.enum(['none', 'amount', 'percentage']), value: money.optional().default(0) })
    .refine((d) => d.type !== 'percentage' || d.value <= 100, { path: ['value'], message: 'Percentage cannot exceed 100' })
    .optional(),
  loyaltyPoints: z.coerce.number().int().min(0).max(10_000_000).optional().default(0),
  payments: z.array(salePayment).max(4).optional().default([]),
  notes: optionalText(500),
});

const saleList = listQuery.merge(dateRangeQuery).extend({
  status: z.enum(['completed', 'refunded']).optional(),
  paymentStatus: z.enum(['paid', 'partial', 'unpaid']).optional(),
  method: paymentMethod.optional(),
  cashierId: optionalId,
  customerId: optionalId,
});

// ---- Expenses -------------------------------------------------------------------------------
const expenseBody = z.object({
  categoryId: id,
  expenseDate: isoDate.refine((d) => d <= new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), 'Expense date cannot be in the future'),
  amount: positiveMoney,
  description: requiredText(255, 'Description'),
  paymentMethod: paymentMethod.optional().default('cash'),
  reference: optionalText(100),
  vendor: optionalText(150),
});

const expenseList = listQuery.merge(dateRangeQuery).extend({ categoryId: optionalId, paymentMethod: paymentMethod.optional() });

// ---- Payroll ----------------------------------------------------------------------------------
const payroll = {
  commissionList: listQuery.merge(dateRangeQuery).extend({ employeeId: optionalId, status: z.enum(['earned', 'paid', 'reversed']).optional() }),
  payoutList: listQuery.extend({ employeeId: optionalId, status: z.enum(['pending', 'paid']).optional(), periodStart: isoDate.optional() }),
  generate: z
    .object({ periodStart: isoDate, periodEnd: isoDate, employeeIds: z.array(id).max(500).optional() })
    .refine((d) => d.periodEnd >= d.periodStart, { path: ['periodEnd'], message: 'End date must be after the start date' }),
  update: z.object({ bonus: money.optional(), deductions: money.optional(), notes: optionalText(255) }),
  pay: z.object({ paymentMethod, paidDate: isoDate }),
};

module.exports = {
  productBody: productBody.refine(usageBothOrNeither, usageMessage), productUpdate, productList, stockAdjustment, transactionQuery, categoryBody,
  supplierBody, purchaseBody, supplierPayment, purchaseList,
  saleBody, saleList, salePayment,
  saleQuote: z.object({
    customerId: optionalId,
    items: z.array(quoteItem).min(1).max(100),
    discount: z.object({ type: z.enum(['none', 'amount', 'percentage']), value: money.optional().default(0) }).optional(),
    loyaltyPoints: z.coerce.number().int().min(0).max(10_000_000).optional().default(0),
  }), refund: z.object({ reason: requiredText(255, 'Reason') }),
  serviceCorrection,
  serviceReview,
  saleItemParams: z.object({ id, itemId: id }),
  paymentList: listQuery.merge(dateRangeQuery).extend({ method: paymentMethod.optional(), type: z.enum(['payment', 'refund']).optional() }),
  expenseBody, expenseUpdate: expenseBody.partial(), expenseList,
  payroll, percent,
};
