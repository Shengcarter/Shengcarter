'use strict';

const db = require('../../config/database');
const logger = require('../../config/logger');
const settings = require('../settingsService');
const notificationService = require('../notificationService');
const audit = require('../auditService');
const { normalizePhone } = require('../../utils/phone');
const messaging = require('./index');

/**
 * Customer replies to WhatsApp booking confirmations and reminders.
 *
 *   YES, OK, SAWA, NDIYO, 👍           → appointment confirmed
 *   LATE 15, NITACHELEWA DAKIKA 20     → running late (minutes kept); staff alerted
 *   CANCEL, NO, SITAKUJA               → wants to cancel or change; staff alerted to call
 *   STOP, ACHA                         → no more automatic messages
 *   anything else                      → passed to the front desk as a notification
 *
 * A reply belongs to the appointment the customer answered (WhatsApp tells us
 * which message they replied to), or else to their next appointment. Every
 * incoming message is kept in the message log.
 */

// Date and time wording shared with the appointment messages. Loaded lazily
// because appointmentService itself depends on the messaging module.
let appointmentFormat = null;
function formats() {
  if (!appointmentFormat) appointmentFormat = require('../appointmentService');
  return appointmentFormat;
}

// ---- Understanding the reply ---------------------------------------------------------------

function words(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/[^a-z0-9'.\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP = /^(stop|stop all|unsubscribe|acha|sitisha)$/;
const NOT_LATE = /\b(won't|wont|will not|not going to) be late\b|\bsitachelewa\b/;
const LATE = /\b(late|delay|delayed|running behind|traffic|stuck|chelewa|nitachelewa|nimechelewa|nachelewa|kuchelewa|foleni)\b/;
const CANCEL = /\b(cancel|cancelled|canceled|reschedule|postpone|another day|can'?t make it|cannot make it|can'?t come|cannot come|won'?t come|won'?t make it|not coming|sitakuja|sitaweza|siwezi kuja|ghairi|ahirisha|badilisha)\b/;
const NO = /^(no|nope|hapana|siwezi)\b/;
const YES = /^(yes|yeah|yep|yup|y|ok|okay|k|sure|confirm|confirmed|i confirm|i will come|i'll come|i'll be there|see you|ndiyo|ndio|naam|sawa|poa|safi|nitakuja|nakuja|nitafika|nipo|thibitisha|nimethibitisha)\b/;
const THUMBS_UP = /^\s*(👍|✅|👌|🙏)/u;

/** "LATE 15", "20 mins", "dakika 20", "an hour", "nusu saa" → minutes (or null). */
function delayMinutes(t) {
  if (/\b(half an hour|half hour|nusu saa)\b/.test(t)) return 30;
  if (/\b(an hour|one hour|1 hour|saa moja)\b/.test(t)) return 60;
  const cap = (n) => (n > 0 && n <= 600 ? n : null);
  let m = t.match(/(\d{1,3})\s*(m|min|mins|minute|minutes|dk|dak)\b/);
  if (m) return cap(Number(m[1]));
  m = t.match(/\b(dakika|dk)\s*(\d{1,3})\b/);
  if (m) return cap(Number(m[2]));
  m = t.match(/(\d{1,2}(?:\.\d)?)\s*(h|hr|hrs|hour|hours)\b/);
  if (m) return cap(Math.round(Number(m[1]) * 60));
  m = t.match(/\b(\d{1,3})\b/);
  return m ? cap(Number(m[1])) : null;
}

/** Classify a reply: { intent: 'confirmed' | 'late' | 'cancel_request' | 'stop' | 'message', minutes }. */
function classifyReply(text) {
  const t = words(text);
  if (STOP.test(t)) return { intent: 'stop', minutes: null };
  if (LATE.test(t) && !NOT_LATE.test(t)) return { intent: 'late', minutes: delayMinutes(t) };
  if (CANCEL.test(t) || NO.test(t)) return { intent: 'cancel_request', minutes: null };
  if (YES.test(t) || NOT_LATE.test(t) || THUMBS_UP.test(String(text || ''))) return { intent: 'confirmed', minutes: null };
  return { intent: 'message', minutes: null };
}

function describeDelay(minutes) {
  if (!minutes) return 'a little late';
  if (minutes >= 60 && minutes % 60 === 0) return `about ${minutes / 60} hour${minutes === 60 ? '' : 's'} late`;
  return `about ${minutes} minutes late`;
}

// ---- Finding the appointment -----------------------------------------------------------------

const APPOINTMENT_COLUMNS = `a.id, a.code, a.branch_id, a.start_time, a.status,
  e.full_name AS employee_name, e.user_id AS employee_user_id`;

async function findAppointment(customerId, contextRef) {
  if (contextRef) {
    const answered = await db.queryOne(
      `SELECT ${APPOINTMENT_COLUMNS} FROM message_logs m
       JOIN appointments a ON a.id = m.related_id JOIN employees e ON e.id = a.employee_id
       WHERE m.provider_ref = ? AND m.related_type = 'appointment' AND a.customer_id = ?
         AND a.status IN ('pending','confirmed','in_progress') LIMIT 1`,
      [contextRef, customerId],
    );
    if (answered) return answered;
  }
  // Otherwise the next appointment (or one that started within the last two hours).
  return db.queryOne(
    `SELECT ${APPOINTMENT_COLUMNS} FROM appointments a JOIN employees e ON e.id = a.employee_id
     WHERE a.customer_id = ? AND a.status IN ('pending','confirmed')
       AND a.start_time >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 HOUR)
     ORDER BY a.start_time LIMIT 1`,
    [customerId],
  );
}

// ---- Staff alerts ------------------------------------------------------------------------------

/** The front desk (appointments.update in the branch), plus the stylist when they would not see it otherwise. */
async function alertStaff({ branchId, stylistUserId }, notification) {
  await notificationService.notifyByPermission({ permission: 'appointments.update', branchId, ...notification });
  if (!stylistUserId) return;
  const covered = await db.queryOne(
    `SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id AND p.code = 'appointments.update'
     WHERE u.id = ? AND u.is_active = 1 AND (r.slug = 'super_admin' OR (p.id IS NOT NULL AND (u.branch_id = ? OR u.branch_id IS NULL)))
     LIMIT 1`,
    [stylistUserId, branchId],
  );
  if (!covered) {
    await notificationService.notifyUser(stylistUserId, { ...notification, branchId }).catch((err) => logger.error({ err }, 'Failed to notify stylist'));
  }
}

function quote(text, max = 200) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return `“${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}”`;
}

// ---- Handling a reply --------------------------------------------------------------------------

/**
 * Record one incoming WhatsApp message and act on it.
 * { provider, from: '+2557…' or '2557…', text, providerRef, contextRef }
 */
async function handleIncoming({ provider, from, text, providerRef = null, contextRef = null }) {
  const digits = String(from || '').replace(/\D/g, '');
  const body = String(text || '').trim().slice(0, 2000);
  if (!digits || !body) return { outcome: 'ignored' };
  const phone = normalizePhone(`+${digits}`);

  // WhatsApp resends a message when it is not acknowledged in time.
  if (providerRef) {
    const seen = await db.queryOne("SELECT id FROM message_logs WHERE provider_ref = ? AND direction = 'inbound' LIMIT 1", [providerRef]);
    if (seen) return { outcome: 'duplicate' };
  }

  const customer = await db.queryOne(
    'SELECT id, full_name, phone, email, preferred_channel, branch_id FROM customers WHERE phone = ? AND deleted_at IS NULL LIMIT 1',
    [phone],
  );
  const { intent, minutes } = classifyReply(body);
  const appointment = customer && intent !== 'stop' ? await findAppointment(customer.id, contextRef) : null;
  const outcome = ['confirmed', 'late', 'cancel_request'].includes(intent) && !appointment ? 'message' : intent;
  const branchId = appointment?.branch_id ?? customer?.branch_id ?? null;
  const { fmtDate, fmtTime } = formats();
  const when = appointment ? { date: fmtDate(appointment.start_time), time: fmtTime(appointment.start_time) } : null;
  const system = { userId: null, branchId };

  await db.withTransaction(async (conn) => {
    await db.query(
      `INSERT INTO message_logs (branch_id, customer_id, channel, direction, provider, recipient, body, template, status, provider_ref,
                                 related_type, related_id, sent_at)
       VALUES (?, ?, 'whatsapp', 'inbound', ?, ?, ?, ?, 'received', ?, ?, ?, UTC_TIMESTAMP())`,
      [branchId, customer?.id ?? null, provider, phone, body, `incoming_${outcome}`, providerRef,
        appointment ? 'appointment' : null, appointment?.id ?? null],
      conn,
    );

    if (outcome === 'stop' && customer) {
      await db.query("UPDATE customers SET preferred_channel = 'none', marketing_opt_in = 0 WHERE id = ?", [customer.id], conn);
      await audit.record(system, {
        action: 'customer.messages_stopped', entityType: 'customer', entityId: customer.id,
        description: `${customer.full_name} replied STOP on WhatsApp: no more automatic messages`,
      }, conn);
      return;
    }
    if (!appointment || outcome === 'message') return;

    // Saying yes, or saying they will be late, both mean the customer is coming.
    const coming = outcome === 'confirmed' || outcome === 'late';
    await db.query(
      `UPDATE appointments SET customer_response = ?, customer_response_at = UTC_TIMESTAMP(), customer_delay_minutes = ?,
              customer_response_note = ?,
              confirmed_at = IF(? AND status = 'pending', UTC_TIMESTAMP(), confirmed_at),
              status = IF(? AND status = 'pending', 'confirmed', status)
       WHERE id = ?`,
      [outcome, outcome === 'late' ? minutes : null, body.slice(0, 500), coming ? 1 : 0, coming ? 1 : 0, appointment.id],
      conn,
    );
    const what = { confirmed: 'confirmed', late: `will be ${describeDelay(minutes)}`, cancel_request: 'asked to cancel or change' }[outcome];
    await audit.record(system, {
      action: 'appointment.customer_replied', entityType: 'appointment', entityId: appointment.id,
      description: `${customer.full_name} replied on WhatsApp about ${appointment.code}: ${what}`,
    }, conn);

    // Let the customer know the reply arrived (free-form text is allowed for
    // 24 hours after the customer writes, so no approved template is needed).
    const ackEvent = { confirmed: 'reply_confirmed', late: 'reply_late', cancel_request: 'reply_received' }[outcome];
    const template = settings.get('notifications.templates')?.[ackEvent];
    if (template && customer.preferred_channel !== 'none') {
      await messaging.enqueue({
        channel: 'whatsapp',
        recipient: customer.phone,
        body: messaging.renderTemplate(template, {
          salon_name: settings.get('business.salon_name'),
          customer_name: customer.full_name.split(' ')[0],
          stylist: appointment.employee_name.split(' ')[0],
          code: appointment.code,
          delay: describeDelay(minutes),
          ...when,
        }),
        template: ackEvent,
        customerId: customer.id,
        branchId,
        relatedType: 'appointment',
        relatedId: appointment.id,
      }, conn);
    }
  });

  // Alerts for the people who need to act (after the reply is saved).
  const name = customer?.full_name || phone;
  const target = { branchId, stylistUserId: appointment?.employee_user_id ?? null };
  const link = appointment ? `/appointments?appointment=${appointment.id}` : customer ? `/customers/${customer.id}` : '/notifications?tab=messages';
  try {
    if (outcome === 'late') {
      await alertStaff(target, {
        type: 'appointment.customer_late', category: 'appointment', link,
        title: `Running late: ${name}`,
        message: `${name} will be ${describeDelay(minutes)} for ${appointment.code} at ${when.time} with ${appointment.employee_name.split(' ')[0]}.`,
      });
    } else if (outcome === 'cancel_request') {
      await alertStaff(target, {
        type: 'appointment.customer_cancel_request', category: 'appointment', link,
        title: `Wants to cancel or change: ${name}`,
        message: `${name} replied about ${appointment.code} on ${when.date} at ${when.time}: ${quote(body)}. Please call ${customer.phone}.`,
      });
    } else if (outcome === 'message') {
      await alertStaff({ ...target, stylistUserId: null }, {
        type: 'customer.whatsapp_message', category: 'customer', link,
        title: `WhatsApp message from ${name}`,
        message: `${quote(body)}${appointment ? ` — about ${appointment.code} on ${when.date} at ${when.time}` : ''}${customer ? '' : ' (not a registered customer)'}`,
      });
    }
  } catch (err) {
    logger.error({ err }, 'Failed to alert staff about a WhatsApp reply');
  }
  return { outcome, customerId: customer?.id ?? null, appointmentId: appointment?.id ?? null };
}

/** Delivery report from WhatsApp: a message we sent could not be delivered. */
async function handleStatus({ providerRef, status, error }) {
  if (!providerRef || status !== 'failed') return;
  await db.query(
    "UPDATE message_logs SET status = 'failed', last_error = ? WHERE provider_ref = ? AND direction = 'outbound'",
    [String(error || 'WhatsApp could not deliver this message').slice(0, 500), providerRef],
  );
}

// ---- Provider payloads -------------------------------------------------------------------------

/** Meta Cloud API webhook body → { messages, statuses }. */
function fromMeta(payload) {
  const messages = [];
  const statuses = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      for (const m of value.messages || []) {
        let text;
        let contextRef = m.context?.id || null;
        if (m.type === 'text') text = m.text?.body;
        else if (m.type === 'button') text = m.button?.text || m.button?.payload;
        else if (m.type === 'interactive') text = m.interactive?.button_reply?.title || m.interactive?.list_reply?.title;
        else if (m.type === 'reaction') {
          text = m.reaction?.emoji;
          contextRef = m.reaction?.message_id || contextRef;
        } else text = `(${String(m.type || 'unknown').replace(/_/g, ' ')} message)`;
        messages.push({ provider: 'meta_cloud', from: m.from, text, providerRef: m.id, contextRef });
      }
      for (const s of value.statuses || []) {
        const e = s.errors?.[0];
        statuses.push({ providerRef: s.id, status: s.status, error: e ? `${e.title || 'Error'}${e.code ? ` (${e.code})` : ''}${e.error_data?.details ? `: ${e.error_data.details}` : ''}` : null });
      }
    }
  }
  return { messages, statuses };
}

/** Twilio incoming-message form fields → { messages, statuses }. */
function fromTwilio(form) {
  const from = String(form?.From || '').replace(/^whatsapp:/, '');
  const text = form?.ButtonText || form?.Body || (Number(form?.NumMedia) > 0 ? '(media message)' : '');
  if (!from || !text) return { messages: [], statuses: [] };
  return {
    messages: [{ provider: 'twilio', from, text, providerRef: form.MessageSid || form.SmsSid || null, contextRef: form.OriginalRepliedMessageSid || null }],
    statuses: [],
  };
}

module.exports = { classifyReply, delayMinutes, describeDelay, handleIncoming, handleStatus, fromMeta, fromTwilio };
