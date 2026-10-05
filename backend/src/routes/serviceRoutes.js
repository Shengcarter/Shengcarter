'use strict';

const { Router } = require('express');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/auth');
const catalog = require('../services/catalogService');
const serviceRules = require('../services/serviceRuleService');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/response');
const { z, idParam, id, requiredText, optionalText, positiveMoney, optionalId, emptyToUndefined } = require('../validators/common');

// Products a service normally uses, in each product's usage unit (the recipe).
const recipe = z
  .array(z.object({
    productId: id,
    quantity: z.coerce.number().positive('Quantity must be more than 0').max(100_000)
      .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Use at most 3 decimal places'),
  }))
  .max(30, 'At most 30 products per service')
  .refine((rows) => new Set(rows.map((r) => r.productId)).size === rows.length, 'List each product once');

const categoryBody = z.object({
  name: requiredText(80, 'Category name'),
  description: optionalText(255),
  sortOrder: z.coerce.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
});

const serviceBody = z.object({
  categoryId: id,
  name: requiredText(120, 'Service name'),
  description: optionalText(2000),
  price: positiveMoney,
  // Set when the price depends on length or complexity: charged between price and maxPrice.
  maxPrice: z.preprocess((v) => (v === '' ? null : v), positiveMoney.nullable().optional()),
  durationMinutes: z.coerce.number().int().min(5, 'At least 5 minutes').max(720, 'At most 12 hours'),
  // No longer used for pay (staff earn their share of the service split); kept for older clients.
  commissionRate: z.preprocess((v) => (v === '' ? null : v), z.coerce.number().min(0).max(100).nullable().optional()),
  isActive: z.boolean().optional(),
  employeeIds: z.array(id).max(200).optional(),
  recipe: recipe.optional(),
});

// A service's financial rule (see services/financialRules.js for the meaning).
const rulePart = z.object({
  type: z.enum(['fixed', 'percent', 'remainder', 'none']),
  value: z.coerce.number().min(0, 'Enter 0 or more').max(1_000_000_000).optional(),
});
const ruleBand = z.object({
  min: z.coerce.number().min(0).max(1_000_000_000),
  max: z.coerce.number().min(0).max(1_000_000_000),
  label: optionalText(60),
  general: z.boolean().optional(),
  operations: rulePart.optional(),
  staff: rulePart.optional(),
  profit: rulePart.optional(),
});
const financialRule = z.object({
  method: z.enum(['general', 'bands', 'unconfigured']),
  productCost: z.enum(['deduct', 'none']).optional().default('deduct'),
  productsIncluded: z.boolean().optional().default(true),
  staffSplit: z.enum(['equal']).optional().default('equal'),
  bands: z.array(ruleBand).max(50, 'At most 50 price bands').optional().default([]),
});
const ruleBody = z.object({ rule: financialRule, notes: optionalText(255) });
const rulePreview = z.object({
  rule: financialRule,
  price: z.coerce.number().min(0).max(1_000_000_000),
  productCost: z.coerce.number().min(0).max(1_000_000_000).optional().default(0),
  staffCount: z.coerce.number().int().min(1).max(20).optional().default(1),
});

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  categoryId: optionalId,
  employeeId: optionalId,
  status: z.preprocess(emptyToUndefined, z.enum(['active', 'inactive']).optional()),
});

// ---- /api/service-categories --------------------------------------------------
const categoryRouter = Router();
categoryRouter.get('/', requirePermission('services.view', 'pos.create', 'appointments.create'), async (_req, res) => {
  sendSuccess(res, await catalog.listCategories());
});
categoryRouter.post('/', requirePermission('services.manage'), validate({ body: categoryBody }), async (req, res) => {
  sendCreated(res, await catalog.saveCategory(null, req.body, req.ctx), 'Category created');
});
categoryRouter.patch('/:id', requirePermission('services.manage'), validate({ params: idParam, body: categoryBody.partial() }), async (req, res) => {
  const existing = (await catalog.listCategories()).find((c) => c.id === req.params.id);
  if (!existing) throw ApiError.notFound('Category not found');
  sendSuccess(res, await catalog.saveCategory(req.params.id, { ...existing, ...req.body }, req.ctx), 'Category updated');
});
categoryRouter.delete('/:id', requirePermission('services.manage'), validate({ params: idParam }), async (req, res) => {
  await catalog.deleteCategory(req.params.id, req.ctx);
  sendSuccess(res, null, 'Category deleted');
});

// ---- /api/services ----------------------------------------------------------------
// Readable by anyone who books or sells services, not only catalog managers.
const serviceRouter = Router();
const canRead = requirePermission('services.view', 'pos.create', 'appointments.create', 'appointments.view_own');

serviceRouter.get('/', canRead, validate({ query: listQuery }), async (req, res) => {
  sendSuccess(res, await catalog.listServices(req.validQuery, req.ctx));
});
// Financial rules: configured by people with services.rules; readable by them and by people who see financial reports.
serviceRouter.post('/financial-rule/preview', requirePermission('services.rules'), validate({ body: rulePreview }), async (req, res) => {
  sendSuccess(res, serviceRules.preview(req.body));
});
serviceRouter.get('/:id/financial-rule', requirePermission('services.rules', 'reports.financial'), validate({ params: idParam }), async (req, res) => {
  sendSuccess(res, await serviceRules.getRule(req.params.id));
});
serviceRouter.put('/:id/financial-rule', requirePermission('services.rules'), validate({ params: idParam, body: ruleBody }), async (req, res) => {
  sendSuccess(res, await serviceRules.setRule(req.params.id, req.body, req.ctx), 'Financial rule saved');
});
serviceRouter.get('/:id', canRead, validate({ params: idParam }), async (req, res) => {
  sendSuccess(res, await catalog.getService(req.params.id, req.ctx));
});
serviceRouter.post('/', requirePermission('services.manage'), validate({ body: serviceBody }), async (req, res) => {
  sendCreated(res, await catalog.saveService(null, req.body, req.ctx), 'Service created successfully');
});
serviceRouter.patch('/:id', requirePermission('services.manage'), validate({ params: idParam, body: serviceBody.partial() }), async (req, res) => {
  sendSuccess(res, await catalog.saveService(req.params.id, req.body, req.ctx), 'Service updated successfully');
});
serviceRouter.delete('/:id', requirePermission('services.manage'), validate({ params: idParam }), async (req, res) => {
  const result = await catalog.deleteService(req.params.id, req.ctx);
  sendSuccess(res, result, result.archived ? 'Service has history, so it was deactivated instead of deleted' : 'Service deleted');
});

module.exports = { categoryRouter, serviceRouter };
