'use strict';

const { DateTime } = require('luxon');
const QRCode = require('qrcode');
const config = require('../config');
const db = require('../config/database');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const { randomToken } = require('../utils/crypto');
const { nextCode } = require('../utils/sequence');
const { D, toNumber } = require('../utils/money');
const { parseDateTime, timezone, todayLocal, localDateRange, localDateString } = require('../utils/time');
const { hasPermission } = require('../middleware/auth');
const model = require('../models/appointmentModel');
const settings = require('./settingsService');
const scheduleService = require('./scheduleService');
const notificationService = require('./notificationService');
const messaging = require('./messaging');
const audit = require('./auditService');

/**
 * Appointment scheduling. An appointment has one or more staff members (the
 * first is the lead); some services need two people. Every rule is enforced
 * on the server:
 *   • each staff member must be active, bookable and in the current branch
 *   • every service must be active and performed by at least one of them
 *   • no overlap with any member's other appointments (plus buffer)
 *   • no overlap with the customer's other appointments
 *   • inside every member's working hours / not on leave (when enforced)
 * The staff rows are locked (SELECT … FOR UPDATE) while checking, so two
 * receptionists booking the same slot at the same moment cannot both succeed.
 */

const TRANSITIONS = {
  pending: ['confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'],
  confirmed: ['in_progress', 'completed', 'cancelled', 'no_show'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  no_show: [],
};

const STATUS_PERMISSION = {
  confirmed: 'appointments.update',
  no_show: 'appointments.update',
  in_progress: 'appointments.complete',
  completed: 'appointments.complete',
  cancelled: 'appointments.cancel',
};

const EDITABLE = ['pending', 'confirmed'];
const PAST_TOLERANCE_MINUTES = 15;

/** Stylists without appointments.view only see appointments assigned to them. */
function ownScope(ctx) {
  return hasPermission(ctx.user, 'appointments.view') ? null : ctx.user.id;
}

function fmtTime(date) {
  const pattern = settings.get('system.time_format') === '12h' ? 'h:mm a' : 'HH:mm';
  return DateTime.fromJSDate(new Date(date)).setZone(timezone()).toFormat(pattern);
}

function fmtDate(date) {
  return DateTime.fromJSDate(new Date(date)).setZone(timezone()).toFormat('ccc dd LLL yyyy');
}

async function getById(id, ctx) {
  const appointment = await model.findById(id);
  if (!appointment) throw ApiError.notFound('Appointment not found');
  const scope = ownScope(ctx);
  if (appointment.branchId !== ctx.branchId || (scope && !appointment.staff.some((member) => member.userId === scope))) {
    throw ApiError.notFound('Appointment not found');
  }
  return appointment;
}

async function calendar({ from, to, employeeId, status }, ctx) {
  const range = localDateRange(from, to);
  return model.listRange({ branchId: ctx.branchId, start: range.start, end: range.end, employeeId, status, ownUserId: ownScope(ctx) });
}

async function list(filters, ctx) {
  const range = filters.from || filters.to ? localDateRange(filters.from || '2000-01-01', filters.to || '2999-12-31') : {};
  return model.listPaged({ ...filters, branchId: ctx.branchId, start: range.start, end: range.end, ownUserId: ownScope(ctx) });
}

// ---- Validation helpers ------------------------------------------------------------

/** The team from a request: employeeIds (first = lead), or a single employeeId from older clients. */
function teamIds(data, fallback = []) {
  const ids = data.employeeIds?.length ? data.employeeIds : data.employeeId ? [data.employeeId] : fallback;
  return [...new Set(ids)];
}

/**
 * Lock and check the appointment's staff. Rows are locked in id order so two
 * bookings for overlapping teams cannot deadlock; the result keeps the
 * requested order (the first is the lead).
 */
async function lockTeam(conn, employeeIds, branchId) {
  if (!employeeIds.length) throw ApiError.validation([{ field: 'employeeIds', message: 'Choose who will do the appointment' }]);
  const rows = await db.query(
    'SELECT id, full_name, branch_id, status, is_bookable, user_id FROM employees WHERE id IN (?) ORDER BY id FOR UPDATE',
    [employeeIds],
    conn,
  );
  return employeeIds.map((employeeId) => {
    const employee = rows.find((r) => r.id === employeeId);
    if (!employee || employee.branch_id !== branchId) throw ApiError.validation([{ field: 'employeeIds', message: 'Choose staff from this branch' }]);
    if (employee.status !== 'active' || !employee.is_bookable) {
      throw ApiError.validation([{ field: 'employeeIds', message: `${employee.full_name} is not available for bookings` }]);
    }
    return employee;
  });
}

/** "Neema", "Neema & Rehema", "Neema, Rehema & Grace" (first names). */
function joinNames(names) {
  const first = names.map((n) => String(n).split(' ')[0]);
  return first.length <= 1 ? first[0] || '' : `${first.slice(0, -1).join(', ')} & ${first[first.length - 1]}`;
}

async function loadCustomer(conn, customerId) {
  const customer = await db.queryOne('SELECT id, full_name, phone, email, preferred_channel FROM customers WHERE id = ? AND deleted_at IS NULL', [customerId], conn);
  if (!customer) throw ApiError.validation([{ field: 'customerId', message: 'Customer not found' }]);
  return customer;
}

/** Load services in the requested order and check someone in the team performs each one. */
async function resolveServices(conn, serviceIds, team) {
  const unique = [...new Set(serviceIds)];
  const rows = await db.query('SELECT id, name, price, duration_minutes, is_active FROM services WHERE id IN (?)', [unique], conn);
  if (rows.length !== unique.length) throw ApiError.validation([{ field: 'serviceIds', message: 'One or more services do not exist' }]);
  const inactive = rows.filter((s) => !s.is_active);
  if (inactive.length) throw ApiError.validation([{ field: 'serviceIds', message: `Not available: ${inactive.map((s) => s.name).join(', ')}` }]);

  const assigned = new Set(
    (await db.query('SELECT service_id FROM employee_services WHERE employee_id IN (?) AND service_id IN (?)', [team.map((e) => e.id), unique], conn)).map((r) => r.service_id),
  );
  const missing = rows.filter((s) => !assigned.has(s.id));
  if (missing.length) {
    const who = team.length === 1 ? `${team[0].full_name} does not perform` : 'Nobody in the chosen team performs';
    throw ApiError.validation([{ field: 'serviceIds', message: `${who}: ${missing.map((s) => s.name).join(', ')}` }]);
  }
  return unique.map((sid) => rows.find((r) => r.id === sid));
}

async function assertSlotAvailable(conn, { team, customerId, start, end, excludeId = 0, checkPast = true }) {
  if (checkPast && start < new Date(Date.now() - PAST_TOLERANCE_MINUTES * 60_000)) {
    throw ApiError.validation([{ field: 'startTime', message: 'Appointments cannot be booked in the past' }]);
  }
  const buffer = Number(settings.get('system.appointment_buffer_minutes') || 0);
  for (const employee of team) {
    if (settings.get('system.enforce_working_hours')) {
      const hours = await scheduleService.isWithinWorkingHours(employee.id, start, end, conn);
      if (!hours.ok) throw ApiError.validation([{ field: 'startTime', message: team.length > 1 ? `${employee.full_name}: ${hours.reason}` : hours.reason }]);
    }
    const clash = await model.findEmployeeConflict(conn, { employeeId: employee.id, start, end, excludeId, bufferMinutes: buffer });
    if (clash) {
      throw ApiError.conflict(
        `${employee.full_name} is already booked ${fmtTime(clash.start_time)}–${fmtTime(clash.end_time)} (${clash.code}). Choose another time or other staff.`,
        { code: 'DOUBLE_BOOKING', errors: [{ field: 'startTime', message: 'This time overlaps another appointment' }] },
      );
    }
  }
  const customerClash = await model.findCustomerConflict(conn, { customerId, start, end, excludeId });
  if (customerClash) {
    throw ApiError.conflict(
      `The customer already has an appointment at ${fmtTime(customerClash.start_time)} with ${customerClash.employee_name} (${customerClash.code}).`,
      { code: 'CUSTOMER_DOUBLE_BOOKING', errors: [{ field: 'startTime', message: 'The customer is busy at this time' }] },
    );
  }
}

function parseStart(value) {
  const start = parseDateTime(value);
  if (!start) throw ApiError.validation([{ field: 'startTime', message: 'Invalid start time' }]);
  return start;
}

function messageVariables(appointment, customer, staffNames, services) {
  return {
    customer_name: customer.full_name.split(' ')[0],
    date: fmtDate(appointment.start),
    time: fmtTime(appointment.start),
    stylist: joinNames(staffNames),
    code: appointment.code,
    services: services.map((s) => s.name).join(', '),
  };
}

/**
 * In-app notification to every staff member of an appointment who has a user
 * account (except the person doing the action). build(others) receives the
 * other members' first names, e.g. "Rehema & Grace".
 */
async function notifyTeam(staff, ctx, build) {
  for (const member of staff) {
    if (!member.userId || member.userId === ctx?.userId) continue;
    const others = joinNames(staff.filter((m) => m.id !== member.id).map((m) => m.fullName));
    await notificationService.notifyUser(member.userId, build(others)).catch((err) => logger.error({ err }, 'Failed to notify staff'));
  }
}

// ---- Commands -------------------------------------------------------------------------

async function create(data, ctx) {
  const result = await db.withTransaction(async (conn) => {
    const team = await lockTeam(conn, teamIds(data), ctx.branchId);
    const customer = await loadCustomer(conn, data.customerId);
    const services = await resolveServices(conn, data.serviceIds, team);
    const totalDuration = services.reduce((sum, s) => sum + s.duration_minutes, 0);
    const totalPrice = toNumber(services.reduce((sum, s) => sum.plus(s.price), D(0)));
    const start = parseStart(data.startTime);
    const end = new Date(start.getTime() + totalDuration * 60_000);

    await assertSlotAvailable(conn, { team, customerId: customer.id, start, end });

    const code = await nextCode(conn, 'appointment', 'APT-', 6);
    const status = data.status === 'confirmed' ? 'confirmed' : 'pending';
    const id = await model.insert(conn, {
      code,
      branchId: ctx.branchId,
      customerId: customer.id,
      employeeId: team[0].id,
      start,
      end,
      status,
      source: data.source || 'phone',
      notes: data.notes,
      totalPrice,
      totalDuration,
      qrToken: randomToken(16),
      createdBy: ctx.userId,
    });
    await model.replaceServices(conn, id, services);
    await model.replaceStaff(conn, id, team.map((e) => e.id));
    await audit.record(ctx, {
      action: 'appointment.created', entityType: 'appointment', entityId: id,
      description: `Booked ${code} for ${customer.full_name} with ${team.map((e) => e.full_name).join(', ')} on ${fmtDate(start)} at ${fmtTime(start)}`,
    }, conn);
    // Walk-ins are already here, so they get no "please confirm" message and
    // no reminder. When the booking is already inside the reminder window, the
    // confirmation asks the same question, so no reminder follows minutes later.
    const walkIn = (data.source || 'phone') === 'walk_in';
    const queued = walkIn ? [] : await messaging.notifyCustomer(
      'appointment_confirmation',
      customer,
      messageVariables({ start, code }, customer, team.map((e) => e.full_name), services),
      { branchId: ctx.branchId, relatedType: 'appointment', relatedId: id, createdBy: ctx.userId },
      conn,
    );
    const reminderHours = Number(settings.get('notifications.reminder_hours_before') || 24);
    if (walkIn || (queued.length && start.getTime() - Date.now() <= reminderHours * 3_600_000)) {
      await db.query('UPDATE appointments SET reminder_sent_at = UTC_TIMESTAMP() WHERE id = ?', [id], conn);
    }
    return { id, code, team, customer, start };
  });

  await notifyTeam(result.team.map((e) => ({ id: e.id, fullName: e.full_name, userId: e.user_id })), ctx, (others) => ({
    type: 'appointment.created',
    category: 'appointment',
    branchId: ctx.branchId,
    title: 'New appointment',
    message: `${result.customer.full_name} booked with you${others ? ` and ${others}` : ''} on ${fmtDate(result.start)} at ${fmtTime(result.start)} (${result.code}).`,
    link: `/appointments?appointment=${result.id}`,
  }));
  return getById(result.id, ctx);
}

/** Edit an appointment (customer, staff, services, time, notes). */
async function update(id, data, ctx) {
  const existing = await getById(id, ctx);
  if (!EDITABLE.includes(existing.status)) throw ApiError.badRequest(`A ${existing.status.replace('_', ' ')} appointment can no longer be edited`);

  await db.withTransaction(async (conn) => {
    const previousTeam = existing.staff.map((m) => m.id);
    const team = await lockTeam(conn, teamIds(data, previousTeam), ctx.branchId);
    const customerId = data.customerId || existing.customerId;
    await loadCustomer(conn, customerId);
    const serviceIds = data.serviceIds || existing.services.map((s) => s.serviceId);
    const services = await resolveServices(conn, serviceIds, team);
    const totalDuration = services.reduce((sum, s) => sum + s.duration_minutes, 0);
    const totalPrice = toNumber(services.reduce((sum, s) => sum.plus(s.price), D(0)));
    const start = data.startTime ? parseStart(data.startTime) : new Date(existing.startTime);
    const end = new Date(start.getTime() + totalDuration * 60_000);
    const teamChanged = [...previousTeam].sort().join() !== team.map((e) => e.id).sort().join();
    const timeChanged = start.getTime() !== new Date(existing.startTime).getTime() || teamChanged;

    await assertSlotAvailable(conn, { team, customerId, start, end, excludeId: id, checkPast: timeChanged });
    await db.query(
      `UPDATE appointments SET customer_id = ?, employee_id = ?, start_time = ?, end_time = ?, notes = ?, source = ?,
              total_price = ?, total_duration = ?, reminder_sent_at = IF(?, NULL, reminder_sent_at),
              customer_response = IF(?, NULL, customer_response), customer_response_at = IF(?, NULL, customer_response_at),
              customer_delay_minutes = IF(?, NULL, customer_delay_minutes), customer_response_note = IF(?, NULL, customer_response_note)
       WHERE id = ?`,
      // A new time needs a new reminder, and the customer's earlier reply no longer applies.
      [customerId, team[0].id, start, end, data.notes !== undefined ? data.notes : existing.notes, data.source || existing.source,
        totalPrice, totalDuration, ...Array(5).fill(timeChanged ? 1 : 0), id],
      conn,
    );
    await model.replaceServices(conn, id, services);
    await model.replaceStaff(conn, id, team.map((e) => e.id));
    await audit.record(ctx, {
      action: timeChanged ? 'appointment.rescheduled' : 'appointment.updated',
      entityType: 'appointment',
      entityId: id,
      description: timeChanged
        ? `Rescheduled ${existing.code} to ${fmtDate(start)} ${fmtTime(start)} with ${team.map((e) => e.full_name).join(', ')}`
        : `Updated ${existing.code}`,
      metadata: timeChanged ? { from: existing.startTime, to: start, fromStaff: previousTeam, toStaff: team.map((e) => e.id) } : null,
    }, conn);
  });
  return getById(id, ctx);
}

/**
 * Drag-and-drop move on the calendar: a new start time and/or moving one
 * team member's part to another person (fromEmployeeId → employeeId). Older
 * clients send only employeeId, which replaces the lead.
 */
async function reschedule(id, { startTime, employeeId, fromEmployeeId }, ctx) {
  const existing = await getById(id, ctx);
  let team = existing.staff.map((m) => m.id);
  if (employeeId && !team.includes(employeeId)) {
    const from = fromEmployeeId && team.includes(fromEmployeeId) ? fromEmployeeId : team[0];
    team = team.map((memberId) => (memberId === from ? employeeId : memberId));
  } else if (employeeId && fromEmployeeId && employeeId !== fromEmployeeId) {
    throw ApiError.badRequest('That person is already on this appointment');
  }
  return update(id, { startTime, employeeIds: team }, ctx);
}

async function changeStatus(id, { status, reason }, ctx) {
  const appointment = await getById(id, ctx);
  const permission = STATUS_PERMISSION[status];
  if (!permission || !hasPermission(ctx.user, permission)) throw ApiError.forbidden();
  if (!TRANSITIONS[appointment.status].includes(status)) {
    throw ApiError.badRequest(`This appointment is "${appointment.status.replace('_', ' ')}" and cannot be changed to "${status.replace('_', ' ')}"`);
  }
  if (status === 'cancelled' && !reason) throw ApiError.validation([{ field: 'reason', message: 'Give a reason for the cancellation' }]);
  if (['in_progress', 'completed', 'no_show'].includes(status) && new Date(appointment.startTime) > new Date(Date.now() + 60 * 60_000) && localDateString(appointment.startTime) !== todayLocal()) {
    throw ApiError.badRequest('This appointment is not due yet');
  }

  const columns = {
    confirmed: 'confirmed_at = UTC_TIMESTAMP()',
    in_progress: 'started_at = UTC_TIMESTAMP(), checked_in_at = COALESCE(checked_in_at, UTC_TIMESTAMP()), checked_in_by = COALESCE(checked_in_by, ?)',
    completed: 'completed_at = UTC_TIMESTAMP(), started_at = COALESCE(started_at, UTC_TIMESTAMP())',
    cancelled: 'cancelled_at = UTC_TIMESTAMP(), cancellation_reason = ?, cancelled_by = ?',
    no_show: 'cancelled_at = NULL',
  };
  const extraParams = { in_progress: [ctx.userId], cancelled: [reason, ctx.userId] }[status] || [];

  await db.withTransaction(async (conn) => {
    await db.query(`UPDATE appointments SET status = ?, ${columns[status]} WHERE id = ?`, [status, ...extraParams, id], conn);
    if (status === 'completed') {
      await db.query(
        'UPDATE customers SET last_visit_at = IF(last_visit_at IS NULL OR last_visit_at < UTC_TIMESTAMP(), UTC_TIMESTAMP(), last_visit_at) WHERE id = ?',
        [appointment.customerId],
        conn,
      );
    }
    await audit.record(ctx, {
      action: status === 'cancelled' ? 'appointment.cancelled' : `appointment.${status}`,
      entityType: 'appointment',
      entityId: id,
      description: `${appointment.code} marked ${status.replace('_', ' ')}${reason ? `: ${reason}` : ''}`,
    }, conn);
    if (status === 'cancelled') {
      const start = new Date(appointment.startTime);
      await messaging.notifyCustomer(
        'appointment_cancelled',
        { id: appointment.customerId, full_name: appointment.customerName, phone: appointment.customerPhone, email: appointment.customerEmail, preferred_channel: appointment.customerPreferredChannel },
        { customer_name: appointment.customerName.split(' ')[0], date: fmtDate(start), time: fmtTime(start), code: appointment.code, stylist: joinNames(appointment.staff.map((m) => m.fullName)) },
        { branchId: ctx.branchId, relatedType: 'appointment', relatedId: id, createdBy: ctx.userId },
        conn,
      );
    }
  });

  if (status === 'cancelled') {
    await notifyTeam(appointment.staff, ctx, () => ({
      type: 'appointment.cancelled',
      category: 'appointment',
      branchId: ctx.branchId,
      title: 'Appointment cancelled',
      message: `${appointment.code} with ${appointment.customerName} on ${fmtDate(appointment.startTime)} at ${fmtTime(appointment.startTime)} was cancelled.`,
      link: `/appointments?appointment=${id}`,
    }));
  }
  return getById(id, ctx);
}

/**
 * QR / code check-in. Prevents duplicate check-ins and only accepts today's
 * appointments in the current branch.
 */
async function checkIn({ token, id }, ctx) {
  const target = token ? await model.findByToken(token) : { id };
  if (!target) throw ApiError.notFound('No appointment matches this QR code');
  const appointment = await getById(target.id, ctx);

  if (['cancelled', 'no_show', 'completed'].includes(appointment.status)) {
    throw ApiError.badRequest(`This appointment is ${appointment.status.replace('_', ' ')} and cannot be checked in`);
  }
  if (appointment.checkedInAt) {
    throw ApiError.conflict(
      `Already checked in at ${fmtTime(appointment.checkedInAt)}${appointment.checkedInByName ? ` by ${appointment.checkedInByName}` : ''}`,
      { code: 'ALREADY_CHECKED_IN' },
    );
  }
  if (localDateString(appointment.startTime) !== todayLocal()) {
    throw ApiError.badRequest(`This appointment is for ${fmtDate(appointment.startTime)}, not today`);
  }

  await db.withTransaction(async (conn) => {
    const result = await db.query(
      `UPDATE appointments SET checked_in_at = UTC_TIMESTAMP(), checked_in_by = ?,
              status = IF(status = 'pending', 'confirmed', status), confirmed_at = COALESCE(confirmed_at, UTC_TIMESTAMP())
       WHERE id = ? AND checked_in_at IS NULL`,
      [ctx.userId, appointment.id],
      conn,
    );
    if (!result.affectedRows) throw ApiError.conflict('Already checked in', { code: 'ALREADY_CHECKED_IN' });
    await audit.record(ctx, { action: 'appointment.checked_in', entityType: 'appointment', entityId: appointment.id, description: `${appointment.code} checked in (${appointment.customerName})` }, conn);
  });

  await notifyTeam(appointment.staff, ctx, () => ({
    type: 'appointment.checked_in',
    category: 'appointment',
    branchId: ctx.branchId,
    title: 'Customer has arrived',
    message: `${appointment.customerName} checked in for ${appointment.code} at ${fmtTime(new Date())}.`,
    link: `/appointments?appointment=${appointment.id}`,
  }));
  return getById(appointment.id, ctx);
}

/** Minimal, non-personal information for the public QR link. */
async function publicVerify(token) {
  const row = await db.queryOne(
    `SELECT a.code, a.start_time, a.status, a.checked_in_at, b.name AS branch_name,
            (SELECT COUNT(*) FROM appointment_services s WHERE s.appointment_id = a.id) AS service_count
     FROM appointments a JOIN branches b ON b.id = a.branch_id WHERE a.qr_token = ?`,
    [token],
  );
  if (!row) throw ApiError.notFound('This QR code does not match any appointment');
  return {
    valid: !['cancelled', 'no_show'].includes(row.status),
    code: row.code,
    status: row.status,
    date: fmtDate(row.start_time),
    time: fmtTime(row.start_time),
    isToday: localDateString(row.start_time) === todayLocal(),
    checkedIn: Boolean(row.checked_in_at),
    branchName: row.branch_name,
    salonName: settings.get('business.salon_name'),
    serviceCount: Number(row.service_count),
  };
}

async function qrCode(id, ctx) {
  const appointment = await getById(id, ctx);
  const url = `${config.appUrl}/check-in/${appointment.qrToken}`;
  const dataUrl = await QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: '#0F0F0F', light: '#FFFFFF' } });
  return { url, dataUrl, code: appointment.code };
}

// ---- Availability -----------------------------------------------------------------------

async function durationFor(serviceIds) {
  if (!serviceIds?.length) return 30;
  const row = await db.queryOne('SELECT COALESCE(SUM(duration_minutes), 0) AS total FROM services WHERE id IN (?)', [serviceIds]);
  return Number(row.total) || 30;
}

/**
 * Bookable time slots on one business-local date for one or more staff
 * members: a slot is free only when every member works then and is free.
 */
async function availability({ employeeId, employeeIds, date, serviceIds, excludeId }, ctx) {
  const ids = teamIds({ employeeId, employeeIds });
  const employees = ids.length ? await db.query('SELECT id, branch_id, full_name FROM employees WHERE id IN (?)', [ids]) : [];
  if (!ids.length || employees.length !== ids.length || employees.some((e) => e.branch_id !== ctx.branchId)) throw ApiError.notFound('Stylist not found');
  const duration = await durationFor(serviceIds);
  const interval = Number(settings.get('system.slot_interval_minutes') || 15);
  const buffer = Number(settings.get('system.appointment_buffer_minutes') || 0);
  const enforce = settings.get('system.enforce_working_hours');

  // The hours everyone works (the overlap of their working windows).
  let window = null;
  for (const id of ids) {
    let own = await scheduleService.getDayWindow(id, date);
    if (!own.working && !enforce) {
      const day = DateTime.fromISO(date, { zone: timezone() });
      own = { working: true, start: day.set({ hour: 7 }), end: day.set({ hour: 21 }) };
    }
    if (!own.working) {
      const name = employees.find((e) => e.id === id).full_name;
      return { working: false, reason: ids.length > 1 ? `${name}: ${own.reason}` : own.reason, duration, slots: [], busy: [] };
    }
    window = window ? { working: true, start: DateTime.max(window.start, own.start), end: DateTime.min(window.end, own.end) } : own;
  }
  if (window.end <= window.start) {
    return { working: false, reason: 'the chosen staff have no working hours in common on this day', duration, slots: [], busy: [] };
  }

  const busy = [];
  for (const id of ids) {
    for (const b of await model.busyIntervals(id, window.start.toJSDate(), window.end.toJSDate(), excludeId || 0)) {
      if (!busy.some((x) => x.id === b.id)) busy.push(b);
    }
  }
  busy.sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  const now = Date.now();
  const slots = [];
  for (let t = window.start; t.plus({ minutes: duration }) <= window.end; t = t.plus({ minutes: interval })) {
    const start = t.toJSDate();
    const end = t.plus({ minutes: duration }).toJSDate();
    const clash = busy.some((b) => new Date(b.start_time).getTime() < end.getTime() + buffer * 60_000 && new Date(b.end_time).getTime() + buffer * 60_000 > start.getTime());
    slots.push({ start, end, available: !clash && start.getTime() >= now - PAST_TOLERANCE_MINUTES * 60_000 });
  }
  return {
    working: true,
    duration,
    window: { start: window.start.toJSDate(), end: window.end.toJSDate() },
    slots,
    busy: busy.map((b) => ({ id: b.id, code: b.code, start: b.start_time, end: b.end_time })),
  };
}

/** Which stylists can perform all the services and are free at `startTime`. */
async function availableEmployees({ startTime, serviceIds, excludeId }, ctx) {
  const start = parseStart(startTime);
  const duration = await durationFor(serviceIds);
  const end = new Date(start.getTime() + duration * 60_000);
  const buffer = Number(settings.get('system.appointment_buffer_minutes') || 0);
  const employees = await db.query(
    `SELECT e.id, e.full_name, e.calendar_color, e.job_title FROM employees e
     WHERE e.branch_id = ? AND e.status = 'active' AND e.is_bookable = 1
       ${serviceIds?.length ? 'AND (SELECT COUNT(DISTINCT es.service_id) FROM employee_services es WHERE es.employee_id = e.id AND es.service_id IN (?)) = ?' : ''}
     ORDER BY e.full_name`,
    serviceIds?.length ? [ctx.branchId, serviceIds, new Set(serviceIds).size] : [ctx.branchId],
  );
  const result = [];
  for (const e of employees) {
    let available = true;
    let reason = null;
    if (settings.get('system.enforce_working_hours')) {
      const hours = await scheduleService.isWithinWorkingHours(e.id, start, end);
      if (!hours.ok) {
        available = false;
        reason = hours.reason.replace('The stylist is ', '');
      }
    }
    if (available) {
      const clash = await model.findEmployeeConflict(null, { employeeId: e.id, start, end, excludeId: excludeId || 0, bufferMinutes: buffer });
      if (clash) {
        available = false;
        reason = `booked ${fmtTime(clash.start_time)}–${fmtTime(clash.end_time)}`;
      }
    }
    result.push({ id: e.id, fullName: e.full_name, jobTitle: e.job_title, calendarColor: e.calendar_color, available, reason });
  }
  return { start, end, duration, employees: result };
}

// ---- Reminders (background job) --------------------------------------------------------

async function sendDueReminders() {
  await settings.ensureFresh();
  if (!settings.get('notifications.reminders_enabled')) return 0;
  const hours = Number(settings.get('notifications.reminder_hours_before') || 24);
  const due = await db.query(
    `SELECT a.id, a.code, a.branch_id, a.start_time, c.id AS customer_id, c.full_name, c.phone, c.email, c.preferred_channel,
            (SELECT GROUP_CONCAT(aps.service_name ORDER BY aps.sort_order SEPARATOR ', ') FROM appointment_services aps WHERE aps.appointment_id = a.id) AS services
     FROM appointments a JOIN customers c ON c.id = a.customer_id
     WHERE a.status IN ('pending','confirmed') AND a.reminder_sent_at IS NULL
       AND a.start_time > UTC_TIMESTAMP() AND a.start_time <= DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? HOUR)
     LIMIT 200`,
    [hours],
  );
  const teams = await model.staffFor(due.map((a) => a.id));
  for (const a of due) {
    const staff = teams.get(a.id) || [];
    await db.withTransaction(async (conn) => {
      const claimed = await db.query('UPDATE appointments SET reminder_sent_at = UTC_TIMESTAMP() WHERE id = ? AND reminder_sent_at IS NULL', [a.id], conn);
      if (!claimed.affectedRows) return;
      await messaging.notifyCustomer(
        'appointment_reminder',
        { id: a.customer_id, full_name: a.full_name, phone: a.phone, email: a.email, preferred_channel: a.preferred_channel },
        { customer_name: a.full_name.split(' ')[0], date: fmtDate(a.start_time), time: fmtTime(a.start_time), stylist: joinNames(staff.map((m) => m.fullName)), code: a.code, services: a.services },
        { branchId: a.branch_id, relatedType: 'appointment', relatedId: a.id },
        conn,
      );
      for (const member of staff) {
        if (!member.userId) continue;
        await notificationService.notifyUser(member.userId, {
          type: 'appointment.reminder',
          category: 'appointment',
          branchId: a.branch_id,
          title: 'Upcoming appointment',
          message: `${a.full_name} — ${a.services} on ${fmtDate(a.start_time)} at ${fmtTime(a.start_time)} (${a.code}).`,
          link: `/appointments?appointment=${a.id}`,
        }, conn);
      }
    });
  }
  return due.length;
}

module.exports = {
  fmtDate,
  fmtTime,
  joinNames,
  TRANSITIONS,
  getById,
  calendar,
  list,
  create,
  update,
  reschedule,
  changeStatus,
  checkIn,
  publicVerify,
  qrCode,
  availability,
  availableEmployees,
  sendDueReminders,
};
