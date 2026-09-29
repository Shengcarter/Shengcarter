'use strict';

const { DateTime } = require('luxon');
const db = require('../config/database');
const ApiError = require('../utils/ApiError');
const { camelizeRows, camelizeRow } = require('../utils/case');
const { todayLocal, timezone, localDateString } = require('../utils/time');
const { hasPermission } = require('../middleware/auth');
const scheduleService = require('./scheduleService');
const audit = require('./auditService');

/** Minutes after the scheduled start before a clock-in counts as late. */
const LATE_GRACE_MINUTES = 15;

/**
 * Resolve which employee an attendance action targets. Users may always act
 * on their own linked employee profile (attendance.self); acting on someone
 * else needs attendance.manage.
 */
async function resolveEmployee(employeeId, ctx) {
  const ownId = ctx.user.employeeId;
  const targetId = employeeId || ownId;
  if (!targetId) throw ApiError.badRequest('Your user account is not linked to an employee profile');
  if (targetId !== ownId && !hasPermission(ctx.user, 'attendance.manage')) throw ApiError.forbidden();
  if (targetId === ownId && !hasPermission(ctx.user, 'attendance.self') && !hasPermission(ctx.user, 'attendance.manage')) throw ApiError.forbidden();
  const employee = await db.queryOne("SELECT id, full_name, branch_id, status FROM employees WHERE id = ? AND status <> 'terminated'", [targetId]);
  if (!employee) throw ApiError.notFound('Employee not found');
  return employee;
}

async function clockIn({ employeeId, notes }, ctx) {
  const employee = await resolveEmployee(employeeId, ctx);
  const workDate = todayLocal();
  const now = new Date();

  return db.withTransaction(async (conn) => {
    const existing = await db.queryOne('SELECT id, clock_in FROM attendance WHERE employee_id = ? AND work_date = ? FOR UPDATE', [employee.id, workDate], conn);
    if (existing?.clock_in) {
      throw ApiError.conflict(`${employee.full_name} already clocked in today at ${DateTime.fromJSDate(existing.clock_in).setZone(timezone()).toFormat('HH:mm')}`);
    }
    const window = await scheduleService.getDayWindow(employee.id, workDate, conn);
    const late = window.working && now > window.start.plus({ minutes: LATE_GRACE_MINUTES }).toJSDate();
    const status = late ? 'late' : 'present';

    if (existing) {
      await db.query('UPDATE attendance SET clock_in = ?, status = ?, notes = COALESCE(?, notes), recorded_by = ? WHERE id = ?', [now, status, notes || null, ctx.userId, existing.id], conn);
    } else {
      await db.query(
        'INSERT INTO attendance (employee_id, branch_id, work_date, clock_in, status, notes, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [employee.id, employee.branch_id, workDate, now, status, notes || null, ctx.userId],
        conn,
      );
    }
    await audit.record(ctx, { action: 'attendance.clock_in', entityType: 'employee', entityId: employee.id, description: `${employee.full_name} clocked in${late ? ' (late)' : ''}` }, conn);
    return { employeeId: employee.id, workDate, clockIn: now, status };
  });
}

async function clockOut({ employeeId, notes }, ctx) {
  const employee = await resolveEmployee(employeeId, ctx);
  const workDate = todayLocal();
  const now = new Date();
  return db.withTransaction(async (conn) => {
    const row = await db.queryOne('SELECT id, clock_in, clock_out FROM attendance WHERE employee_id = ? AND work_date = ? FOR UPDATE', [employee.id, workDate], conn);
    if (!row?.clock_in) throw ApiError.badRequest(`${employee.full_name} has not clocked in today`);
    if (row.clock_out) throw ApiError.conflict(`${employee.full_name} already clocked out today`);
    await db.query('UPDATE attendance SET clock_out = ?, notes = COALESCE(?, notes) WHERE id = ?', [now, notes || null, row.id], conn);
    await audit.record(ctx, { action: 'attendance.clock_out', entityType: 'employee', entityId: employee.id, description: `${employee.full_name} clocked out` }, conn);
    return { employeeId: employee.id, workDate, clockOut: now };
  });
}

/** Manual entry / correction by a manager (times are business-local HH:MM). */
async function record(data, ctx) {
  const employee = await resolveEmployee(data.employeeId, { ...ctx, user: { ...ctx.user, employeeId: null } });
  const toUtc = (hhmm) => (hhmm ? DateTime.fromISO(`${data.workDate}T${hhmm}`, { zone: timezone() }).toJSDate() : null);
  const clockIn = toUtc(data.clockIn);
  const clockOut = toUtc(data.clockOut);
  if (clockIn && clockOut && clockOut <= clockIn) throw ApiError.validation([{ field: 'clockOut', message: 'Clock-out must be after clock-in' }]);

  await db.withTransaction(async (conn) => {
    await db.query(
      `INSERT INTO attendance (employee_id, branch_id, work_date, clock_in, clock_out, status, notes, recorded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE clock_in = VALUES(clock_in), clock_out = VALUES(clock_out), status = VALUES(status),
                               notes = VALUES(notes), recorded_by = VALUES(recorded_by)`,
      [employee.id, employee.branch_id, data.workDate, clockIn, clockOut, data.status, data.notes || null, ctx.userId],
      conn,
    );
    await audit.record(ctx, {
      action: 'attendance.recorded', entityType: 'employee', entityId: employee.id,
      description: `Recorded attendance for ${employee.full_name} on ${data.workDate} (${data.status})`,
    }, conn);
  });
}

async function list({ from, to, employeeId }, ctx) {
  const params = [ctx.branchId, from, to];
  let extra = '';
  if (employeeId) {
    extra = 'AND a.employee_id = ?';
    params.push(employeeId);
  }
  const rows = await db.query(
    `SELECT a.id, a.employee_id, e.full_name AS employee_name, e.job_title, a.work_date, a.clock_in, a.clock_out, a.status, a.notes,
            TIMESTAMPDIFF(MINUTE, a.clock_in, a.clock_out) AS minutes_worked, u.full_name AS recorded_by_name
     FROM attendance a JOIN employees e ON e.id = a.employee_id LEFT JOIN users u ON u.id = a.recorded_by
     WHERE a.branch_id = ? AND a.work_date BETWEEN ? AND ? ${extra}
     ORDER BY a.work_date DESC, e.full_name`,
    params,
  );
  return camelizeRows(rows);
}

/** Today's board: every active employee with schedule, leave and attendance. */
async function today(ctx) {
  const date = todayLocal();
  const employees = await db.query(
    "SELECT id, full_name, job_title, photo, calendar_color FROM employees WHERE branch_id = ? AND status IN ('active','on_leave') ORDER BY full_name",
    [ctx.branchId],
  );
  const rows = await db.query('SELECT employee_id, clock_in, clock_out, status, notes FROM attendance WHERE branch_id = ? AND work_date = ?', [ctx.branchId, date]);
  const board = [];
  for (const e of employees) {
    const window = await scheduleService.getDayWindow(e.id, date);
    const record = rows.find((r) => r.employee_id === e.id);
    board.push({
      employeeId: e.id,
      fullName: e.full_name,
      jobTitle: e.job_title,
      photo: e.photo,
      calendarColor: e.calendar_color,
      scheduled: window.working,
      scheduleNote: window.working ? `${window.start.toFormat('HH:mm')}–${window.end.toFormat('HH:mm')}` : window.reason,
      clockIn: record?.clock_in || null,
      clockOut: record?.clock_out || null,
      status: record?.status || (window.reason === 'on approved leave' ? 'on_leave' : null),
      notes: record?.notes || null,
    });
  }
  return { date, employees: board };
}

async function mine(ctx) {
  if (!ctx.user.employeeId) return { linked: false };
  const date = todayLocal();
  const row = await db.queryOne('SELECT clock_in, clock_out, status FROM attendance WHERE employee_id = ? AND work_date = ?', [ctx.user.employeeId, date]);
  const window = await scheduleService.getDayWindow(ctx.user.employeeId, date);
  return {
    linked: true,
    date,
    scheduled: window.working,
    scheduleNote: window.working ? `${window.start.toFormat('HH:mm')}–${window.end.toFormat('HH:mm')}` : window.reason,
    ...(row ? camelizeRow(row) : { clockIn: null, clockOut: null, status: null }),
  };
}

// ---- Leave ------------------------------------------------------------------------
async function listLeave({ employeeId, status, from, to }, ctx) {
  const where = ['e.branch_id = ?'];
  const params = [ctx.branchId];
  if (employeeId) {
    where.push('l.employee_id = ?');
    params.push(employeeId);
  }
  if (status) {
    where.push('l.status = ?');
    params.push(status);
  }
  if (from) {
    where.push('l.end_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('l.start_date <= ?');
    params.push(to);
  }
  return camelizeRows(
    await db.query(
      `SELECT l.id, l.employee_id, e.full_name AS employee_name, l.leave_type, l.start_date, l.end_date,
              DATEDIFF(l.end_date, l.start_date) + 1 AS days, l.reason, l.status, l.reviewed_at,
              r.full_name AS reviewed_by_name, l.created_at
       FROM leave_records l JOIN employees e ON e.id = l.employee_id LEFT JOIN users r ON r.id = l.reviewed_by
       WHERE ${where.join(' AND ')} ORDER BY l.start_date DESC LIMIT 500`,
      params,
    ),
  );
}

async function createLeave(data, ctx) {
  const ownId = ctx.user.employeeId;
  const employeeId = data.employeeId || ownId;
  const manager = hasPermission(ctx.user, 'leave.manage');
  if (!employeeId) throw ApiError.badRequest('Choose an employee');
  if (employeeId !== ownId && !manager) throw ApiError.forbidden();
  const employee = await db.queryOne('SELECT id, full_name FROM employees WHERE id = ?', [employeeId]);
  if (!employee) throw ApiError.notFound('Employee not found');

  const overlap = await db.queryOne(
    "SELECT id FROM leave_records WHERE employee_id = ? AND status IN ('pending','approved') AND start_date <= ? AND end_date >= ?",
    [employeeId, data.endDate, data.startDate],
  );
  if (overlap) throw ApiError.conflict('This employee already has leave recorded for these dates');

  const status = manager && data.status === 'approved' ? 'approved' : 'pending';
  const id = await db.withTransaction(async (conn) => {
    const result = await db.query(
      `INSERT INTO leave_records (employee_id, leave_type, start_date, end_date, reason, status, reviewed_by, reviewed_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [employeeId, data.leaveType, data.startDate, data.endDate, data.reason || null, status,
        status === 'approved' ? ctx.userId : null, status === 'approved' ? new Date() : null, ctx.userId],
      conn,
    );
    await audit.record(ctx, {
      action: 'leave.created', entityType: 'employee', entityId: employeeId,
      description: `Recorded ${data.leaveType} leave for ${employee.full_name} (${data.startDate} to ${data.endDate})`,
    }, conn);
    return result.insertId;
  });
  return { id, status, conflictingAppointments: await conflictingAppointments(employeeId, data.startDate, data.endDate) };
}

async function conflictingAppointments(employeeId, startDate, endDate) {
  const range = { start: DateTime.fromISO(startDate, { zone: timezone() }).toJSDate(), end: DateTime.fromISO(endDate, { zone: timezone() }).plus({ days: 1 }).toJSDate() };
  const row = await db.queryOne(
    "SELECT COUNT(*) AS total FROM appointments WHERE employee_id = ? AND status IN ('pending','confirmed') AND start_time >= ? AND start_time < ?",
    [employeeId, range.start, range.end],
  );
  return Number(row.total);
}

async function reviewLeave(id, status, ctx) {
  const leave = await db.queryOne(
    'SELECT l.*, e.full_name, e.branch_id FROM leave_records l JOIN employees e ON e.id = l.employee_id WHERE l.id = ?',
    [id],
  );
  if (!leave) throw ApiError.notFound('Leave record not found');
  if (status === 'cancelled' && leave.status === 'cancelled') throw ApiError.badRequest('Leave is already cancelled');
  if (['approved', 'rejected'].includes(status) && leave.status !== 'pending') throw ApiError.badRequest(`Only pending leave can be ${status}`);

  await db.withTransaction(async (conn) => {
    await db.query('UPDATE leave_records SET status = ?, reviewed_by = ?, reviewed_at = UTC_TIMESTAMP() WHERE id = ?', [status, ctx.userId, id], conn);
    await audit.record(ctx, { action: `leave.${status}`, entityType: 'employee', entityId: leave.employee_id, description: `Leave for ${leave.full_name} ${status}` }, conn);
  });
  return {
    status,
    conflictingAppointments: status === 'approved' ? await conflictingAppointments(leave.employee_id, leave.start_date, leave.end_date) : 0,
  };
}

module.exports = { clockIn, clockOut, record, list, today, mine, listLeave, createLeave, reviewLeave, localDateString };
