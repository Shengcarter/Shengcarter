'use strict';

const { DateTime } = require('luxon');
const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { camelizeRows } = require('../utils/case');
const { getPaging, paginate } = require('../utils/pagination');
const { contains } = require('../utils/sql');
const messaging = require('./messaging');
const settings = require('./settingsService');
const audit = require('./auditService');
const { todayLocal } = require('../utils/time');

const MAX_RECIPIENTS = 2000;

async function list(filters) {
  const where = ['1=1'];
  const params = [];
  if (filters.channel) {
    where.push('m.channel = ?');
    params.push(filters.channel);
  }
  if (filters.status) {
    where.push('m.status = ?');
    params.push(filters.status);
  }
  if (filters.direction) {
    where.push('m.direction = ?');
    params.push(filters.direction);
  }
  if (filters.customerId) {
    where.push('m.customer_id = ?');
    params.push(filters.customerId);
  }
  if (filters.search) {
    where.push('(m.recipient LIKE ? OR c.full_name LIKE ? OR m.body LIKE ?)');
    params.push(contains(filters.search), contains(filters.search), contains(filters.search));
  }
  const result = await paginate({
    select: `m.id, m.channel, m.direction, m.provider, m.recipient, m.subject, m.body, m.template, m.status, m.attempts,
             m.last_error, m.sent_at, m.scheduled_at, m.created_at, m.related_type, m.related_id,
             c.id AS customer_id, c.full_name AS customer_name`,
    from: `FROM message_logs m LEFT JOIN customers c ON c.id = m.customer_id WHERE ${where.join(' AND ')}`,
    params,
    orderBy: 'm.created_at DESC, m.id DESC',
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows) };
}

async function resolveAudience({ audience, customerIds, tierId, channel, inactiveDays = 60 }) {
  const contactColumn = channel === 'email' ? 'c.email' : 'c.phone';
  const where = ['c.deleted_at IS NULL', `${contactColumn} IS NOT NULL`, `${contactColumn} <> ''`];
  const params = [];

  if (audience === 'selected') {
    if (!customerIds?.length) throw ApiError.validation([{ field: 'customerIds', message: 'Choose at least one customer' }]);
    where.push('c.id IN (?)');
    params.push(customerIds);
  } else {
    // Promotions only go to customers who agreed to marketing messages.
    where.push('c.marketing_opt_in = 1');
    if (audience === 'inactive') {
      // Win-back: customers who have visited before but not recently.
      where.push('c.visit_count >= 1', 'c.last_visit_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)');
      params.push(inactiveDays);
    } else if (audience === 'birthday') {
      const today = DateTime.fromISO(todayLocal());
      where.push("DATE_FORMAT(c.date_of_birth, '%m-%d') IN (?)");
      params.push(Array.from({ length: 7 }, (_, i) => today.plus({ days: i }).toFormat('MM-dd')));
    }
    if (audience === 'tier') {
      const tier = await db.queryOne('SELECT min_points FROM loyalty_tiers WHERE id = ?', [tierId]);
      if (!tier) throw ApiError.validation([{ field: 'tierId', message: 'Choose a loyalty tier' }]);
      const next = await db.queryOne('SELECT MIN(min_points) AS next FROM loyalty_tiers WHERE min_points > ?', [tier.min_points]);
      where.push('c.lifetime_points >= ?');
      params.push(tier.min_points);
      if (next?.next !== null && next?.next !== undefined) {
        where.push('c.lifetime_points < ?');
        params.push(next.next);
      }
    }
  }
  return db.query(
    `SELECT c.id, c.full_name, c.phone, c.email, c.branch_id FROM customers c WHERE ${where.join(' AND ')} LIMIT ${MAX_RECIPIENTS + 1}`,
    params,
  );
}

/** Queue a message (or promotion) to one or many customers. */
async function send(data, ctx) {
  const customers = await resolveAudience(data);
  if (!customers.length) throw ApiError.badRequest('No customers match this audience with a valid contact for the chosen channel');
  if (customers.length > MAX_RECIPIENTS) throw ApiError.badRequest(`A single send is limited to ${MAX_RECIPIENTS} recipients`);

  const salonName = settings.get('business.salon_name');
  const count = await db.withTransaction(async (conn) => {
    for (const customer of customers) {
      const firstName = customer.full_name.split(' ')[0];
      const body = messaging.renderTemplate(data.message, { customer_name: firstName, full_name: customer.full_name, salon_name: salonName });
      await messaging.enqueue({
        channel: data.channel,
        recipient: data.channel === 'email' ? customer.email : customer.phone,
        subject: data.channel === 'email' ? data.subject || `News from ${salonName}` : null,
        body,
        template: data.audience === 'selected' ? 'manual' : 'promotion',
        customerId: customer.id,
        branchId: ctx.branchId,
        createdBy: ctx.userId,
      }, conn);
    }
    await audit.record(ctx, {
      action: data.audience === 'selected' ? 'message.sent' : 'message.promotion_sent',
      entityType: 'message',
      description: `Queued ${customers.length} ${data.channel} message(s)`,
      metadata: { audience: data.audience, channel: data.channel, recipients: customers.length },
    }, conn);
    return customers.length;
  });
  return { queued: count };
}

async function retry(id, ctx) {
  const result = await db.query(
    "UPDATE message_logs SET status = 'queued', attempts = 0, scheduled_at = UTC_TIMESTAMP(), last_error = NULL WHERE id = ? AND status = 'failed'",
    [id],
  );
  if (!result.affectedRows) throw ApiError.badRequest('Only failed messages can be retried');
  await audit.record(ctx, { action: 'message.retried', entityType: 'message', entityId: id, description: 'Retried failed message' });
}

async function stats() {
  const rows = await db.query(
    `SELECT status, COUNT(*) AS total FROM message_logs
     WHERE created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) GROUP BY status`,
  );
  return Object.fromEntries(rows.map((r) => [r.status, Number(r.total)]));
}

module.exports = { list, send, retry, stats };
