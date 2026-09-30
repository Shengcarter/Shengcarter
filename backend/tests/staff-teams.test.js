'use strict';

const { DateTime } = require('luxon');
const { signIn, DEMO, uniquePhone, nextWorkingDay, getApp, request, db } = require('./helpers');
const settings = require('../src/services/settingsService');

/**
 * Several staff members on one appointment or service. Every member's time is
 * blocked, each sees the appointment, and at the POS the service's value and
 * commission are shared equally between the people who performed it.
 */
describe('appointments and services done by several staff', () => {
  let admin;
  let customerId;
  let A; // Tumaini: 40 % commission, does braids and wash
  let B; // Upendo: 20 %, does braids and wash
  let C; // Wema: 10 %, does neither
  let braids; // 10,001 with its own 30 % rate
  let wash; // 30,000 with no rate of its own
  let day;
  const at = (minutesAfterOpening) => {
    const [h, m] = day.start.split(':').map(Number);
    const total = h * 60 + m + minutesAfterOpening;
    return `${day.date}T${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  };
  const staffIds = (appointment) => appointment.staff.map((m) => m.id);

  beforeAll(async () => {
    admin = await signIn();
    const category = (await db.queryOne('SELECT id FROM service_categories ORDER BY id LIMIT 1')).id;
    const employee = async (fullName, commissionRate) => (await admin.post('/employees', { fullName, jobTitle: 'Stylist', commissionRate })).body.data.id;
    A = await employee('Tumaini Teamwork', 40);
    B = await employee('Upendo Teamwork', 20);
    C = await employee('Wema Teamwork', 10);
    braids = (await admin.post('/services', { categoryId: category, name: 'Team Braids', price: 10001, durationMinutes: 60, commissionRate: 30, employeeIds: [A, B] })).body.data.id;
    wash = (await admin.post('/services', { categoryId: category, name: 'Team Wash', price: 30000, durationMinutes: 30, commissionRate: null, employeeIds: [A, B] })).body.data.id;
    customerId = (await admin.post('/customers', { fullName: 'Team Customer', phone: uniquePhone() })).body.data.id;
    day = await nextWorkingDay(A, 40);
  });

  test('one appointment for two people blocks both and shows for both', async () => {
    const res = await admin.post('/appointments', { customerId, employeeIds: [A, B], serviceIds: [braids], startTime: at(60) });
    expect(res.status).toBe(201);
    const appt = res.body.data;
    expect(appt.employeeId).toBe(A);
    expect(staffIds(appt)).toEqual([A, B]);
    expect(appt.staff.map((m) => m.fullName)).toEqual(['Tumaini Teamwork', 'Upendo Teamwork']);

    // Upendo is busy then, even though Tumaini leads the appointment.
    const other = (await admin.post('/customers', { fullName: 'Other Customer', phone: uniquePhone() })).body.data.id;
    const clash = await admin.post('/appointments', { customerId: other, employeeIds: [B], serviceIds: [wash], startTime: at(90) });
    expect(clash.status).toBe(409);
    expect(clash.body.message).toMatch(/^Upendo Teamwork is already booked/);

    const calendar = await admin.get(`/appointments/calendar?from=${day.date}&to=${day.date}&employeeId=${B}`);
    expect(calendar.body.data.map((a) => a.id)).toContain(appt.id);
    expect(staffIds(calendar.body.data.find((a) => a.id === appt.id))).toEqual([A, B]);

    const both = await admin.get(`/appointments/availability?employeeIds=${A},${B}&date=${day.date}&serviceIds=${braids}`);
    const slot = (list, iso) => list.find((s) => DateTime.fromISO(s.start).toMillis() === DateTime.fromISO(iso, { zone: settings.get('system.timezone') }).toMillis());
    expect(slot(both.body.data.slots, at(60)).available).toBe(false);
    expect(slot(both.body.data.slots, at(240)).available).toBe(true);
    const wemaAlone = await admin.get(`/appointments/availability?employeeIds=${C}&date=${day.date}&serviceIds=${braids}`);
    expect(slot(wemaAlone.body.data.slots, at(60)).available).toBe(true);
  });

  test('every service must be done by someone in the team', async () => {
    const alone = await admin.post('/appointments', { customerId, employeeIds: [C], serviceIds: [braids], startTime: at(300) });
    expect(alone.status).toBe(422);
    expect(alone.body.errors[0].message).toBe('Wema Teamwork does not perform: Team Braids');
    const withHelper = await admin.post('/appointments', { customerId, employeeIds: [A, C], serviceIds: [braids], startTime: at(300) });
    expect(withHelper.status).toBe(201);
    expect(staffIds(withHelper.body.data)).toEqual([A, C]);
    const duplicate = await admin.post('/appointments', { customerId, employeeIds: [A, A], serviceIds: [braids], startTime: at(420) });
    expect(duplicate.status).toBe(422);
  });

  test('moving one person\'s part on the calendar keeps the rest of the team', async () => {
    const appt = (await admin.post('/appointments', { customerId, employeeIds: [A, B], serviceIds: [wash], startTime: at(480) })).body.data;
    const moved = await admin.patch(`/appointments/${appt.id}/reschedule`, { startTime: at(480), fromEmployeeId: B, employeeId: C });
    expect(moved.status).toBe(200);
    expect(staffIds(moved.body.data)).toEqual([A, C]);
    const onTeam = await admin.patch(`/appointments/${appt.id}/reschedule`, { startTime: at(480), fromEmployeeId: C, employeeId: A });
    expect(onTeam.status).toBe(400);
    // Editing the team in the form replaces it.
    const edited = await admin.patch(`/appointments/${appt.id}`, { employeeIds: [B, A] });
    expect(edited.status).toBe(200);
    expect(edited.body.data.employeeId).toBe(B);
    expect(staffIds(edited.body.data)).toEqual([B, A]);
  });

  test('a stylist sees and is told about appointments they help with', async () => {
    const stylist = await db.queryOne('SELECT e.id FROM employees e JOIN users u ON u.id = e.user_id WHERE u.email = ?', [DEMO.stylist.email]);
    const appt = (await admin.post('/appointments', { customerId, employeeIds: [A, stylist.id], serviceIds: [wash], startTime: at(540) })).body.data;
    const me = await signIn(DEMO.stylist);
    expect((await me.get(`/appointments/${appt.id}`)).status).toBe(200);
    const calendar = await me.get(`/appointments/calendar?from=${day.date}&to=${day.date}`);
    expect(calendar.body.data.map((a) => a.id)).toContain(appt.id);
    const note = await db.queryOne(
      "SELECT n.message FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.email = ? AND n.type = 'appointment.created' AND n.link = ?",
      [DEMO.stylist.email, `/appointments?appointment=${appt.id}`],
    );
    expect(note.message).toMatch(/^Team Customer booked with you and Tumaini on /);
  });

  test('checkout pre-fills everyone on the appointment', async () => {
    const appt = (await admin.post('/appointments', { customerId, employeeIds: [B, A], serviceIds: [braids, wash], startTime: at(600) })).body.data;
    const checkout = await admin.get(`/sales/appointment/${appt.id}`);
    expect(checkout.body.data.employeeIds).toEqual([B, A]);
    expect(checkout.body.data.serviceIds).toEqual([braids, wash]);
  });

  let sharedSaleId;
  test('a service done by two people shares its value and commission equally, to the shilling', async () => {
    const res = await admin.post('/sales', {
      customerId,
      items: [{ type: 'service', serviceId: braids, employeeIds: [A, B] }],
      payments: [{ method: 'cash', amount: 10001 }],
    });
    expect(res.status).toBe(201);
    sharedSaleId = res.body.data.id;
    const [line] = res.body.data.items;
    expect(line.commissionAmount).toBe(3000); // 30 % of 10,001, rounded to the shilling
    expect(line.employeeId).toBe(A);
    expect(line.staff).toEqual([
      { id: A, fullName: 'Tumaini Teamwork', revenueShare: 5001, commissionAmount: 1500 },
      { id: B, fullName: 'Upendo Teamwork', revenueShare: 5000, commissionAmount: 1500 },
    ]);
    const commissions = await db.query('SELECT employee_id, base_amount, rate, amount FROM commissions WHERE sale_id = ? ORDER BY employee_id', [sharedSaleId]);
    expect(commissions.map((c) => [c.employee_id, Number(c.base_amount), Number(c.rate), Number(c.amount)])).toEqual([[A, 5001, 30, 1500], [B, 5000, 30, 1500]]);
  });

  test('without a service rate, each person earns their own rate on an equal share', async () => {
    const res = await admin.post('/sales', { items: [{ type: 'service', serviceId: wash, employeeIds: [A, B] }], payments: [{ method: 'cash', amount: 30000 }] });
    const [line] = res.body.data.items;
    expect(line.staff.map((m) => [m.id, m.revenueShare, m.commissionAmount])).toEqual([[A, 15000, 6000], [B, 15000, 3000]]);
    expect(line.commissionAmount).toBe(9000);
    expect(line.commissionRate).toBe(30); // effective rate for the line
  });

  test('three people: shares still add up exactly', async () => {
    const res = await admin.post('/sales', { items: [{ type: 'service', serviceId: braids, employeeIds: [A, B, C] }], payments: [{ method: 'cash', amount: 10001 }] });
    const [line] = res.body.data.items;
    expect(line.staff.map((m) => m.revenueShare)).toEqual([3334, 3334, 3333]);
    expect(line.staff.map((m) => m.commissionAmount)).toEqual([1000, 1000, 1000]);
    expect(line.staff.reduce((s, m) => s + m.revenueShare, 0)).toBe(10001);
  });

  test('older clients sending one employeeId still work, and a line needs someone', async () => {
    const single = await admin.post('/sales', { items: [{ type: 'service', serviceId: wash, employeeId: B }], payments: [{ method: 'cash', amount: 30000 }] });
    expect(single.status).toBe(201);
    expect(single.body.data.items[0].staff.map((m) => [m.id, m.commissionAmount])).toEqual([[B, 6000]]);
    const nobody = await admin.post('/sales', { items: [{ type: 'service', serviceId: wash, employeeIds: [] }], payments: [{ method: 'cash', amount: 30000 }] });
    expect(nobody.status).toBe(422);
  });

  test('performance and staff reports credit each person with their share', async () => {
    const today = DateTime.now().setZone(settings.get('system.timezone')).toISODate();
    const perf = async (id) => (await admin.get(`/employees/${id}/performance?from=${today}&to=${today}`)).body.data;
    const a = await perf(A);
    expect(a.servicesCompleted).toBe(3);
    expect(a.revenue).toBe(5001 + 15000 + 3334);
    expect(a.commissionEarned).toBe(1500 + 6000 + 1000);
    const c = await perf(C);
    expect(c.revenue).toBe(3333);
    expect(c.commissionEarned).toBe(1000);

    const report = (await admin.get(`/reports/staff?from=${today}&to=${today}`)).body.data;
    const row = (id) => report.staff.find((r) => r.id === id);
    expect(row(B).revenue).toBe(5000 + 15000 + 3334 + 30000);
  });

  test('a refund reverses every person\'s share', async () => {
    const res = await admin.post(`/sales/${sharedSaleId}/refund`, { reason: 'Test refund of a shared service' });
    expect(res.status).toBe(200);
    const rows = await db.query('SELECT status FROM commissions WHERE sale_id = ?', [sharedSaleId]);
    expect(rows.map((r) => r.status)).toEqual(['reversed', 'reversed']);
  });

  test('imported past sales accept several staff names on one line', async () => {
    const csv = [
      'Date,Receipt no,Item,Staff,Amount',
      `${DateTime.now().minus({ days: 3 }).toFormat('dd/MM/yyyy')},TEAM-IMPORT-1,Team Braids,Tumaini & Upendo,12000`,
    ].join('\n');
    const server = await getApp();
    const res = await request(server).post('/api/imports/sales').set('Authorization', `Bearer ${admin.token}`).attach('file', Buffer.from(csv), 'team.csv');
    expect(res.status).toBe(201);
    const item = await db.queryOne(
      "SELECT si.id, si.employee_id, si.commission_amount FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE s.import_reference = 'TEAM-IMPORT-1'",
    );
    expect(item.employee_id).toBe(A);
    expect(Number(item.commission_amount)).toBe(0);
    const shares = await db.query('SELECT employee_id, revenue_share, commission_amount FROM sale_item_staff WHERE sale_item_id = ? ORDER BY sort_order', [item.id]);
    expect(shares.map((s) => [s.employee_id, Number(s.revenue_share), Number(s.commission_amount)])).toEqual([[A, 6000, 0], [B, 6000, 0]]);
    expect(await db.query('SELECT id FROM commissions WHERE sale_item_id = ?', [item.id])).toHaveLength(0);
  });
});
