'use strict';

const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { requirePermission, hasPermission } = require('../middleware/auth');
const { heavyLimiter } = require('../middleware/rateLimiters');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/response');
const { isoDate, idParam, booleanish } = require('../validators/common');
const db = require('../config/database');
const { REPORTS } = require('../services/reportService');
const { exportReport, FORMATS } = require('../services/exportService');
const { dashboard } = require('../services/dashboardService');
const { insights } = require('../services/insightService');
const backupService = require('../services/backupService');
const settingsService = require('../services/settingsService');
const auditService = require('../services/auditService');

/*
 * Dashboard, reports (with PDF / Excel / CSV export), insights and backups.
 * Handlers are small, so they live next to their routes.
 */

const periodQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  groupBy: z.enum(['day', 'week', 'month', 'year']).optional(),
});
const typeParam = z.object({ type: z.enum(Object.keys(REPORTS)) });

function assertReportAccess(req, type) {
  const report = REPORTS[type];
  const needed = Array.isArray(report.permission) ? report.permission : [report.permission];
  // Branch comparison needs every listed permission; other reports need one.
  const allowed = report.all ? needed.every((p) => hasPermission(req.user, p)) : needed.some((p) => hasPermission(req.user, p));
  if (!allowed) throw ApiError.forbidden('You do not have access to this report');
  return report;
}

async function branchName(branchId) {
  const row = await db.queryOne('SELECT name FROM branches WHERE id = ?', [branchId]);
  return row?.name || '';
}

// ---- /api/dashboard -----------------------------------------------------------------------
const dashboardRouter = Router();
dashboardRouter.get('/', requirePermission('dashboard.view'), async (req, res) => {
  sendSuccess(res, await dashboard(req.ctx));
});

// ---- /api/reports -------------------------------------------------------------------------
const reportRouter = Router();
reportRouter.use(requirePermission('reports.view', 'reports.financial'));

reportRouter.get('/:type', validate({ params: typeParam, query: periodQuery }), async (req, res) => {
  const report = assertReportAccess(req, req.params.type);
  sendSuccess(res, await report.build(req.validQuery, req.ctx));
});

reportRouter.get(
  '/:type/export',
  requirePermission('reports.export'),
  heavyLimiter,
  validate({ params: typeParam, query: periodQuery.extend({ format: z.enum(Object.keys(FORMATS)) }) }),
  async (req, res) => {
    const report = assertReportAccess(req, req.params.type);
    const data = await report.build(req.validQuery, req.ctx);
    const ctx = { ...req.ctx, branchName: report.all ? 'All branches' : await branchName(req.ctx.branchId) };
    const file = await exportReport(req.params.type, report.title, data, req.validQuery.format, ctx);
    await auditService.record(req.ctx, {
      action: 'report.exported', entityType: 'report',
      description: `Exported ${report.title} (${data.period.from} to ${data.period.to}) as ${req.validQuery.format.toUpperCase()}`,
    });
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.buffer);
  },
);

// ---- /api/insights ------------------------------------------------------------------------
const insightRouter = Router();
insightRouter.get(
  '/',
  requirePermission('insights.view'),
  validate({ query: z.object({ from: isoDate.optional(), to: isoDate.optional(), refresh: booleanish.optional() }) }),
  async (req, res, next) => (req.validQuery.refresh ? heavyLimiter(req, res, next) : next()),
  async (req, res) => {
    sendSuccess(res, await insights(req.validQuery, req.ctx, { refresh: Boolean(req.validQuery.refresh) }));
  },
);

// ---- /api/backups -------------------------------------------------------------------------
const backupRouter = Router();
backupRouter.use(requirePermission('backups.manage'));

backupRouter.get('/', async (_req, res) => {
  sendSuccess(res, { backups: await backupService.list(), settings: settingsService.getGroup('backup') });
});
backupRouter.post('/', heavyLimiter, async (req, res) => {
  sendCreated(res, await backupService.createBackup({ type: 'manual', ctx: req.ctx }), 'Backup created successfully');
});
backupRouter.put('/settings', async (req, res) => {
  const data = await settingsService.updateGroup('backup', req.body, req.ctx);
  backupService.schedule();
  sendSuccess(res, data, 'Backup settings saved');
});
backupRouter.get('/:id/download', validate({ params: idParam }), async (req, res) => {
  const file = await backupService.downloadInfo(req.params.id, req.ctx);
  res.setHeader('Cache-Control', 'no-store');
  res.download(file.path, file.filename);
});
backupRouter.delete('/:id', validate({ params: idParam }), async (req, res) => {
  await backupService.remove(req.params.id, req.ctx);
  sendSuccess(res, null, 'Backup deleted');
});

module.exports = { dashboardRouter, reportRouter, insightRouter, backupRouter };
