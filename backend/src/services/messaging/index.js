'use strict';

const db = require('../../config/database');
const logger = require('../../config/logger');
const settings = require('../settingsService');
const email = require('./providers/email');
const sms = require('./providers/sms');
const whatsapp = require('./providers/whatsapp');

/**
 * Outbound messaging (email / SMS / WhatsApp) behind a provider abstraction.
 *
 * Messages are written to `message_logs` with status "queued" and delivered
 * by a background job, so a slow or offline provider never blocks the salon.
 * When the internet is down, messages simply stay queued and are retried.
 */
const PROVIDERS = { email, sms, whatsapp };
const MAX_ATTEMPTS = 5;

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g;

function renderTemplate(template, variables) {
  return String(template || '').replace(PLACEHOLDER, (_, name) =>
    variables[name] !== undefined && variables[name] !== null ? String(variables[name]) : '');
}

/**
 * Values for an approved WhatsApp template, in the order the placeholders
 * first appear in the message text: "Hello {{customer_name}}, … {{date}}"
 * gives [customer name, date]. The approved template uses {{1}}, {{2}}, …
 * in the same order. WhatsApp rejects empty values, tabs, new lines and runs
 * of spaces inside a value, so those are tidied.
 */
function templateParams(template, variables) {
  const names = [];
  for (const [, name] of String(template || '').matchAll(PLACEHOLDER)) if (!names.includes(name)) names.push(name);
  return names.map((name) => {
    const value = variables[name] === undefined || variables[name] === null ? '' : String(variables[name]);
    return value.replace(/\s+/g, ' ').trim().slice(0, 1000) || '-';
  });
}

/**
 * Deliver immediately (used for password resets and "send test message").
 * event/params: for WhatsApp, the notification type and the values for its
 * approved template, when one is set up in Settings → Integrations.
 */
async function sendNow({ channel, to, subject, body, html, event = null, params = null }) {
  const provider = PROVIDERS[channel];
  if (!provider) throw new Error(`Unknown channel ${channel}`);
  return provider.send({ to, subject, body, html, event, params });
}

/** Queue a message for background delivery. Returns the message log id. */
async function enqueue({ channel, recipient, subject = null, body, template = null, templateParams: params = null, customerId = null, branchId = null, relatedType = null, relatedId = null, createdBy = null, scheduledAt = null }, conn = null) {
  if (!recipient) return null;
  const result = await db.query(
    `INSERT INTO message_logs (branch_id, customer_id, channel, recipient, subject, body, template, template_params, related_type, related_id, created_by, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))`,
    [branchId, customerId, channel, recipient, subject, body, template, params ? JSON.stringify(params) : null, relatedType, relatedId, createdBy, scheduledAt],
    conn,
  );
  return result.insertId;
}

/**
 * Queue a templated customer notification on every channel configured for
 * the event in Settings → Notifications (e.g. appointment_confirmation).
 */
async function notifyCustomer(event, customer, variables, meta = {}, conn = null) {
  // Customers who chose "no messages" never receive automated notifications.
  if (!customer || customer.preferred_channel === 'none') return [];
  const channels = settings.get('notifications.channels')?.[event] || [];
  const template = settings.get('notifications.templates')?.[event];
  if (!channels.length || !template) return [];

  const values = { salon_name: settings.get('business.salon_name'), ...variables };
  const body = renderTemplate(template, values);
  const ids = [];
  for (const channel of channels) {
    const recipient = channel === 'email' ? customer.email : customer.phone;
    if (!recipient) continue;
    const id = await enqueue({
      channel,
      recipient,
      subject: channel === 'email' ? `${settings.get('business.salon_name')} — ${event.replace(/_/g, ' ')}` : null,
      body,
      template: event,
      templateParams: channel === 'whatsapp' ? templateParams(template, values) : null,
      customerId: customer.id,
      ...meta,
    }, conn);
    ids.push(id);
  }
  return ids;
}

/** Deliver due queued messages. Called by the message queue job. */
async function processQueue({ batchSize = 20 } = {}) {
  await settings.ensureFresh();
  const due = await db.query(
    `SELECT id, channel, recipient, subject, body, template, template_params, attempts FROM message_logs
     WHERE status = 'queued' AND scheduled_at <= UTC_TIMESTAMP()
     ORDER BY scheduled_at LIMIT ?`,
    [batchSize],
  );
  let sent = 0;
  for (const message of due) {
    // Claim the row so parallel workers never send the same message twice.
    const claim = await db.query(
      "UPDATE message_logs SET attempts = attempts + 1 WHERE id = ? AND status = 'queued' AND attempts = ?",
      [message.id, message.attempts],
    );
    if (!claim.affectedRows) continue;
    try {
      const result = await sendNow({
        channel: message.channel,
        to: message.recipient,
        subject: message.subject,
        body: message.body,
        event: message.template,
        params: message.template_params,
      });
      await db.query(
        "UPDATE message_logs SET status = 'sent', provider = ?, provider_ref = ?, sent_at = UTC_TIMESTAMP(), last_error = NULL WHERE id = ?",
        [result.provider, result.providerRef, message.id],
      );
      sent += 1;
    } catch (error) {
      const attempts = message.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      // Exponential back-off: 1, 2, 4, 8 minutes.
      await db.query(
        `UPDATE message_logs SET status = ?, last_error = ?,
           scheduled_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
         WHERE id = ?`,
        [failed ? 'failed' : 'queued', String(error.message).slice(0, 500), 2 ** (attempts - 1), message.id],
      );
      logger.warn({ messageId: message.id, channel: message.channel, err: error.message, attempts }, 'Message delivery failed');
    }
  }
  return { processed: due.length, sent };
}

module.exports = { renderTemplate, templateParams, sendNow, enqueue, notifyCustomer, processQueue, emailConfigured: email.isConfigured };
