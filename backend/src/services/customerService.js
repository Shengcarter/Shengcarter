'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { camelizeRows } = require('../utils/case');
const { normalizePhone } = require('../utils/phone');
const { nextCode } = require('../utils/sequence');
const { getPaging, paginate } = require('../utils/pagination');
const customerModel = require('../models/customerModel');
const loyaltyService = require('./loyaltyService');
const notificationService = require('./notificationService');
const audit = require('./auditService');

const COUNTRY_CODE = '255';

async function withTier(customer) {
  const loyalty = await loyaltyService.tierFor(customer.lifetimePoints);
  return {
    ...customer,
    tier: loyalty.tier ? { id: loyalty.tier.id, name: loyalty.tier.name, color: loyalty.tier.color } : null,
  };
}

async function list(filters) {
  const result = await customerModel.list(filters);
  const tiers = await loyaltyService.getTiers();
  const rows = result.rows.map((c) => {
    let tier = null;
    for (const t of tiers) if (c.lifetimePoints >= t.minPoints) tier = t;
    return { ...c, tier: tier ? { id: tier.id, name: tier.name, color: tier.color } : null };
  });
  return { ...result, rows };
}

async function getById(id) {
  const customer = await customerModel.findById(id);
  if (!customer) throw ApiError.notFound('Customer not found');
  return customer;
}

async function assertPhoneAvailable(phone, excludeId) {
  const existing = await customerModel.findByPhone(phone, excludeId);
  if (existing) {
    throw ApiError.validation([{ field: 'phone', message: `This phone number belongs to ${existing.full_name} (${existing.code})` }]);
  }
}

async function create(data, ctx) {
  const phone = normalizePhone(data.phone, COUNTRY_CODE);
  await assertPhoneAvailable(phone);

  const id = await db.withTransaction(async (conn) => {
    const code = await nextCode(conn, 'customer', 'CUS-', 6);
    const customerId = await customerModel.insert({ ...data, phone, code, branchId: ctx.branchId, createdBy: ctx.userId }, conn);
    await audit.record(ctx, { action: 'customer.created', entityType: 'customer', entityId: customerId, description: `Registered customer ${data.fullName} (${code})` }, conn);
    return customerId;
  });

  await notificationService.notifyByPermission({
    permission: 'users.manage',
    branchId: ctx.branchId,
    type: 'customer.created',
    category: 'customer',
    title: 'New customer registered',
    message: `${data.fullName} was registered by ${ctx.user?.fullName || 'a staff member'}.`,
    link: `/customers/${id}`,
  });
  return withTier(await getById(id));
}

async function update(id, data, ctx) {
  const existing = await getById(id);
  const changes = { ...data };
  if (data.phone) {
    changes.phone = normalizePhone(data.phone, COUNTRY_CODE);
    if (changes.phone !== existing.phone) await assertPhoneAvailable(changes.phone, id);
  }
  await db.withTransaction(async (conn) => {
    await customerModel.update(id, changes, conn);
    await audit.record(ctx, {
      action: 'customer.updated', entityType: 'customer', entityId: id,
      description: `Updated customer ${existing.fullName}`, metadata: { fields: Object.keys(data) },
    }, conn);
  });
  return withTier(await getById(id));
}

/**
 * Customers with history (appointments or sales) are archived (soft-deleted)
 * so financial records stay intact; customers without history are removed.
 */
async function remove(id, ctx) {
  const customer = await getById(id);
  const counts = await customerModel.historyCounts(id);
  const hasHistory = Number(counts.appointments) + Number(counts.sales) > 0;
  await db.withTransaction(async (conn) => {
    if (hasHistory) {
      const upcoming = await db.queryOne(
        "SELECT COUNT(*) AS total FROM appointments WHERE customer_id = ? AND start_time > UTC_TIMESTAMP() AND status IN ('pending','confirmed')",
        [id],
        conn,
      );
      if (Number(upcoming.total) > 0) throw ApiError.conflict('This customer has upcoming appointments. Cancel them first.');
      await customerModel.softDelete(id, conn);
    } else {
      await customerModel.hardDelete(id, conn);
    }
    await audit.record(ctx, {
      action: 'customer.deleted', entityType: 'customer', entityId: id,
      description: `${hasHistory ? 'Archived' : 'Deleted'} customer ${customer.fullName} (${customer.code})`,
    }, conn);
  });
  return { archived: hasHistory };
}

/** Full profile with visit statistics, loyalty tier and upcoming appointment. */
async function getProfile(id) {
  const customer = await withTier(await getById(id));
  const [stats, upcoming, favourite, outstanding] = await Promise.all([
    db.queryOne(
      `SELECT COUNT(*) AS appointments,
              SUM(status = 'completed') AS completed,
              SUM(status = 'cancelled') AS cancelled,
              SUM(status = 'no_show') AS no_shows
       FROM appointments WHERE customer_id = ?`,
      [id],
    ),
    db.queryOne(
      `SELECT a.id, a.code, a.start_time, a.status, e.full_name AS employee_name
       FROM appointments a JOIN employees e ON e.id = a.employee_id
       WHERE a.customer_id = ? AND a.start_time >= UTC_TIMESTAMP() AND a.status IN ('pending','confirmed')
       ORDER BY a.start_time LIMIT 1`,
      [id],
    ),
    db.queryOne(
      `SELECT si.description AS name, COUNT(*) AS times
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.customer_id = ? AND s.status = 'completed' AND si.item_type = 'service'
       GROUP BY si.description ORDER BY times DESC LIMIT 1`,
      [id],
    ),
    db.queryOne("SELECT COALESCE(SUM(balance_due), 0) AS balance FROM sales WHERE customer_id = ? AND status = 'completed'", [id]),
  ]);
  const loyalty = await loyaltyService.tierFor(customer.lifetimePoints);

  return {
    ...customer,
    stats: {
      appointments: Number(stats.appointments || 0),
      completedAppointments: Number(stats.completed || 0),
      cancelledAppointments: Number(stats.cancelled || 0),
      noShows: Number(stats.no_shows || 0),
      averageSpend: customer.visitCount ? Number((customer.totalSpent / customer.visitCount).toFixed(2)) : 0,
      favouriteService: favourite?.name || null,
      outstandingBalance: Number(outstanding.balance || 0),
    },
    loyalty: {
      points: customer.loyaltyPoints,
      lifetimePoints: customer.lifetimePoints,
      nextTier: loyalty.nextTier ? { name: loyalty.nextTier.name, minPoints: loyalty.nextTier.minPoints } : null,
      pointsToNext: loyalty.pointsToNext,
      redeemValue: loyaltyService.config().redeemValuePerPoint,
      minRedeemPoints: loyaltyService.config().minRedeemPoints,
    },
    upcomingAppointment: upcoming
      ? { id: upcoming.id, code: upcoming.code, startTime: upcoming.start_time, status: upcoming.status, employeeName: upcoming.employee_name }
      : null,
  };
}

async function appointmentHistory(id, filters) {
  await getById(id);
  const result = await paginate({
    select: `a.id, a.code, a.start_time, a.end_time, a.status, a.total_price, a.notes, a.checked_in_at,
             e.full_name AS employee_name, b.name AS branch_name,
             (SELECT GROUP_CONCAT(aps.service_name ORDER BY aps.sort_order SEPARATOR ', ')
              FROM appointment_services aps WHERE aps.appointment_id = a.id) AS services`,
    from: `FROM appointments a JOIN employees e ON e.id = a.employee_id JOIN branches b ON b.id = a.branch_id WHERE a.customer_id = ?`,
    params: [id],
    orderBy: 'a.start_time DESC',
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows) };
}

/** Purchase history: sales with their line items (services and products). */
async function purchaseHistory(id, filters) {
  await getById(id);
  const result = await paginate({
    select: `s.id, s.invoice_number, s.receipt_number, s.sold_at, s.total, s.amount_paid, s.balance_due, s.status,
             s.payment_status, s.discount_amount, s.loyalty_points_earned, s.loyalty_points_redeemed, b.name AS branch_name`,
    from: 'FROM sales s JOIN branches b ON b.id = s.branch_id WHERE s.customer_id = ?',
    params: [id],
    orderBy: 's.sold_at DESC',
    paging: getPaging(filters),
  });
  const rows = camelizeRows(result.rows);
  if (rows.length) {
    const items = await db.query(
      `SELECT si.sale_id, si.item_type, si.description, si.quantity, si.unit_price, si.line_total, e.full_name AS employee_name
       FROM sale_items si LEFT JOIN employees e ON e.id = si.employee_id WHERE si.sale_id IN (?) ORDER BY si.id`,
      [rows.map((r) => r.id)],
    );
    for (const row of rows) row.items = camelizeRows(items.filter((i) => i.sale_id === row.id));
  }
  return { ...result, rows };
}

async function paymentHistory(id, filters) {
  await getById(id);
  const result = await paginate({
    select: 'p.id, p.method, p.type, p.amount, p.reference, p.paid_at, s.id AS sale_id, s.invoice_number, u.full_name AS received_by_name',
    from: `FROM payments p JOIN sales s ON s.id = p.sale_id LEFT JOIN users u ON u.id = p.received_by WHERE s.customer_id = ?`,
    params: [id],
    orderBy: 'p.paid_at DESC, p.id DESC',
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows) };
}

async function addNote(id, note, ctx) {
  const customer = await getById(id);
  await db.withTransaction(async (conn) => {
    await customerModel.insertNote(id, note, ctx.userId, conn);
    await audit.record(ctx, { action: 'customer.note_added', entityType: 'customer', entityId: id, description: `Added a note to ${customer.fullName}` }, conn);
  });
  return customerModel.listNotes(id);
}

async function deleteNote(id, noteId, ctx) {
  await getById(id);
  if (!(await customerModel.deleteNote(id, noteId))) throw ApiError.notFound('Note not found');
  await audit.record(ctx, { action: 'customer.note_deleted', entityType: 'customer', entityId: id, description: 'Deleted a customer note' });
}

async function updatePhoto(id, publicPath, ctx) {
  const customer = await getById(id);
  await customerModel.update(id, { photo: publicPath });
  await audit.record(ctx, { action: 'customer.updated', entityType: 'customer', entityId: id, description: `Updated photo of ${customer.fullName}` });
  return customer.photo;
}

module.exports = {
  list,
  getById,
  getProfile,
  create,
  update,
  remove,
  appointmentHistory,
  purchaseHistory,
  paymentHistory,
  listNotes: customerModel.listNotes,
  addNote,
  deleteNote,
  updatePhoto,
};
