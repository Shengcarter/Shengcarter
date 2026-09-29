'use strict';

const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { normalizePhone } = require('../utils/phone');
const { nextCode } = require('../utils/sequence');
const { localDateRange, todayLocal, sqlOffset } = require('../utils/time');
const employeeModel = require('../models/employeeModel');
const audit = require('./auditService');
const settings = require('./settingsService');

/**
 * Employee profiles, weekly schedules, service assignments and performance.
 * Employees belong to a branch; the current branch comes from req.ctx.
 */

async function getById(id, ctx) {
  const employee = await employeeModel.findById(id);
  // Employees of other branches are invisible unless the user can switch branches.
  if (!employee || (ctx && employee.branchId !== ctx.branchId && !ctx.user?.permissions?.has('branches.manage') && !ctx.user?.isSuperAdmin)) {
    throw ApiError.notFound('Employee not found');
  }
  return employee;
}

async function getProfile(id, ctx) {
  const employee = await getById(id, ctx);
  const [schedule, serviceIds] = await Promise.all([employeeModel.getSchedule(id), employeeModel.getServiceIds(id)]);
  const services = serviceIds.length
    ? await db.query('SELECT id, name, price, duration_minutes AS durationMinutes FROM services WHERE id IN (?) ORDER BY name', [serviceIds])
    : [];
  return { ...employee, schedule, services };
}

function prepare(data) {
  const out = { ...data };
  if (data.phone) out.phone = normalizePhone(data.phone);
  return out;
}

async function assertServices(serviceIds) {
  if (!serviceIds?.length) return;
  const found = await db.query('SELECT id FROM services WHERE id IN (?)', [serviceIds]);
  if (found.length !== new Set(serviceIds).size) throw ApiError.validation([{ field: 'serviceIds', message: 'One or more services do not exist' }]);
}

/** Default schedule for new staff: the business hours in Settings. */
function scheduleFromBusinessHours(businessHours) {
  return Object.entries(businessHours || {}).map(([day, hours]) => ({
    dayOfWeek: Number(day),
    startTime: hours.start,
    endTime: hours.end,
    isWorking: Boolean(hours.open),
  }));
}

async function create(data, ctx) {
  await assertServices(data.serviceIds);
  const id = await db.withTransaction(async (conn) => {
    const code = await nextCode(conn, 'employee', 'EMP-', 4);
    const employeeId = await employeeModel.insert({ ...prepare(data), code, branchId: data.branchId || ctx.branchId }, conn);
    if (data.serviceIds?.length) await employeeModel.replaceServices(employeeId, [...new Set(data.serviceIds)], conn);
    await employeeModel.replaceSchedule(employeeId, data.schedule || scheduleFromBusinessHours(settings.get('system.business_hours')), conn);
    await audit.record(ctx, { action: 'employee.created', entityType: 'employee', entityId: employeeId, description: `Added employee ${data.fullName} (${code})` }, conn);
    return employeeId;
  });
  return getProfile(id, ctx);
}

async function update(id, data, ctx) {
  const existing = await getById(id, ctx);
  await assertServices(data.serviceIds);
  if (data.branchId && data.branchId !== existing.branchId) {
    const upcoming = await db.queryOne(
      "SELECT COUNT(*) AS total FROM appointments WHERE employee_id = ? AND start_time > UTC_TIMESTAMP() AND status IN ('pending','confirmed')",
      [id],
    );
    if (Number(upcoming.total)) throw ApiError.conflict('Reassign or cancel this employee\'s upcoming appointments before moving them to another branch');
  }
  await db.withTransaction(async (conn) => {
    await employeeModel.update(id, prepare(data), conn);
    if (data.serviceIds) await employeeModel.replaceServices(id, [...new Set(data.serviceIds)], conn);
    const salaryChanged = data.salary !== undefined && Number(data.salary) !== Number(existing.salary);
    const commissionChanged = data.commissionRate !== undefined && Number(data.commissionRate) !== Number(existing.commissionRate);
    await audit.record(ctx, {
      action: 'employee.updated', entityType: 'employee', entityId: id, description: `Updated employee ${existing.fullName}`,
      metadata: {
        fields: Object.keys(data),
        ...(salaryChanged ? { salary: { from: existing.salary, to: data.salary } } : {}),
        ...(commissionChanged ? { commissionRate: { from: existing.commissionRate, to: data.commissionRate } } : {}),
      },
    }, conn);
  });
  return getProfile(id, ctx);
}

/** Employees with history are marked terminated (records are kept); others are deleted. */
async function remove(id, ctx) {
  const employee = await getById(id, ctx);
  const upcoming = await db.queryOne(
    "SELECT COUNT(*) AS total FROM appointments WHERE employee_id = ? AND start_time > UTC_TIMESTAMP() AND status IN ('pending','confirmed')",
    [id],
  );
  if (Number(upcoming.total)) throw ApiError.conflict('This employee has upcoming appointments. Reassign or cancel them first.');
  const archived = (await employeeModel.historyCount(id)) > 0;
  await db.withTransaction(async (conn) => {
    if (archived) await db.query("UPDATE employees SET status = 'terminated', is_bookable = 0 WHERE id = ?", [id], conn);
    else await db.query('DELETE FROM employees WHERE id = ?', [id], conn);
    await audit.record(ctx, {
      action: 'employee.deleted', entityType: 'employee', entityId: id,
      description: `${archived ? 'Terminated' : 'Deleted'} employee ${employee.fullName}`,
    }, conn);
  });
  return { archived };
}

async function updateSchedule(id, days, ctx) {
  const employee = await getById(id, ctx);
  await db.withTransaction(async (conn) => {
    await employeeModel.replaceSchedule(id, days, conn);
    await audit.record(ctx, { action: 'employee.schedule_updated', entityType: 'employee', entityId: id, description: `Updated work schedule of ${employee.fullName}` }, conn);
  });
  return employeeModel.getSchedule(id);
}

async function updatePhoto(id, publicPath, ctx) {
  const employee = await getById(id, ctx);
  await employeeModel.update(id, { photo: publicPath });
  await audit.record(ctx, { action: 'employee.updated', entityType: 'employee', entityId: id, description: `Updated photo of ${employee.fullName}` });
  return employee.photo;
}

/**
 * Performance statistics for a date range (business-local dates):
 * services completed, revenue generated, commission earned, customers served,
 * average service value, appointment outcomes and attendance.
 */
async function performance(id, { from, to }, ctx) {
  await getById(id, ctx);
  const end = to || todayLocal();
  const start = from || end.slice(0, 8) + '01';
  const range = localDateRange(start, end);
  const offset = sqlOffset();

  const [sales, commission, appointments, attendance, daily, topServices] = await Promise.all([
    db.queryOne(
      `SELECT COUNT(*) AS services_completed, COALESCE(SUM(si.net_amount), 0) AS revenue,
              COUNT(DISTINCT s.customer_id) AS customers
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.employee_id = ? AND si.item_type = 'service' AND s.status = 'completed'
         AND s.sold_at >= ? AND s.sold_at < ?`,
      [id, range.start, range.end],
    ),
    db.queryOne(
      `SELECT COALESCE(SUM(CASE WHEN status <> 'reversed' THEN amount ELSE 0 END), 0) AS earned,
              COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) AS paid
       FROM commissions WHERE employee_id = ? AND earned_at >= ? AND earned_at < ?`,
      [id, range.start, range.end],
    ),
    db.queryOne(
      `SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed, SUM(status = 'cancelled') AS cancelled,
              SUM(status = 'no_show') AS no_show
       FROM appointments WHERE employee_id = ? AND start_time >= ? AND start_time < ?`,
      [id, range.start, range.end],
    ),
    db.queryOne(
      `SELECT SUM(status IN ('present','late','half_day')) AS days_present, SUM(status = 'late') AS days_late,
              SUM(status = 'absent') AS days_absent, SUM(status = 'on_leave') AS days_leave,
              COALESCE(SUM(TIMESTAMPDIFF(MINUTE, clock_in, clock_out)), 0) AS minutes_worked
       FROM attendance WHERE employee_id = ? AND work_date BETWEEN ? AND ?`,
      [id, start, end],
    ),
    db.query(
      `SELECT DATE(CONVERT_TZ(s.sold_at, '+00:00', ?)) AS day, COALESCE(SUM(si.net_amount), 0) AS revenue, COUNT(*) AS services
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.employee_id = ? AND si.item_type = 'service' AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ?
       GROUP BY day ORDER BY day`,
      [offset, id, range.start, range.end],
    ),
    db.query(
      `SELECT si.description AS name, COUNT(*) AS count, COALESCE(SUM(si.net_amount), 0) AS revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.employee_id = ? AND si.item_type = 'service' AND s.status = 'completed' AND s.sold_at >= ? AND s.sold_at < ?
       GROUP BY si.description ORDER BY revenue DESC LIMIT 5`,
      [id, range.start, range.end],
    ),
  ]);

  const servicesCompleted = Number(sales.services_completed);
  const revenue = Number(sales.revenue);
  return {
    from: start,
    to: end,
    servicesCompleted,
    revenue,
    customersServed: Number(sales.customers),
    averageServiceValue: servicesCompleted ? Number((revenue / servicesCompleted).toFixed(2)) : 0,
    commissionEarned: Number(commission.earned),
    commissionPaid: Number(commission.paid),
    appointments: {
      total: Number(appointments.total || 0),
      completed: Number(appointments.completed || 0),
      cancelled: Number(appointments.cancelled || 0),
      noShow: Number(appointments.no_show || 0),
    },
    attendance: {
      daysPresent: Number(attendance.days_present || 0),
      daysLate: Number(attendance.days_late || 0),
      daysAbsent: Number(attendance.days_absent || 0),
      daysOnLeave: Number(attendance.days_leave || 0),
      hoursWorked: Number((Number(attendance.minutes_worked || 0) / 60).toFixed(1)),
    },
    daily: daily.map((d) => ({ date: d.day, revenue: Number(d.revenue), services: Number(d.services) })),
    topServices: topServices.map((s) => ({ name: s.name, count: Number(s.count), revenue: Number(s.revenue) })),
  };
}

module.exports = {
  list: employeeModel.list,
  options: employeeModel.options,
  getById,
  getProfile,
  create,
  update,
  remove,
  updateSchedule,
  updatePhoto,
  performance,
};
