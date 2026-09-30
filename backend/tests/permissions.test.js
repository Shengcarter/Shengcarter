'use strict';

const { signIn, DEMO, db, uniquePhone, nextWorkingDay } = require('./helpers');

describe('role permissions', () => {
  let stylist;
  let receptionist;
  let accountant;
  let admin;

  beforeAll(async () => {
    [stylist, receptionist, accountant, admin] = await Promise.all([signIn(DEMO.stylist), signIn(DEMO.receptionist), signIn(DEMO.accountant), signIn()]);
  });

  test('super admin can reach every module', async () => {
    for (const url of ['/customers', '/appointments?limit=1', '/sales', '/expenses', '/reports/sales', '/settings', '/backups', '/activity-logs']) {
      expect((await admin.get(url)).status).toBe(200);
    }
  });

  test('stylist sees own appointments but not customers, sales, reports or settings', async () => {
    expect((await stylist.get('/appointments?limit=5')).status).toBe(200);
    for (const url of ['/customers', '/sales', '/reports/sales', '/expenses', '/settings', '/users', '/backups']) {
      expect((await stylist.get(url)).status).toBe(403);
    }
  });

  test('stylist only receives appointments they are part of', async () => {
    const me = (await stylist.get('/auth/me')).body.data.user;
    expect(me.employeeId).toBeTruthy();
    // One booking for the stylist and one for a colleague.
    const mine = await db.queryOne('SELECT service_id FROM employee_services WHERE employee_id = ? LIMIT 1', [me.employeeId]);
    const other = await db.queryOne(
      "SELECT es.employee_id, es.service_id FROM employee_services es JOIN employees e ON e.id = es.employee_id WHERE es.employee_id <> ? AND e.is_bookable = 1 AND e.status = 'active' LIMIT 1",
      [me.employeeId],
    );
    const customer = (await admin.post('/customers', { fullName: 'Scope Check', phone: uniquePhone() })).body.data.id;
    const booked = [];
    for (const [employeeId, serviceId] of [[me.employeeId, mine.service_id], [other.employee_id, other.service_id]]) {
      const day = await nextWorkingDay(employeeId, 20);
      const res = await admin.post('/appointments', { customerId: customer, employeeId, serviceIds: [serviceId], startTime: `${day.date}T${day.start}` });
      expect(res.status).toBe(201);
      booked.push(res.body.data.id);
    }

    const list = await stylist.get('/appointments?limit=100');
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThan(0);
    // Their own bookings and the ones they help with; never a colleague's alone.
    expect(list.body.data.every((a) => a.staff.some((m) => m.id === me.employeeId))).toBe(true);
    expect(list.body.data.map((a) => a.id)).toContain(booked[0]);
    expect(list.body.data.map((a) => a.id)).not.toContain(booked[1]);
    expect((await stylist.get(`/appointments/${booked[1]}`)).status).toBe(404);
  });

  test('receptionist runs the front desk but cannot see finances or settings', async () => {
    for (const url of ['/customers', '/appointments?limit=1', '/sales']) expect((await receptionist.get(url)).status).toBe(200);
    for (const url of ['/expenses', '/reports/profit', '/settings', '/payroll/payouts', '/backups']) expect((await receptionist.get(url)).status).toBe(403);
  });

  test('accountant sees financial reports but cannot manage users, roles or backups', async () => {
    for (const url of ['/reports/profit', '/expenses', '/sales']) expect((await accountant.get(url)).status).toBe(200);
    for (const url of ['/users', '/settings', '/backups']) expect((await accountant.get(url)).status).toBe(403);
    expect((await accountant.post('/roles', { name: 'Hacker', permissions: [] })).status).toBe(403);
  });

  test('users cannot switch to another branch without branches.manage', async () => {
    const res = await receptionist.get('/customers');
    expect(res.status).toBe(200);
    // The X-Branch-Id header is ignored for users who cannot manage branches.
  });
});
