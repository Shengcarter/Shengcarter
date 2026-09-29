'use strict';

const { signIn, uniquePhone, nextWorkingDay, db } = require('./helpers');

describe('appointments and conflict prevention', () => {
  let admin;
  let employee;
  let service;
  let day;
  let customerA;
  let customerB;

  beforeAll(async () => {
    admin = await signIn();
    // A bookable stylist and a service they perform (demo data).
    const link = await db.queryOne(
      `SELECT es.employee_id, es.service_id, s.duration_minutes FROM employee_services es
       JOIN employees e ON e.id = es.employee_id JOIN services s ON s.id = es.service_id
       WHERE e.is_bookable = 1 AND e.status = 'active' AND s.is_active = 1 AND s.duration_minutes <= 60 ORDER BY e.id, s.id LIMIT 1`,
    );
    employee = link.employee_id;
    service = link.service_id;
    day = await nextWorkingDay(employee, 3);
    customerA = (await admin.post('/customers', { fullName: 'Booking Customer A', phone: uniquePhone() })).body.data.id;
    customerB = (await admin.post('/customers', { fullName: 'Booking Customer B', phone: uniquePhone() })).body.data.id;
  });

  const at = (hhmm) => `${day.date}T${hhmm}`;
  const shift = (minutes) => {
    const [h, m] = day.start.split(':').map(Number);
    const total = h * 60 + m + minutes;
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };

  test('books an appointment inside working hours', async () => {
    const res = await admin.post('/appointments', { customerId: customerA, employeeId: employee, serviceIds: [service], startTime: at(shift(60)) });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^APT-\d{6}$/);
    expect(res.body.data.status).toBe('pending');
  });

  test('rejects a double booking for the same stylist', async () => {
    const res = await admin.post('/appointments', { customerId: customerB, employeeId: employee, serviceIds: [service], startTime: at(shift(60)) });
    expect(res.status).toBe(409);
  });

  test('rejects an overlapping booking for the same customer with another stylist', async () => {
    const other = await db.queryOne(
      `SELECT es.employee_id FROM employee_services es JOIN employees e ON e.id = es.employee_id
       WHERE es.service_id = ? AND es.employee_id <> ? AND e.is_bookable = 1 AND e.status = 'active' LIMIT 1`,
      [service, employee],
    );
    if (!other) return; // Demo data always has one; guard keeps the test meaningful elsewhere.
    const res = await admin.post('/appointments', { customerId: customerA, employeeId: other.employee_id, serviceIds: [service], startTime: at(shift(60)) });
    expect(res.status).toBe(409);
  });

  test('rejects bookings outside working hours and in the past', async () => {
    const early = await admin.post('/appointments', { customerId: customerB, employeeId: employee, serviceIds: [service], startTime: at('03:00') });
    expect([409, 422]).toContain(early.status);
    const past = await admin.post('/appointments', { customerId: customerB, employeeId: employee, serviceIds: [service], startTime: '2020-01-06T10:00' });
    expect([400, 409, 422]).toContain(past.status);
  });

  test('concurrent bookings for the same slot produce exactly one appointment', async () => {
    const start = at(shift(180));
    const customers = await Promise.all([1, 2, 3, 4].map((i) => admin.post('/customers', { fullName: `Race ${i}`, phone: uniquePhone() })));
    const results = await Promise.all(customers.map((c) => admin.post('/appointments', { customerId: c.body.data.id, employeeId: employee, serviceIds: [service], startTime: start })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
  });

  test('update, reschedule, cancel and complete follow the status rules', async () => {
    const created = await admin.post('/appointments', { customerId: customerB, employeeId: employee, serviceIds: [service], startTime: at(shift(240)) });
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    const notes = await admin.patch(`/appointments/${id}`, { notes: 'Bring reference photo' });
    expect(notes.status).toBe(200);
    const moved = await admin.patch(`/appointments/${id}/reschedule`, { startTime: at(shift(300)) });
    expect(moved.status).toBe(200);

    const confirmed = await admin.post(`/appointments/${id}/status`, { status: 'confirmed' });
    expect(confirmed.body.data.status).toBe('confirmed');
    const cancelled = await admin.post(`/appointments/${id}/status`, { status: 'cancelled', reason: 'Customer travelling' });
    expect(cancelled.body.data.status).toBe('cancelled');
    // A cancelled appointment cannot be completed.
    const invalid = await admin.post(`/appointments/${id}/status`, { status: 'completed' });
    expect(invalid.status).toBeGreaterThanOrEqual(400);

    // The freed slot can be booked again.
    const rebooked = await admin.post('/appointments', { customerId: customerA, employeeId: employee, serviceIds: [service], startTime: at(shift(300)) });
    expect(rebooked.status).toBe(201);
  });

  test('calendar returns the booked appointments for the day', async () => {
    const res = await admin.get(`/appointments/calendar?from=${day.date}&to=${day.date}&employeeId=${employee}`);
    expect(res.status).toBe(200);
    const list = Array.isArray(res.body.data) ? res.body.data : res.body.data.appointments;
    expect(list.length).toBeGreaterThanOrEqual(3);
  });
});
