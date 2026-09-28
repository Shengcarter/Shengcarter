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

function renderTemplate(template, variables) {
  return String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) =>
    variables[name] !== undefined && variables[name] !== null ? String(variables[name]) : '');
}

/** Deliver immediately (used for password resets and "send test message"). */
async function sendNow({ channel, to, subject, body, html }) {
  const provider = PROVIDERS[channel];
  if (!provider) throw new Error(`Unknown channel ${channel}`);
  return provider.send({ to, subject, body, html });
}

/** Queue a message for background delivery. Returns the message log id. */
async function enqueue({ channel, recipient, subject = null, body, template = null, customerId = null, branchId = null, relatedType = null, relatedId = null, createdBy = null, scheduledAt = null }, conn = null) {
  if (!recipient) return null;
  const result = await db.query(
    `INSERT INTO message_logs (branch_id, customer_id, channel, recipient, subject, body, template, related_type, related_id, created_by, scheduled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, UTC_TIMESTAMP()))`,
    [branchId, customerId, channel, recipient, subject, body, template, relatedType, relatedId, createdBy, scheduledAt],
    conn,
  );
  return result.insertId;
}

/**
 * Queue a templated customer notification on every channel configured for
 * the event in Settings → Notifications (e.g. appointment_confirmation).
 */
async function notifyCustomer(event, customer, variables, meta = {}, conn = null) {
  if (!customer) return [];
  const channels = settings.get('notifications.channels')?.[event] || [];
  const template = settings.get('notifications.templates')?.[event];
  if (!channels.length || !template) return [];

  const body = renderTemplate(template, { salon_name: settings.get('business.salon_name'), ...variables });
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
    `SELECT id, channel, recipient, subject, body, attempts FROM message_logs
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
      const result = await sendNow({ channel: message.channel, to: message.recipient, subject: message.subject, body: message.body });
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

module.exports = { renderTemplate, sendNow, enqueue, notifyCustomer, processQueue, emailConfigured: email.isConfigured };
