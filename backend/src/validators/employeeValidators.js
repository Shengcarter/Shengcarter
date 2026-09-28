'use strict';

const {
  z, id, requiredText, optionalText, optionalEmail, optionalPhone, optionalDate, isoDate, money, percent, listQuery, booleanish, optionalId,
} = require('./common');

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour) format');

const scheduleDay = z
  .object({
    dayOfWeek: z.coerce.number().int().min(0).max(6),
    startTime: hhmm,
    endTime: hhmm,
    isWorking: z.boolean(),
  })
  .refine((d) => !d.isWorking || d.startTime < d.endTime, { message: 'End time must be after start time', path: ['endTime'] });

const schedule = z
  .array(scheduleDay)
  .max(7)
  .refine((days) => new Set(days.map((d) => d.dayOfWeek)).size === days.length, 'Each day can appear only once');

const employeeBody = z.object({
  fullName: requiredText(120, 'Full name'),
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(255),
  jobTitle: requiredText(80, 'Role / job title'),
  employmentDate: optionalDate,
  salary: money.optional().default(0),
  commissionRate: percent.optional().default(0),
  status: z.enum(['active', 'on_leave', 'inactive', 'terminated']).optional().default('active'),
  isBookable: z.boolean().optional().default(true),
  calendarColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Use a hex colour like #D4AF37').optional(),
  notes: optionalText(2000),
  branchId: optionalId,
  serviceIds: z.array(id).max(200).optional(),
  schedule: schedule.optional(),
});

module.exports = {
  createEmployee: employeeBody,
  updateEmployee: employeeBody
    .extend({
      salary: money.optional(),
      commissionRate: percent.optional(),
      status: z.enum(['active', 'on_leave', 'inactive', 'terminated']).optional(),
      isBookable: z.boolean().optional(),
    })
    .partial(),
  listEmployees: listQuery.extend({
    status: z.enum(['active', 'on_leave', 'inactive', 'terminated']).optional(),
    bookable: booleanish.optional(),
  }),
  optionsQuery: z.object({ bookable: booleanish.optional(), includeInactive: booleanish.optional() }),
  schedule: z.object({ days: schedule }),
  services: z.object({ serviceIds: z.array(id).max(200) }),
  performance: z.object({ from: isoDate.optional(), to: isoDate.optional() }),
  clock: z.object({ employeeId: optionalId, notes: optionalText(255) }),
  attendanceRecord: z
    .object({
      employeeId: id,
      workDate: isoDate,
      clockIn: z.preprocess((v) => (v === '' ? null : v), hhmm.nullable().optional()),
      clockOut: z.preprocess((v) => (v === '' ? null : v), hhmm.nullable().optional()),
      status: z.enum(['present', 'late', 'absent', 'half_day', 'on_leave']),
      notes: optionalText(255),
    })
    .refine((d) => !['present', 'late', 'half_day'].includes(d.status) || d.clockIn, { path: ['clockIn'], message: 'Clock-in time is required for this status' }),
  attendanceQuery: z.object({ from: isoDate, to: isoDate, employeeId: optionalId }),
  leaveBody: z
    .object({
      employeeId: optionalId,
      leaveType: z.enum(['annual', 'sick', 'maternity', 'paternity', 'unpaid', 'other']),
      startDate: isoDate,
      endDate: isoDate,
      reason: optionalText(255),
      status: z.enum(['pending', 'approved']).optional(),
    })
    .refine((d) => d.endDate >= d.startDate, { path: ['endDate'], message: 'End date must be on or after the start date' }),
  leaveQuery: z.object({
    employeeId: optionalId,
    status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
    from: isoDate.optional(),
    to: isoDate.optional(),
  }),
  leaveReview: z.object({ status: z.enum(['approved', 'rejected', 'cancelled']) }),
};
