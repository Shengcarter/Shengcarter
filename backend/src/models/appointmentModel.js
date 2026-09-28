'use strict';

const db = require('../config/database');
const { camelizeRow, camelizeRows } = require('../utils/case');
const { getPaging, getSort, paginate } = require('../utils/pagination');
const { contains, startsWith } = require('../utils/sql');

/** Statuses that occupy the stylist's time (everything except cancelled / no-show). */
const BLOCKING_EXCLUDED = ['cancelled', 'no_show'];

const LIST_COLUMNS = `a.id, a.code, a.branch_id, a.customer_id, a.employee_id, a.start_time, a.end_time, a.status, a.source,
  a.notes, a.total_price, a.total_duration, a.checked_in_at, a.created_at,
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
    where.push('e.user_id = ?');
    params.push(filters.ownUserId);
  }
  if (filters.employeeId) {
    where.push('a.employee_id = ?');
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

/** Every appointment in a time range (calendar views). */
async function listRange(filters) {
  const where = ['a.start_time < ?', 'a.end_time > ?'];
  const params = [filters.end, filters.start];
  scopeFilters(filters, where, params);
  const rows = await db.query(`SELECT ${LIST_COLUMNS} ${LIST_JOINS} WHERE ${where.join(' AND ')} ORDER BY a.start_time LIMIT 2000`, params);
  return camelizeRows(rows);
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
  return { ...result, rows: camelizeRows(result.rows) };
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
  return { ...camelizeRow(row), services: camelizeRows(services) };
}

async function findByToken(token, conn) {
  return db.queryOne('SELECT id FROM appointments WHERE qr_token = ?', [token], conn);
}

/** First overlapping appointment for an employee (buffer minutes on both sides). */
async function findEmployeeConflict(conn, { employeeId, start, end, excludeId = 0, bufferMinutes = 0 }) {
  return db.queryOne(
    `SELECT id, code, start_time, end_time FROM appointments
     WHERE employee_id = ? AND id <> ? AND status NOT IN (?)
       AND start_time < DATE_ADD(?, INTERVAL ? MINUTE) AND DATE_ADD(end_time, INTERVAL ? MINUTE) > ?
     ORDER BY start_time LIMIT 1`,
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
    `SELECT id, code, start_time, end_time FROM appointments
     WHERE employee_id = ? AND id <> ? AND status NOT IN (?) AND start_time < ? AND end_time > ?
     ORDER BY start_time`,
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

module.exports = {
  BLOCKING_EXCLUDED,
  listRange,
  listPaged,
  findById,
  findByToken,
  findEmployeeConflict,
  findCustomerConflict,
  busyIntervals,
  insert,
  replaceServices,
};
