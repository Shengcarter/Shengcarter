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
 * WhatsApp only delivers free-form text inside the 24-hour customer service
 * window (after the customer's last message). Messages the salon starts —
 * booking confirmations, reminders, thank-you notes — must use a template
 * approved by Meta. When one is set up for the message type in Settings →
 * Integrations, it is sent with the message's values as {{1}}, {{2}}, …;
 * otherwise the text is sent as it is.
 */
const GRAPH_VERSION = 'v21.0';

/** The approved template for this notification type, if one is set up. */
function approvedTemplate(event) {
  if (!event) return null;
  const entry = settings.get('integrations.whatsapp_templates')?.[event];
  return entry?.name ? { name: entry.name, language: entry.language || 'en' } : null;
}

async function sendMetaCloud({ to, body, event, params }) {
  const phoneNumberId = settings.get('integrations.whatsapp_phone_number_id') || config.integrations.whatsapp.phoneNumberId;
  const token = settings.getSecret('integrations.whatsapp_access_token');
  if (!phoneNumberId || !token) throw new Error('WhatsApp phone number ID or access token is not configured');

  const template = approvedTemplate(event);
  const payload = template
    ? {
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(params?.length ? { components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }] } : {}),
      },
    }
    : { type: 'text', text: { preview_url: false, body } };

  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/^\+/, ''), ...payload }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.error?.error_data?.details || data?.error?.message || response.status;
    throw new Error(`WhatsApp error${template ? ` (template "${template.name}")` : ''}: ${detail}`);
  }
  return { providerRef: data?.messages?.[0]?.id || null };
}

async function sendTwilioWhatsApp({ to, body, event, params }) {
  // For Twilio the template field holds the Content SID (HX…) of the approved template.
  const template = approvedTemplate(event);
  const content = template
    ? { contentSid: template.name, contentVariables: Object.fromEntries((params || []).map((value, i) => [String(i + 1), value])) }
    : null;
  return sendTwilio({ to, body }, { whatsapp: true, content });
}

async function send(message) {
  const provider = settings.get('integrations.whatsapp_provider');
  if (provider === 'meta_cloud') return { provider, ...(await sendMetaCloud(message)) };
  if (provider === 'twilio') return { provider, ...(await sendTwilioWhatsApp(message)) };
  const template = approvedTemplate(message.event);
  logger.info(
    { channel: 'whatsapp', to: message.to, body: message.body, ...(template ? { template: template.name, params: message.params } : {}) },
    'WhatsApp (log provider — not sent)',
  );
  return { provider: 'log', providerRef: null };
}

module.exports = { send, approvedTemplate };
