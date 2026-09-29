'use strict';

const { DateTime } = require('luxon');
const db = require('../config/database');
const settings = require('./settingsService');
const { timezone } = require('../utils/time');

/**
 * Working-hours rules shared by appointments (booking validation, available
 * slots) and attendance (late detection).
 *
 * An employee's day comes from their weekly schedule; employees without a
 * schedule follow the business hours in Settings. Approved leave closes the day.
 */

function parseHHMM(localDate, hhmm) {
  return DateTime.fromISO(`${localDate}T${hhmm.slice(0, 5)}`, { zone: timezone() });
}

/**
 * @returns {{ working: boolean, start?: DateTime, end?: DateTime, reason?: string }}
 */
async function getDayWindow(employeeId, localDate, conn = null) {
  const day = DateTime.fromISO(localDate, { zone: timezone() });
  const dayOfWeek = day.weekday % 7; // luxon: 1 = Monday … 7 = Sunday → 0 = Sunday

  const leave = await db.queryOne(
    "SELECT leave_type FROM leave_records WHERE employee_id = ? AND status = 'approved' AND ? BETWEEN start_date AND end_date LIMIT 1",
    [employeeId, localDate],
    conn,
  );
  if (leave) return { working: false, reason: 'on approved leave' };

  const rows = await db.query('SELECT day_of_week, start_time, end_time, is_working FROM employee_schedules WHERE employee_id = ?', [employeeId], conn);
  let start;
  let end;
  if (rows.length) {
    const today = rows.find((r) => r.day_of_week === dayOfWeek);
    if (!today || !today.is_working) return { working: false, reason: 'not scheduled to work on this day' };
    start = today.start_time;
    end = today.end_time;
  } else {
    const hours = settings.get('system.business_hours')?.[String(dayOfWeek)];
    if (!hours?.open) return { working: false, reason: 'the salon is closed on this day' };
    start = hours.start;
    end = hours.end;
  }
  return { working: true, start: parseHHMM(localDate, start), end: parseHHMM(localDate, end) };
}

/** True when [startUtc, endUtc) fits inside the employee's working window. */
async function isWithinWorkingHours(employeeId, startUtc, endUtc, conn = null) {
  const localStart = DateTime.fromJSDate(startUtc).setZone(timezone());
  const window = await getDayWindow(employeeId, localStart.toISODate(), conn);
  if (!window.working) return { ok: false, reason: `The stylist is ${window.reason}` };
  if (startUtc < window.start.toJSDate() || endUtc > window.end.toJSDate()) {
    return {
      ok: false,
      reason: `The appointment must be within working hours (${window.start.toFormat('HH:mm')}–${window.end.toFormat('HH:mm')})`,
    };
  }
  return { ok: true, window };
}

module.exports = { getDayWindow, isWithinWorkingHours };
