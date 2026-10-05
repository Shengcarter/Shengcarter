'use strict';

const fs = require('fs');
const path = require('path');
const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/auth');
const { singleUpload, removeUploadedFile, resolveUploadedFile } = require('../middleware/upload');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated, sendPaginated } = require('../utils/response');
const { idParam, booleanish } = require('../validators/common');
const { localDateRange } = require('../utils/time');
const v = require('../validators/commerceValidators');
const sales = require('../controllers/salesController');
const inventoryService = require('../services/inventoryService');
const supplierService = require('../services/supplierService');
const expenseService = require('../services/expenseService');
const payrollService = require('../services/payrollService');

/*
 * Small modules keep their handlers next to the routes (each handler only
 * validates, calls one service function and responds). Larger modules such
 * as sales have their own controller file.
 */

// ---- /api/products & /api/inventory -------------------------------------------------------
const productRouter = Router();
const invView = requirePermission('inventory.view', 'pos.create', 'purchases.manage');
const invManage = requirePermission('inventory.manage');

productRouter.get('/', invView, validate({ query: v.productList }), async (req, res) => {
  sendPaginated(res, await inventoryService.list({ ...req.validQuery, branchId: req.ctx.branchId }));
});
// Products that can be recorded as used on a service (by the till, stylists and whoever edits recipes).
productRouter.get('/usable', requirePermission('inventory.view', 'pos.create', 'appointments.record_products', 'services.manage'), async (req, res) => {
  sendSuccess(res, await inventoryService.usableProducts(req.ctx));
});
productRouter.post('/', invManage, validate({ body: v.productBody }), async (req, res) => {
  sendCreated(res, await inventoryService.createProduct(req.body, req.ctx), 'Product created successfully');
});
productRouter.get('/:id', invView, validate({ params: idParam }), async (req, res) => {
  sendSuccess(res, await inventoryService.getProductDetail(req.params.id, req.ctx));
});
productRouter.patch('/:id', invManage, validate({ params: idParam, body: v.productUpdate }), async (req, res) => {
  sendSuccess(res, await inventoryService.updateProduct(req.params.id, req.body, req.ctx), 'Product updated successfully');
});
productRouter.delete('/:id', invManage, validate({ params: idParam }), async (req, res) => {
  const result = await inventoryService.deleteProduct(req.params.id, req.ctx);
  sendSuccess(res, result, result.archived ? 'Product has history, so it was discontinued instead of deleted' : 'Product deleted');
});

const inventoryRouter = Router();
inventoryRouter.post('/adjust', invManage, validate({ body: v.stockAdjustment }), async (req, res) => {
  const result = await inventoryService.adjust(req.body, req.ctx);
  sendSuccess(res, result, `Stock updated: ${result.before} → ${result.after}`);
});
inventoryRouter.get('/transactions', requirePermission('inventory.view'), validate({ query: v.transactionQuery }), async (req, res) => {
  const q = { ...req.validQuery };
  if (q.from || q.to) Object.assign(q, (({ start, end }) => ({ start, end }))(localDateRange(q.from || '2000-01-01', q.to || '2999-12-31')));
  sendPaginated(res, await inventoryService.listTransactions(q, req.ctx));
});
inventoryRouter.get('/valuation', requirePermission('inventory.view'), async (req, res) => {
  sendSuccess(res, await inventoryService.valuation(req.ctx));
});

const productCategoryRouter = Router();
productCategoryRouter.get('/', invView, async (_req, res) => sendSuccess(res, await inventoryService.listCategories()));
productCategoryRouter.post('/', invManage, validate({ body: v.categoryBody }), async (req, res) => {
  sendCreated(res, await inventoryService.saveCategory(null, req.body, req.ctx), 'Category created');
});
productCategoryRouter.patch('/:id', invManage, validate({ params: idParam, body: v.categoryBody }), async (req, res) => {
  sendSuccess(res, await inventoryService.saveCategory(req.params.id, req.body, req.ctx), 'Category updated');
});
productCategoryRouter.delete('/:id', invManage, validate({ params: idParam }), async (req, res) => {
  await inventoryService.deleteCategory(req.params.id, req.ctx);
  sendSuccess(res, null, 'Category deleted');
});

// ---- /api/suppliers & /api/purchases --------------------------------------------------------
const supplierRouter = Router();
supplierRouter.get('/', requirePermission('suppliers.view', 'purchases.view', 'inventory.manage'), validate({ query: z.object({
  search: z.string().max(100).optional(), status: z.enum(['active', 'inactive']).optional(), withBalance: booleanish.optional(),
  page: z.coerce.number().optional(), limit: z.coerce.number().optional(), sortBy: z.string().optional(), sortOrder: z.enum(['asc', 'desc']).optional(),
}) }), async (req, res) => sendPaginated(res, await supplierService.list(req.validQuery)));
supplierRouter.post('/', requirePermission('suppliers.manage'), validate({ body: v.supplierBody }), async (req, res) => {
  sendCreated(res, await supplierService.save(null, req.body, req.ctx), 'Supplier created successfully');
});
supplierRouter.get('/:id', requirePermission('suppliers.view'), validate({ params: idParam }), async (req, res) => {
  sendSuccess(res, await supplierService.getDetail(req.params.id));
});
supplierRouter.patch('/:id', requirePermission('suppliers.manage'), validate({ params: idParam, body: v.supplierBody.partial() }), async (req, res) => {
  sendSuccess(res, await supplierService.save(req.params.id, req.body, req.ctx), 'Supplier updated successfully');
});
supplierRouter.delete('/:id', requirePermission('suppliers.manage'), validate({ params: idParam }), async (req, res) => {
  const result = await supplierService.remove(req.params.id, req.ctx);
  sendSuccess(res, result, result.archived ? 'Supplier has purchases, so it was deactivated' : 'Supplier deleted');
});

const purchaseRouter = Router();
purchaseRouter.get('/', requirePermission('purchases.view'), validate({ query: v.purchaseList }), async (req, res) => {
  sendPaginated(res, await supplierService.listPurchases(req.validQuery, req.ctx));
});
purchaseRouter.post('/', requirePermission('purchases.manage'), validate({ body: v.purchaseBody }), async (req, res) => {
  const purchase = await supplierService.createPurchase(req.body, req.ctx);
  sendCreated(res, purchase, `Purchase ${purchase.code} created${purchase.status === 'received' ? ' and stock received' : ''}`);
});
purchaseRouter.get('/:id', requirePermission('purchases.view'), validate({ params: idParam }), async (req, res) => {
  sendSuccess(res, await supplierService.getPurchase(req.params.id, req.ctx));
});
purchaseRouter.post('/:id/receive', requirePermission('purchases.manage'), validate({ params: idParam }), async (req, res) => {
  sendSuccess(res, await supplierService.receivePurchase(req.params.id, req.ctx), 'Stock received and added to inventory');
});
purchaseRouter.post('/:id/cancel', requirePermission('purchases.manage'), validate({ params: idParam }), async (req, res) => {
  sendSuccess(res, await supplierService.cancelPurchase(req.params.id, req.ctx), 'Purchase cancelled');
});
purchaseRouter.post('/:id/payments', requirePermission('suppliers.manage', 'purchases.manage'), validate({ params: idParam, body: v.supplierPayment }), async (req, res) => {
  sendSuccess(res, await supplierService.recordPayment(req.params.id, req.body, req.ctx), 'Supplier payment recorded');
});

// ---- /api/sales & /api/payments ---------------------------------------------------------------
const saleRouter = Router();
saleRouter.post('/', requirePermission('pos.create'), validate({ body: v.saleBody }), sales.create);
saleRouter.post('/quote', requirePermission('pos.create'), validate({ body: v.saleQuote }), sales.quote);
saleRouter.get('/', requirePermission('sales.view'), validate({ query: v.saleList }), sales.list);
saleRouter.get('/appointment/:id', requirePermission('pos.create'), validate({ params: idParam }), sales.appointmentCheckout);
saleRouter.get('/:id', requirePermission('sales.view', 'pos.create'), validate({ params: idParam }), sales.get);
saleRouter.get(
  '/:id/document',
  requirePermission('sales.view', 'pos.create'),
  validate({ params: idParam, query: z.object({ format: z.enum(['a4', 'thermal']).optional(), download: booleanish.optional() }) }),
  sales.document,
);
saleRouter.post('/:id/payments', requirePermission('pos.create'), validate({ params: idParam, body: v.salePayment.extend({ amount: v.salePayment.shape.amount.refine((n) => n > 0, 'Amount must be greater than zero') }) }), sales.recordPayment);
saleRouter.post('/:id/refund', requirePermission('pos.refund'), validate({ params: idParam, body: v.refund }), sales.refund);
saleRouter.post('/:id/void', requirePermission('sales.void'), validate({ params: idParam, body: v.voidSale }), sales.voidSale);
saleRouter.patch('/:id/date', requirePermission('sales.edit_history'), validate({ params: idParam, body: v.saleDateChange }), sales.changeDate);
saleRouter.patch('/:id/items/:itemId/costing', requirePermission('sales.correct'), validate({ params: v.saleItemParams, body: v.serviceCorrection }), sales.correctService);
saleRouter.post('/:id/items/:itemId/costing/review', requirePermission('sales.correct'), validate({ params: v.saleItemParams, body: v.serviceReview }), sales.reviewService);

const paymentRouter = Router();
paymentRouter.get('/', requirePermission('sales.view'), validate({ query: v.paymentList }), sales.payments);

// ---- /api/expenses ------------------------------------------------------------------------------
const expenseRouter = Router();
expenseRouter.get('/categories', requirePermission('expenses.view', 'expenses.manage'), async (_req, res) => sendSuccess(res, await expenseService.listCategories()));
expenseRouter.post('/categories', requirePermission('expenses.manage'), validate({ body: v.categoryBody }), async (req, res) => {
  sendCreated(res, await expenseService.saveCategory(null, req.body, req.ctx), 'Category created');
});
expenseRouter.patch('/categories/:id', requirePermission('expenses.manage'), validate({ params: idParam, body: v.categoryBody }), async (req, res) => {
  sendSuccess(res, await expenseService.saveCategory(req.params.id, req.body, req.ctx), 'Category updated');
});
expenseRouter.delete('/categories/:id', requirePermission('expenses.manage'), validate({ params: idParam }), async (req, res) => {
  await expenseService.deleteCategory(req.params.id, req.ctx);
  sendSuccess(res, null, 'Category deleted');
});
expenseRouter.get('/', requirePermission('expenses.view'), validate({ query: v.expenseList }), async (req, res) => {
  sendPaginated(res, await expenseService.list(req.validQuery, req.ctx));
});
expenseRouter.post('/', requirePermission('expenses.manage'), validate({ body: v.expenseBody }), async (req, res) => {
  sendCreated(res, await expenseService.create(req.body, req.ctx), 'Expense recorded successfully');
});
expenseRouter.get('/:id', requirePermission('expenses.view'), validate({ params: idParam }), async (req, res) => {
  sendSuccess(res, await expenseService.getById(req.params.id, req.ctx));
});
expenseRouter.patch('/:id', requirePermission('expenses.manage'), validate({ params: idParam, body: v.expenseUpdate }), async (req, res) => {
  sendSuccess(res, await expenseService.update(req.params.id, req.body, req.ctx), 'Expense updated successfully');
});
expenseRouter.delete('/:id', requirePermission('expenses.manage'), validate({ params: idParam }), async (req, res) => {
  removeUploadedFile(await expenseService.remove(req.params.id, req.ctx));
  sendSuccess(res, null, 'Expense deleted');
});
expenseRouter.post('/:id/attachment', requirePermission('expenses.manage'), validate({ params: idParam }), singleUpload('attachment', 'expenses', ['image', 'document']), async (req, res) => {
  if (!req.file) throw ApiError.validation([{ field: 'attachment', message: 'Choose a receipt image or PDF' }]);
  try {
    removeUploadedFile(await expenseService.setAttachment(req.params.id, req.file.publicPath, req.ctx));
  } catch (error) {
    removeUploadedFile(req.file.publicPath);
    throw error;
  }
  sendSuccess(res, { attachment: req.file.publicPath }, 'Receipt attached');
});
// The receipt itself, only for people who may see this branch's expenses.
expenseRouter.get('/:id/attachment', requirePermission('expenses.view'), validate({ params: idParam }), async (req, res) => {
  const expense = await expenseService.getById(req.params.id, req.ctx);
  const file = resolveUploadedFile(expense.attachment);
  if (!file || !fs.existsSync(file)) throw ApiError.notFound('This expense has no receipt');
  const ext = path.extname(file).toLowerCase();
  const types = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  res.setHeader('Content-Type', types[ext] || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="receipt-${expense.id}${ext}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(file);
});
expenseRouter.delete('/:id/attachment', requirePermission('expenses.manage'), validate({ params: idParam }), async (req, res) => {
  removeUploadedFile(await expenseService.setAttachment(req.params.id, null, req.ctx));
  sendSuccess(res, null, 'Receipt removed');
});

// ---- /api/payroll ----------------------------------------------------------------------------------
const payrollRouter = Router();
payrollRouter.use(requirePermission('payroll.manage'));
payrollRouter.get('/commissions', validate({ query: v.payroll.commissionList }), async (req, res) => {
  sendPaginated(res, await payrollService.listCommissions(req.validQuery, req.ctx));
});
// Commission payouts (the salon pays commission only).
payrollRouter.get('/payouts', validate({ query: v.payroll.payoutList }), async (req, res) => {
  sendPaginated(res, await payrollService.listPayouts(req.validQuery, req.ctx));
});
payrollRouter.post('/payouts/generate', validate({ body: v.payroll.generate }), async (req, res) => {
  const result = await payrollService.generate(req.body, req.ctx);
  const parts = [`${result.created} payout${result.created === 1 ? '' : 's'} prepared`];
  if (result.skipped.length) parts.push(`${result.skipped.length} already prepared for this period`);
  if (result.nothingOwed.length && !result.created) parts.push('no unpaid commission in this period');
  sendSuccess(res, result, parts.join('; '));
});
payrollRouter.patch('/payouts/:id', validate({ params: idParam, body: v.payroll.update }), async (req, res) => {
  sendSuccess(res, await payrollService.updatePayout(req.params.id, req.body, req.ctx), 'Payout updated');
});
payrollRouter.post('/payouts/:id/pay', validate({ params: idParam, body: v.payroll.pay }), async (req, res) => {
  sendSuccess(res, await payrollService.pay(req.params.id, req.body, req.ctx), 'Commission paid and recorded as an expense');
});
payrollRouter.delete('/payouts/:id', validate({ params: idParam }), async (req, res) => {
  await payrollService.removePayout(req.params.id, req.ctx);
  sendSuccess(res, null, 'Payout deleted');
});

module.exports = {
  productRouter, inventoryRouter, productCategoryRouter, supplierRouter, purchaseRouter, saleRouter, paymentRouter, expenseRouter, payrollRouter,
};
