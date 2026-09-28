'use strict';

const { signIn, uniquePhone } = require('./helpers');

describe('customer CRUD', () => {
  let admin;
  beforeAll(async () => {
    admin = await signIn();
  });

  test('create, read, update, search and delete a customer', async () => {
    const phone = uniquePhone();
    const created = await admin.post('/customers', { fullName: 'Test Customer', phone, email: 'test.customer@example.com', gender: 'female' });
    expect(created.status).toBe(201);
    const customer = created.body.data;
    expect(customer.code).toMatch(/^CUS-\d{6}$/);
    expect(customer.phone).toBe(phone);

    const read = await admin.get(`/customers/${customer.id}`);
    expect(read.status).toBe(200);
    expect(read.body.data.fullName).toBe('Test Customer');

    const updated = await admin.patch(`/customers/${customer.id}`, { fullName: 'Test Customer Renamed', notes: 'Prefers morning visits' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.fullName).toBe('Test Customer Renamed');

    const search = await admin.get(`/customers?search=${encodeURIComponent('Renamed')}`);
    expect(search.body.data.some((c) => c.id === customer.id)).toBe(true);
    const byPhone = await admin.get(`/customers?search=${encodeURIComponent(phone.slice(-6))}`);
    expect(byPhone.body.data.some((c) => c.id === customer.id)).toBe(true);

    const deleted = await admin.delete(`/customers/${customer.id}`);
    expect(deleted.status).toBe(200);
    expect((await admin.get(`/customers/${customer.id}`)).status).toBe(404);
  });

  test('local phone formats are normalised and duplicates are rejected', async () => {
    const phone = uniquePhone();
    const local = `0${phone.slice(4)}`; // +2557xx… → 07xx…
    const created = await admin.post('/customers', { fullName: 'Local Format', phone: local });
    expect(created.status).toBe(201);
    expect(created.body.data.phone).toBe(phone);

    const duplicate = await admin.post('/customers', { fullName: 'Duplicate', phone });
    expect([409, 422]).toContain(duplicate.status);
  });

  test('invalid input is rejected with field errors', async () => {
    const res = await admin.post('/customers', { fullName: '', phone: '12' });
    expect(res.status).toBe(422);
    const fields = res.body.errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['fullName', 'phone']));
  });

  test('customer history includes appointments, purchases and notes', async () => {
    const created = await admin.post('/customers', { fullName: 'History Check', phone: uniquePhone() });
    const id = created.body.data.id;
    const note = await admin.post(`/customers/${id}/notes`, { note: 'Allergic to ammonia-based dyes' });
    expect(note.status).toBe(201);
    const notes = await admin.get(`/customers/${id}/notes`);
    expect(notes.body.data.some((n) => n.note.includes('ammonia'))).toBe(true);
    expect((await admin.get(`/customers/${id}/appointments`)).status).toBe(200);
    expect((await admin.get(`/customers/${id}/purchases`)).status).toBe(200);
  });
});
