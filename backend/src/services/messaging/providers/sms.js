'use strict';

const config = require('../../../config');
const logger = require('../../../config/logger');
const settings = require('../../settingsService');

/**
 * SMS providers:
 *   log            — writes the message to the server log (default)
 *   africastalking — Africa's Talking (Tanzania, Kenya, Uganda, ...)
 *   twilio         — Twilio Programmable Messaging
 */
const TIMEOUT_MS = 15_000;

async function sendAfricasTalking({ to, body }) {
  const username = settings.get('integrations.sms_username') || config.integrations.sms.username;
  const apiKey = settings.getSecret('integrations.sms_api_key');
  if (!username || !apiKey) throw new Error("Africa's Talking username or API key is not configured");

  const host = username === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
  const form = new URLSearchParams({ username, to, message: body });
  const senderId = settings.get('integrations.sms_sender_id');
  if (senderId) form.set('from', senderId);

  const response = await fetch(`https://${host}/version1/messaging`, {
    method: 'POST',
    headers: { apiKey, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  const recipient = data?.SMSMessageData?.Recipients?.[0];
  if (!response.ok || !recipient || !['Success', 'Sent'].includes(recipient.status)) {
    throw new Error(`Africa's Talking error: ${recipient?.status || data?.SMSMessageData?.Message || response.status}`);
  }
  return { providerRef: recipient.messageId };
}

/** content: { contentSid, contentVariables } sends an approved WhatsApp template instead of the text. */
async function sendTwilio({ to, body }, { whatsapp = false, content = null } = {}) {
  const sid = settings.get('integrations.twilio_account_sid') || config.integrations.sms.twilioAccountSid;
  const token = settings.getSecret('integrations.twilio_auth_token');
  const from = settings.get('integrations.twilio_from') || config.integrations.sms.twilioFrom;
  if (!sid || !token || !from) throw new Error('Twilio account SID, auth token or sender number is not configured');

  const prefix = whatsapp ? 'whatsapp:' : '';
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      To: `${prefix}${to}`,
      From: `${prefix}${from}`,
      ...(content ? { ContentSid: content.contentSid, ContentVariables: JSON.stringify(content.contentVariables) } : { Body: body }),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Twilio error: ${data?.message || response.status}`);
  return { providerRef: data.sid };
}

async function send(message) {
  const provider = settings.get('integrations.sms_provider');
  if (provider === 'africastalking') return { provider, ...(await sendAfricasTalking(message)) };
  if (provider === 'twilio') return { provider, ...(await sendTwilio(message)) };
  logger.info({ channel: 'sms', to: message.to, body: message.body }, 'SMS (log provider — not sent)');
  return { provider: 'log', providerRef: null };
}

module.exports = { send, sendTwilio };
