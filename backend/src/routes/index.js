'use strict';

const { Router } = require('express');
const db = require('../config/database');
const config = require('../config');
const { authenticate } = require('../middleware/auth');
const settingsService = require('../services/settingsService');
const { sendSuccess } = require('../utils/response');
const authRoutes = require('./authRoutes');
const publicRoutes = require('./publicRoutes');
const admin = require('./adminRoutes');
const { notificationRouter, searchRouter, messageRouter } = require('./notificationRoutes');
const customerRoutes = require('./customerRoutes');
const { categoryRouter, serviceRouter } = require('./serviceRoutes');
const { employeeRouter, attendanceRouter, leaveRouter } = require('./employeeRoutes');
const appointmentRoutes = require('./appointmentRoutes');
const loyaltyRoutes = require('./loyaltyRoutes');
const commerce = require('./commerceRoutes');
const insight = require('./reportRoutes');
const importRoutes = require('./importRoutes');
const webhookRoutes = require('./webhookRoutes');

/**
 * API route map. Everything below `authenticate` requires a valid access token;
 * each module router then checks its own permissions.
 */
const router = Router();

// Keep the settings cache fresh for every request (cheap TTL check).
router.use(async (_req, _res, next) => {
  await settingsService.ensureFresh();
  next();
});

router.get('/health', async (_req, res) => {
  await db.ping();
  sendSuccess(res, { status: 'ok', app: config.appName, time: new Date().toISOString() }, 'Healthy');
});

router.use('/auth', authRoutes);
router.use('/public', publicRoutes);
router.use('/webhooks', webhookRoutes);

router.use(authenticate);

router.use('/users', admin.userRouter);
router.use('/roles', admin.roleRouter);
router.use('/branches', admin.branchRouter);
router.use('/settings', admin.settingsRouter);
router.use('/activity-logs', admin.activityRouter);
router.use('/notifications', notificationRouter);
router.use('/search', searchRouter);
router.use('/messages', messageRouter);
router.use('/customers', customerRoutes);
router.use('/service-categories', categoryRouter);
router.use('/services', serviceRouter);
router.use('/employees', employeeRouter);
router.use('/attendance', attendanceRouter);
router.use('/leave', leaveRouter);
router.use('/appointments', appointmentRoutes);
router.use('/loyalty', loyaltyRoutes);
router.use('/products', commerce.productRouter);
router.use('/product-categories', commerce.productCategoryRouter);
router.use('/inventory', commerce.inventoryRouter);
router.use('/suppliers', commerce.supplierRouter);
router.use('/purchases', commerce.purchaseRouter);
router.use('/sales', commerce.saleRouter);
router.use('/payments', commerce.paymentRouter);
router.use('/expenses', commerce.expenseRouter);
router.use('/payroll', commerce.payrollRouter);
router.use('/imports', importRoutes);
router.use('/dashboard', insight.dashboardRouter);
router.use('/reports', insight.reportRouter);
router.use('/insights', insight.insightRouter);
router.use('/backups', insight.backupRouter);

module.exports = router;
