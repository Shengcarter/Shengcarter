'use strict';

const db = require('../config/database');
const { camelizeRow, camelizeRows } = require('../utils/case');
const { getPaging, getSort, paginate } = require('../utils/pagination');
const { contains, startsWith } = require('../utils/sql');

/** Statuses that occupy the stylist's time (everything except cancelled / no-show). */
const BLOCKING_EXCLUDED = ['cancelled', 'no_show'];

/**
 * An appointment can have several staff members (appointment_staff). The
 * first one is the lead and is also stored in appointments.employee_id.
 */
const MEMBER_OF = (alias = 'a') => `EXISTS (SELECT 1 FROM appointment_staff ast WHERE ast.appointment_id = ${alias}.id AND ast.employee_id = ?)`;

const LIST_COLUMNS = `a.id, a.code, a.branch_id, a.customer_id, a.employee_id, a.start_time, a.end_time, a.status, a.source,
  a.notes, a.total_price, a.total_duration, a.checked_in_at, a.created_at,
  a.customer_response, a.customer_response_at, a.customer_delay_minutes,
  c.full_name AS customer_name, c.phone AS customer_phone, c.code AS customer_code,
  e.full_name AS employee_name, e.calendar_color AS employee_color,
  (SELECT GROUP_CONCAT(aps.service_name ORDER BY aps.sort_order SEPARATOR ', ') FROM appointment_services aps WHERE aps.appointment_id = a.id) AS services,
  (SELECT s.id FROM sales s WHERE s.appointment_id = a.id AND s.status = 'completed' LIMIT 1) AS sale_id`;

const LIST_JOINS = `FROM appointments a
  JOIN customers c ON c.id = a.customer_id
  JOIN employees e ON e.id = a.employee_id`;

function scopeFilters(filters, where, params) {
  where.push('a.branch_id = ?');
  params.push(filters.branchId);
  if (filters.ownUserId) {
    // A stylist sees every appointment they are part of, not only the ones they lead.
    where.push(`EXISTS (SELECT 1 FROM appointment_staff ast JOIN employees se ON se.id = ast.employee_id
                        WHERE ast.appointment_id = a.id AND se.user_id = ?)`);
    params.push(filters.ownUserId);
  }
  if (filters.employeeId) {
    where.push(MEMBER_OF());
    params.push(filters.employeeId);
  }
  if (filters.customerId) {
    where.push('a.customer_id = ?');
    params.push(filters.customerId);
  }
  if (filters.status) {
    where.push('a.status IN (?)');
    params.push(String(filters.status).split(','));
  }
}

/** Staff of several appointments: Map(appointmentId → [{ id, fullName, color, userId, jobTitle }]) in team order. */
async function staffFor(appointmentIds, conn) {
  const map = new Map();
  if (!appointmentIds.length) return map;
  const rows = await db.query(
    `SELECT ast.appointment_id, e.id, e.full_name, e.calendar_color, e.user_id, e.job_title
     FROM appointment_staff ast JOIN employees e ON e.id = ast.employee_id
     WHERE ast.appointment_id IN (?) ORDER BY ast.appointment_id, ast.sort_order, e.full_name`,
    [appointmentIds],
    conn,
  );
  for (const r of rows) {
    if (!map.has(r.appointment_id)) map.set(r.appointment_id, []);
    map.get(r.appointment_id).push({ id: r.id, fullName: r.full_name, color: r.calendar_color, userId: r.user_id, jobTitle: r.job_title });
  }
  return map;
}

async function withStaff(rows, conn) {
  const staff = await staffFor(rows.map((r) => r.id), conn);
  return rows.map((r) => ({ ...r, staff: staff.get(r.id) || [] }));
}

/** Every appointment in a time range (calendar views). */
async function listRange(filters) {
  const where = ['a.start_time < ?', 'a.end_time > ?'];
  const params = [filters.end, filters.start];
  scopeFilters(filters, where, params);
  const rows = await db.query(`SELECT ${LIST_COLUMNS} ${LIST_JOINS} WHERE ${where.join(' AND ')} ORDER BY a.start_time LIMIT 2000`, params);
  return withStaff(camelizeRows(rows));
}

const SORTS = { startTime: 'a.start_time', createdAt: 'a.created_at', customer: 'c.full_name', status: 'a.status' };

/** Paginated list view with search. */
async function listPaged(filters) {
  const where = [];
  const params = [];
  scopeFilters(filters, where, params);
  if (filters.start) {
    where.push('a.start_time >= ?');
    params.push(filters.start);
  }
  if (filters.end) {
    where.push('a.start_time < ?');
    params.push(filters.end);
  }
  if (filters.search) {
    where.push('(a.code LIKE ? OR c.full_name LIKE ? OR c.phone LIKE ?)');
    params.push(startsWith(filters.search), contains(filters.search), contains(filters.search));
  }
  const result = await paginate({
    select: LIST_COLUMNS,
    from: `${LIST_JOINS} WHERE ${where.join(' AND ')}`,
    params,
    orderBy: getSort(filters.sortBy, filters.sortOrder, SORTS, 'startTime'),
    paging: getPaging(filters),
  });
  return { ...result, rows: await withStaff(camelizeRows(result.rows)) };
}

async function findById(id, conn) {
  const row = await db.queryOne(
    `SELECT a.*, c.full_name AS customer_name, c.phone AS customer_phone, c.email AS customer_email, c.code AS customer_code,
            c.notes AS customer_notes, c.photo AS customer_photo, c.loyalty_points AS customer_loyalty_points,
            c.lifetime_points AS customer_lifetime_points, c.preferred_channel AS customer_preferred_channel,
            e.full_name AS employee_name, e.calendar_color AS employee_color, e.user_id AS employee_user_id, e.photo AS employee_photo,
            b.name AS branch_name, cu.full_name AS created_by_name, ci.full_name AS checked_in_by_name, cb.full_name AS cancelled_by_name,
            (SELECT s.id FROM sales s WHERE s.appointment_id = a.id AND s.status = 'completed' LIMIT 1) AS sale_id
     FROM appointments a
     JOIN customers c ON c.id = a.customer_id
     JOIN employees e ON e.id = a.employee_id
     JOIN branches b ON b.id = a.branch_id
     LEFT JOIN users cu ON cu.id = a.created_by
     LEFT JOIN users ci ON ci.id = a.checked_in_by
     LEFT JOIN users cb ON cb.id = a.cancelled_by
     WHERE a.id = ?`,
    [id],
    conn,
  );
  if (!row) return null;
  const services = await db.query(
    `SELECT aps.service_id, aps.service_name, aps.price, aps.duration_minutes, s.commission_rate
     FROM appointment_services aps JOIN services s ON s.id = aps.service_id
     WHERE aps.appointment_id = ? ORDER BY aps.sort_order`,
    [id],
    conn,
  );
  const staff = await staffFor([id], conn);
  return { ...camelizeRow(row), services: camelizeRows(services), staff: staff.get(id) || [] };
}

async function findByToken(token, conn) {
  return db.queryOne('SELECT id FROM appointments WHERE qr_token = ?', [token], conn);
}

/** First overlapping appointment an employee is part of (buffer minutes on both sides). */
async function findEmployeeConflict(conn, { employeeId, start, end, excludeId = 0, bufferMinutes = 0 }) {
  return db.queryOne(
    `SELECT a.id, a.code, a.start_time, a.end_time FROM appointment_staff ast JOIN appointments a ON a.id = ast.appointment_id
     WHERE ast.employee_id = ? AND a.id <> ? AND a.status NOT IN (?)
       AND a.start_time < DATE_ADD(?, INTERVAL ? MINUTE) AND DATE_ADD(a.end_time, INTERVAL ? MINUTE) > ?
     ORDER BY a.start_time LIMIT 1`,
    [employeeId, excludeId, BLOCKING_EXCLUDED, end, bufferMinutes, bufferMinutes, start],
    conn,
  );
}

async function findCustomerConflict(conn, { customerId, start, end, excludeId = 0 }) {
  return db.queryOne(
    `SELECT a.id, a.code, a.start_time, e.full_name AS employee_name FROM appointments a JOIN employees e ON e.id = a.employee_id
     WHERE a.customer_id = ? AND a.id <> ? AND a.status NOT IN (?) AND a.start_time < ? AND a.end_time > ?
     LIMIT 1`,
    [customerId, excludeId, BLOCKING_EXCLUDED, end, start],
    conn,
  );
}

/** Busy intervals of one employee between two instants (for availability). */
async function busyIntervals(employeeId, start, end, excludeId = 0) {
  return db.query(
    `SELECT a.id, a.code, a.start_time, a.end_time FROM appointment_staff ast JOIN appointments a ON a.id = ast.appointment_id
     WHERE ast.employee_id = ? AND a.id <> ? AND a.status NOT IN (?) AND a.start_time < ? AND a.end_time > ?
     ORDER BY a.start_time`,
    [employeeId, excludeId, BLOCKING_EXCLUDED, end, start],
  );
}

async function insert(conn, data) {
  const result = await db.query(
    `INSERT INTO appointments (code, branch_id, customer_id, employee_id, start_time, end_time, status, source, notes,
                               total_price, total_duration, qr_token, confirmed_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [data.code, data.branchId, data.customerId, data.employeeId, data.start, data.end, data.status, data.source, data.notes || null,
      data.totalPrice, data.totalDuration, data.qrToken, data.status === 'confirmed' ? new Date() : null, data.createdBy],
    conn,
  );
  return result.insertId;
}

async function replaceServices(conn, appointmentId, services) {
  await db.query('DELETE FROM appointment_services WHERE appointment_id = ?', [appointmentId], conn);
  await db.query(
    'INSERT INTO appointment_services (appointment_id, service_id, service_name, price, duration_minutes, sort_order) VALUES ?',
    [services.map((s, i) => [appointmentId, s.id, s.name, s.price, s.duration_minutes, i])],
    conn,
  );
}

/** Set the appointment's team; employeeIds[0] is the lead. */
async function replaceStaff(conn, appointmentId, employeeIds) {
  await db.query('DELETE FROM appointment_staff WHERE appointment_id = ?', [appointmentId], conn);
  await db.query(
    'INSERT INTO appointment_staff (appointment_id, employee_id, sort_order) VALUES ?',
    [employeeIds.map((employeeId, i) => [appointmentId, employeeId, i])],
    conn,
  );
}

module.exports = {
  BLOCKING_EXCLUDED,
  staffFor,
  listRange,
  listPaged,
  findById,
  findByToken,
  findEmployeeConflict,
  findCustomerConflict,
  busyIntervals,
  insert,
  replaceServices,
  replaceStaff,
};
