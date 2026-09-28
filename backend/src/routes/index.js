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

router.use(authenticate);

router.use('/users', admin.userRouter);
router.use('/roles', admin.roleRouter);
router.use('/branches', admin.branchRouter);
router.use('/settings', admin.settingsRouter);
router.use('/activity-logs', admin.activityRouter);
router.use('/notifications', notificationRouter);
router.use('/search', searchRouter);
router.use('/messages', messageRouter);

module.exports = router;
