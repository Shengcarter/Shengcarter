'use strict';

const db = require('../config/database');
const { camelizeRow, camelizeRows } = require('../utils/case');
const { getPaging, getSort, paginate } = require('../utils/pagination');
const { contains, startsWith } = require('../utils/sql');

/** Data access for employees and their schedules / service assignments. */
const COLUMNS = `e.id, e.code, e.branch_id, e.user_id, e.full_name, e.photo, e.phone, e.email, e.address, e.job_title,
  e.employment_date, e.salary, e.commission_rate, e.status, e.is_bookable, e.calendar_color, e.notes, e.is_demo,
  e.created_at, e.updated_at, b.name AS branch_name, u.email AS user_email, r.name AS user_role`;

const JOINS = `FROM employees e
  JOIN branches b ON b.id = e.branch_id
  LEFT JOIN users u ON u.id = e.user_id
  LEFT JOIN roles r ON r.id = u.role_id`;

const SORTS = { name: 'e.full_name', code: 'e.code', employmentDate: 'e.employment_date', jobTitle: 'e.job_title', createdAt: 'e.created_at' };

async function list(filters) {
  const where = ['e.branch_id = ?'];
  const params = [filters.branchId];
  if (filters.search) {
    where.push('(e.full_name LIKE ? OR e.code LIKE ? OR e.phone LIKE ? OR e.job_title LIKE ?)');
    params.push(contains(filters.search), startsWith(filters.search), contains(filters.search), contains(filters.search));
  }
  if (filters.status) {
    where.push('e.status = ?');
    params.push(filters.status);
  } else {
    where.push("e.status <> 'terminated'");
  }
  if (filters.bookable !== undefined) {
    where.push('e.is_bookable = ?');
    params.push(filters.bookable ? 1 : 0);
  }
  const result = await paginate({
    select: `${COLUMNS}, (SELECT COUNT(*) FROM employee_services es WHERE es.employee_id = e.id) AS service_count`,
    from: `${JOINS} WHERE ${where.join(' AND ')}`,
    params,
    orderBy: getSort(filters.sortBy, filters.sortOrder || 'asc', SORTS, 'name'),
    paging: getPaging(filters),
  });
  return { ...result, rows: camelizeRows(result.rows) };
}

async function findById(id, conn) {
  const row = await db.queryOne(`SELECT ${COLUMNS} ${JOINS} WHERE e.id = ?`, [id], conn);
  return row ? camelizeRow(row) : null;
}

/** Lightweight list for dropdowns and the booking calendar. */
async function options(branchId, { bookableOnly = false, includeInactive = false } = {}) {
  const rows = await db.query(
    `SELECT e.id, e.code, e.full_name, e.job_title, e.calendar_color, e.is_bookable, e.status, e.photo, e.user_id, e.commission_rate
     FROM employees e
     WHERE e.branch_id = ? ${includeInactive ? "AND e.status <> 'terminated'" : "AND e.status = 'active'"} ${bookableOnly ? 'AND e.is_bookable = 1' : ''}
     ORDER BY e.full_name`,
    [branchId],
  );
  const services = rows.length
    ? await db.query('SELECT employee_id, service_id FROM employee_services WHERE employee_id IN (?)', [rows.map((r) => r.id)])
    : [];
  return camelizeRows(rows).map((e) => ({ ...e, serviceIds: services.filter((s) => s.employee_id === e.id).map((s) => s.service_id) }));
}

const WRITABLE = {
  fullName: 'full_name',
  phone: 'phone',
  email: 'email',
  address: 'address',
  jobTitle: 'job_title',
  employmentDate: 'employment_date',
  salary: 'salary',
  commissionRate: 'commission_rate',
  status: 'status',
  isBookable: 'is_bookable',
  calendarColor: 'calendar_color',
  notes: 'notes',
  photo: 'photo',
  branchId: 'branch_id',
};

function toColumns(data) {
  const columns = [];
  const values = [];
  for (const [key, column] of Object.entries(WRITABLE)) {
    if (data[key] === undefined) continue;
    columns.push(column);
    values.push(typeof data[key] === 'boolean' ? Number(data[key]) : data[key]);
  }
  return { columns, values };
}

async function insert(data, conn) {
  const { columns, values } = toColumns(data);
  const result = await db.query(
    `INSERT INTO employees (code, ${columns.join(', ')}) VALUES (?, ${columns.map(() => '?').join(', ')})`,
    [data.code, ...values],
    conn,
  );
  return result.insertId;
}

async function update(id, data, conn) {
  const { columns, values } = toColumns(data);
  if (!columns.length) return;
  await db.query(`UPDATE employees SET ${columns.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...values, id], conn);
}

async function getSchedule(employeeId) {
  return camelizeRows(
    await db.query('SELECT day_of_week, start_time, end_time, is_working FROM employee_schedules WHERE employee_id = ? ORDER BY day_of_week', [employeeId]),
    ['is_working'],
  ).map((d) => ({ ...d, startTime: d.startTime.slice(0, 5), endTime: d.endTime.slice(0, 5) }));
}

async function replaceSchedule(employeeId, days, conn) {
  await db.query('DELETE FROM employee_schedules WHERE employee_id = ?', [employeeId], conn);
  if (!days.length) return;
  await db.query(
    'INSERT INTO employee_schedules (employee_id, day_of_week, start_time, end_time, is_working) VALUES ?',
    [days.map((d) => [employeeId, d.dayOfWeek, d.startTime, d.endTime, d.isWorking ? 1 : 0])],
    conn,
  );
}

async function getServiceIds(employeeId) {
  return (await db.query('SELECT service_id FROM employee_services WHERE employee_id = ?', [employeeId])).map((r) => r.service_id);
}

async function replaceServices(employeeId, serviceIds, conn) {
  await db.query('DELETE FROM employee_services WHERE employee_id = ?', [employeeId], conn);
  if (serviceIds.length) {
    await db.query('INSERT INTO employee_services (employee_id, service_id) VALUES ?', [serviceIds.map((sid) => [employeeId, sid])], conn);
  }
}

async function historyCount(employeeId) {
  const row = await db.queryOne(
    `SELECT (SELECT COUNT(*) FROM appointments WHERE employee_id = ?)
          + (SELECT COUNT(*) FROM sale_items WHERE employee_id = ?)
          + (SELECT COUNT(*) FROM attendance WHERE employee_id = ?)
          + (SELECT COUNT(*) FROM salary_records WHERE employee_id = ?) AS total`,
    [employeeId, employeeId, employeeId, employeeId],
  );
  return Number(row.total);
}

module.exports = {
  list,
  findById,
  options,
  insert,
  update,
  getSchedule,
  replaceSchedule,
  getServiceIds,
  replaceServices,
  historyCount,
};
