'use strict';

const config = require('../../../config');
const logger = require('../../../config/logger');
const settings = require('../../settingsService');
const { sendTwilio } = require('./sms');

/**
 * WhatsApp Business providers:
 *   log        — writes the message to the server log (default)
 *   meta_cloud — Meta WhatsApp Cloud API (graph.facebook.com)
 *   twilio     — Twilio WhatsApp sender
 *
 * Note: WhatsApp only delivers free-form text inside the 24-hour customer
 * service window. Outside it Meta requires pre-approved message templates.
 */
const GRAPH_VERSION = 'v21.0';

async function sendMetaCloud({ to, body }) {
  const phoneNumberId = settings.get('integrations.whatsapp_phone_number_id') || config.integrations.whatsapp.phoneNumberId;
  const token = settings.getSecret('integrations.whatsapp_access_token');
  if (!phoneNumberId || !token) throw new Error('WhatsApp phone number ID or access token is not configured');

  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: to.replace(/^\+/, ''),
      type: 'text',
      text: { preview_url: false, body },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`WhatsApp error: ${data?.error?.message || response.status}`);
  return { providerRef: data?.messages?.[0]?.id || null };
}

async function send(message) {
  const provider = settings.get('integrations.whatsapp_provider');
  if (provider === 'meta_cloud') return { provider, ...(await sendMetaCloud(message)) };
  if (provider === 'twilio') return { provider, ...(await sendTwilio(message, { whatsapp: true })) };
  logger.info({ channel: 'whatsapp', to: message.to, body: message.body }, 'WhatsApp (log provider — not sent)');
  return { provider: 'log', providerRef: null };
}

module.exports = { send };
