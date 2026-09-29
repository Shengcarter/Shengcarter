'use strict';

const { Router } = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const notificationService = require('../services/notificationService');
const searchService = require('../services/searchService');
const messageLogService = require('../services/messageLogService');
const { requirePermission } = require('../middleware/auth');
const { sendSuccess, sendPaginated } = require('../utils/response');
const { idParam, listQuery, booleanish, optionalId, id } = require('../validators/common');

// ---- /api/notifications (every signed-in user sees their own) ----------------
const notificationRouter = Router();

notificationRouter.get(
  '/',
  validate({
    query: listQuery.extend({
      unreadOnly: booleanish.optional(),
      category: z.enum(['appointment', 'inventory', 'payment', 'customer', 'system']).optional(),
    }),
  }),
  async (req, res) => sendPaginated(res, await notificationService.list(req.user.id, req.validQuery)),
);

notificationRouter.get('/unread-count', async (req, res) => {
  sendSuccess(res, { count: await notificationService.unreadCount(req.user.id) });
});

notificationRouter.post('/read-all', async (req, res) => {
  const updated = await notificationService.markAllRead(req.user.id);
  sendSuccess(res, { updated }, 'All notifications marked as read');
});

notificationRouter.post('/:id/read', validate({ params: idParam }), async (req, res) => {
  await notificationService.markRead(req.user.id, req.params.id);
  sendSuccess(res, null, 'Notification marked as read');
});

// ---- /api/messages (customer email / SMS / WhatsApp) ------------------------------
const messageRouter = Router();
messageRouter.use(requirePermission('notifications.send'));

messageRouter.get(
  '/',
  validate({
    query: listQuery.extend({
      channel: z.enum(['email', 'sms', 'whatsapp']).optional(),
      status: z.enum(['queued', 'sent', 'failed', 'skipped']).optional(),
      customerId: optionalId,
    }),
  }),
  async (req, res) => {
    const result = await messageLogService.list(req.validQuery);
    sendPaginated(res, { ...result, summary: await messageLogService.stats() });
  },
);

messageRouter.post(
  '/send',
  validate({
    body: z.object({
      channel: z.enum(['email', 'sms', 'whatsapp']),
      audience: z.enum(['selected', 'all_opted_in', 'tier', 'inactive', 'birthday']),
      customerIds: z.array(id).max(2000).optional(),
      tierId: optionalId,
      inactiveDays: z.coerce.number().int().min(14).max(730).optional(),
      subject: z.string().trim().max(200).optional(),
      message: z.string().trim().min(1, 'Message is required').max(1000, 'Maximum 1000 characters'),
    }),
  }),
  async (req, res) => {
    const result = await messageLogService.send(req.body, req.ctx);
    sendSuccess(res, result, `${result.queued} message(s) queued for delivery`);
  },
);

messageRouter.post('/:id/retry', validate({ params: idParam }), async (req, res) => {
  await messageLogService.retry(req.params.id, req.ctx);
  sendSuccess(res, null, 'Message queued for another attempt');
});

// ---- /api/search ------------------------------------------------------------------
const searchRouter = Router();
searchRouter.get(
  '/',
  validate({ query: z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(100) }) }),
  async (req, res) => sendSuccess(res, await searchService.search(req.validQuery.q, req.ctx)),
);

module.exports = { notificationRouter, searchRouter, messageRouter };
