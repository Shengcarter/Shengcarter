'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { rateLimit } = require('express-rate-limit');
const config = require('../config');
const logger = require('../config/logger');
const settings = require('../services/settingsService');
const replies = require('../services/messaging/replies');

/**
 * /api/webhooks/whatsapp — customer replies and delivery reports from
 * WhatsApp (Meta Cloud API or Twilio). No sign-in: every request must carry
 * the provider's signature, made with a secret only the salon and the
 * provider know (Meta app secret / Twilio auth token), or it is refused.
 *
 * The system must be reachable from the internet for this to work (see
 * docs/WHATSAPP.md); on a salon-only network replies simply never arrive.
 */
const router = Router();

// Generous: every message sent produces several delivery reports.
router.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => config.isTest,
}));

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** Meta signs the raw body with the app secret: X-Hub-Signature-256: sha256=<hex>. */
function validMetaSignature(req) {
  const secret = settings.getSecret('integrations.whatsapp_app_secret');
  const header = req.get('x-hub-signature-256') || '';
  if (!secret || !req.rawBody || !header.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  return safeEqual(header.slice(7), expected);
}

/**
 * Twilio signs the full URL it called plus the sorted form fields with the
 * auth token (HMAC-SHA1, base64). Behind a proxy the URL the server sees can
 * differ, so the public address from Settings is tried as well.
 */
function validTwilioSignature(req) {
  const token = settings.getSecret('integrations.twilio_auth_token');
  const header = req.get('x-twilio-signature');
  if (!token || !header) return false;
  const fields = Object.keys(req.body || {}).sort().map((key) => `${key}${req.body[key]}`).join('');
  const publicUrl = settings.get('integrations.public_url');
  const urls = [`${req.protocol}://${req.get('host')}${req.originalUrl}`];
  if (publicUrl) urls.push(`${publicUrl}${req.originalUrl}`);
  return urls.some((url) => safeEqual(header, crypto.createHmac('sha1', token).update(url + fields).digest('base64')));
}

// Meta checks the address once when the webhook is connected.
router.get('/whatsapp', (req, res) => {
  const expected = settings.get('integrations.whatsapp_verify_token');
  const challenge = String(req.query['hub.challenge'] || '');
  if (req.query['hub.mode'] === 'subscribe' && expected && safeEqual(req.query['hub.verify_token'] || '', expected) && /^[\w-]{1,200}$/.test(challenge)) {
    return res.type('text/plain').send(challenge);
  }
  logger.warn('WhatsApp webhook verification refused: the verify token does not match Settings → Integrations');
  return res.sendStatus(403);
});

router.post('/whatsapp', async (req, res) => {
  const twilio = req.is('application/x-www-form-urlencoded');
  if (!(twilio ? validTwilioSignature(req) : validMetaSignature(req))) {
    logger.warn({ provider: twilio ? 'twilio' : 'meta_cloud' }, 'WhatsApp webhook refused: missing or invalid signature');
    return res.sendStatus(401);
  }
  const { messages, statuses } = twilio ? replies.fromTwilio(req.body) : replies.fromMeta(req.body);
  // Errors reach the error handler (500), so WhatsApp tries again later;
  // messages already saved are recognised and not handled twice.
  for (const status of statuses) await replies.handleStatus(status);
  for (const message of messages) await replies.handleIncoming(message);
  if (twilio) return res.type('text/xml').send('<Response></Response>');
  return res.sendStatus(200);
});

module.exports = router;
