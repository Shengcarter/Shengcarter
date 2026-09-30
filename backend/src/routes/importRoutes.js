'use strict';

const { Router } = require('express');
const { z } = require('zod');
const { requirePermission } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { spreadsheetUpload } = require('../middleware/upload');
const { heavyLimiter } = require('../middleware/rateLimiters');
const { booleanish } = require('../validators/common');
const { sendSuccess } = require('../utils/response');
const importService = require('../services/importService');

/**
 * /api/imports/:type — bring customers or past sales in from Excel / CSV.
 *
 *   GET  /:type/template   download the .xlsx template
 *   POST /:type/preview    check a file (multipart field "file"); nothing is saved
 *   POST /:type            import it; skipInvalid=true imports the good rows only
 */
const router = Router();
const typeParam = z.object({ type: z.enum(Object.keys(importService.IMPORTS)) });

// Each import type has its own permission (customers.import, sales.import).
const requireImportPermission = (req, res, next) => requirePermission(importService.definition(req.params.type).permission)(req, res, next);

router.get('/:type/template', validate({ params: typeParam }), requireImportPermission, async (req, res) => {
  const buffer = await importService.template(req.params.type, req.ctx);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="zola-stylish-${req.params.type}-import-template.xlsx"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
});

router.post('/:type/preview', validate({ params: typeParam }), requireImportPermission, heavyLimiter, spreadsheetUpload('file'), async (req, res) => {
  sendSuccess(res, await importService.preview(req.params.type, req.file, req.ctx), 'File checked');
});

router.post(
  '/:type',
  validate({ params: typeParam }),
  requireImportPermission,
  heavyLimiter,
  spreadsheetUpload('file'),
  validate({ body: z.object({ skipInvalid: booleanish.optional() }) }),
  async (req, res) => {
    const result = await importService.run(req.params.type, req.file, { skipInvalid: Boolean(req.body.skipInvalid) }, req.ctx);
    const what = req.params.type === 'sales' ? `${result.imported} sale${result.imported === 1 ? '' : 's'}` : `${result.imported} customer${result.imported === 1 ? '' : 's'}`;
    sendSuccess(res, result, `Imported ${what}`, 201);
  },
);

module.exports = router;
