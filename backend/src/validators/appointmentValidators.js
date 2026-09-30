'use strict';

const { z, id, isoDate, isoDateTime, optionalText, listQuery, optionalId } = require('./common');

const STATUSES = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];
const statusList = z
  .string()
  .regex(/^[a-z_]+(,[a-z_]+)*$/)
  .refine((v) => v.split(',').every((s) => STATUSES.includes(s)), 'Unknown status');

const serviceIds = z.array(id).min(1, 'Choose at least one service').max(10, 'At most 10 services per appointment');
// Staff doing the appointment; the first is the lead. Older clients send employeeId.
const employeeIds = z.array(id).min(1, 'Choose who will do the appointment').max(6, 'At most 6 staff per appointment')
  .refine((ids) => new Set(ids).size === ids.length, 'Each person can be chosen once');
const source = z.enum(['walk_in', 'phone', 'whatsapp', 'online', 'other']);

const idsQuery = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v),
  z.array(z.coerce.number().int().positive()).max(10).optional(),
);

// Products used on an appointment's services, in each product's usage unit.
const usedQuantity = z.coerce.number().positive('Quantity must be more than 0').max(100_000)
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Use at most 3 decimal places');
const productsUsed = z.object({
  services: z.array(z.object({
    serviceId: id,
    products: z.array(z.object({ productId: id, quantity: usedQuantity })).max(30)
      .refine((rows) => new Set(rows.map((r) => r.productId)).size === rows.length, 'List each product once'),
  })).min(1).max(10),
});

module.exports = {
  productsUsed,
  create: z.object({
    customerId: id,
    employeeId: id.optional(),
    employeeIds: employeeIds.optional(),
    serviceIds,
    startTime: isoDateTime,
    notes: optionalText(2000),
    source: source.optional(),
    status: z.enum(['pending', 'confirmed']).optional(),
  }).refine((d) => d.employeeId || d.employeeIds?.length, { path: ['employeeIds'], message: 'Choose who will do the appointment' }),
  update: z.object({
    customerId: id.optional(),
    employeeId: id.optional(),
    employeeIds: employeeIds.optional(),
    serviceIds: serviceIds.optional(),
    startTime: isoDateTime.optional(),
    notes: optionalText(2000),
    source: source.optional(),
  }),
  reschedule: z.object({ startTime: isoDateTime, employeeId: id.optional(), fromEmployeeId: id.optional() }),
  status: z.object({ status: z.enum(['confirmed', 'in_progress', 'completed', 'cancelled', 'no_show']), reason: optionalText(255) }),
  checkIn: z.object({ token: z.string().regex(/^[a-f0-9]{32}$/, 'Invalid QR code').optional(), code: z.string().trim().max(20).optional() }),
  calendarQuery: z
    .object({ from: isoDate, to: isoDate, employeeId: optionalId, status: statusList.optional() })
    .refine((q) => q.to >= q.from, { path: ['to'], message: '"to" must be on or after "from"' })
    .refine((q) => (new Date(q.to) - new Date(q.from)) / 86_400_000 <= 62, { path: ['to'], message: 'Range is limited to 62 days' }),
  listQuery: listQuery.extend({
    from: isoDate.optional(),
    to: isoDate.optional(),
    employeeId: optionalId,
    customerId: optionalId,
    status: statusList.optional(),
  }),
  availabilityQuery: z
    .object({ employeeId: optionalId, employeeIds: idsQuery, date: isoDate, serviceIds: idsQuery, excludeId: optionalId })
    .refine((q) => q.employeeId || q.employeeIds?.length, { path: ['employeeIds'], message: 'Choose staff' }),
  availableEmployeesQuery: z.object({ startTime: isoDateTime, serviceIds: idsQuery, excludeId: optionalId }),
  token: z.object({ token: z.string().regex(/^[a-f0-9]{32}$/, 'Invalid QR code') }),
};
