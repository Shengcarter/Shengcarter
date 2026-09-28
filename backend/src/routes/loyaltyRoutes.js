'use strict';

const { Router } = require('express');
const validate = require('../middleware/validate');
const { requirePermission } = require('../middleware/auth');
const loyaltyService = require('../services/loyaltyService');
const settingsService = require('../services/settingsService');
const { sendSuccess, sendCreated } = require('../utils/response');
const { z, idParam, requiredText, optionalText } = require('../validators/common');

const tierBody = z.object({
  name: requiredText(50, 'Tier name'),
  minPoints: z.coerce.number().int().min(0).max(100_000_000),
  pointsMultiplier: z.coerce.number().min(0).max(10),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #D4AF37').optional(),
  benefits: optionalText(255),
});

// ---- /api/loyalty ---------------------------------------------------------------------
const router = Router();

// Tier list and program rules are needed by the POS and customer screens.
router.get('/tiers', requirePermission('customers.view', 'pos.create', 'loyalty.manage', 'notifications.send'), async (_req, res) => {
  sendSuccess(res, await loyaltyService.listTiersWithCounts());
});
router.get('/program', async (_req, res) => {
  sendSuccess(res, { ...loyaltyService.config(), tiers: await loyaltyService.getTiers() });
});

router.post('/tiers', requirePermission('loyalty.manage'), validate({ body: tierBody }), async (req, res) => {
  sendCreated(res, await loyaltyService.saveTier(null, req.body, req.ctx), 'Tier created');
});
router.patch('/tiers/:id', requirePermission('loyalty.manage'), validate({ params: idParam, body: tierBody }), async (req, res) => {
  sendSuccess(res, await loyaltyService.saveTier(req.params.id, req.body, req.ctx), 'Tier updated');
});
router.delete('/tiers/:id', requirePermission('loyalty.manage'), validate({ params: idParam }), async (req, res) => {
  await loyaltyService.deleteTier(req.params.id, req.ctx);
  sendSuccess(res, null, 'Tier deleted');
});

// Program rules are stored in the "loyalty" settings group.
router.put('/program', requirePermission('loyalty.manage'), async (req, res) => {
  const saved = await settingsService.updateGroup('loyalty', req.body, req.ctx);
  sendSuccess(res, saved, 'Loyalty program saved');
});

module.exports = router;
