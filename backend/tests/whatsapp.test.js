'use strict';

const crypto = require('crypto');
const { DateTime } = require('luxon');
const { signIn, uniquePhone, nextWorkingDay, getApp, db, request } = require('./helpers');
const settings = require('../src/services/settingsService');
const messaging = require('../src/services/messaging');
const { classifyReply } = require('../src/services/messaging/replies');

const APP_SECRET = 'test-app-secret-for-webhooks';
const VERIFY_TOKEN = 'zola-verify-123';
const TWILIO_TOKEN = 'test-twilio-auth-token';

/** A WhatsApp Cloud API webhook body with one incoming message. */
function metaMessage({ from, text, id = `wamid.${crypto.randomUUID()}`, contextId = null, type = 'text' }) {
  const message = { from: from.replace(/^\+/, ''), id, timestamp: String(Math.floor(Date.now() / 1000)), type };
  if (type === 'text') message.text = { body: text };
  if (type === 'button') message.button = { text, payload: text };
  if (contextId) message.context = { from: '255700000000', id: contextId };
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: '1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '42' }, messages: [message] } }] }],
  };
}

async function postMeta(body, { secret = APP_SECRET } = {}) {
  const raw = JSON.stringify(body);
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  return request(await getApp()).post('/api/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(raw);
}

describe('WhatsApp confirmations, replies and thank-you messages', () => {
  let admin;
  let employee;
  let employeeUserId;
  let service;
  const days = [];
  let dayIndex = 0;
  let slotInDay = 0;

  const customer = async (name) => {
    const phone = uniquePhone();
    const id = (await admin.post('/customers', { fullName: name, phone })).body.data.id;
    return { id, phone };
  };
  const toMinutes = (hhmm) => hhmm.split(':').map(Number).reduce((h, m) => h * 60 + m);
  /**
   * The next free 90-minute slot on the stylist's working days, five or more
   * days ahead (the appointment tests use the same stylist three days ahead;
   * the reminder test needs a slot within a week).
   */
  const nextSlot = async () => {
    for (;;) {
      if (!days[dayIndex]) {
        const ahead = dayIndex === 0 ? 5 : DateTime.fromISO(days[dayIndex - 1].date).diff(DateTime.now().startOf('day'), 'days').days + 1;
        days[dayIndex] = await nextWorkingDay(employee, Math.ceil(ahead));
      }
      const day = days[dayIndex];
      const minutes = toMinutes(day.start) + 60 + slotInDay * 90;
      if (minutes + 120 <= toMinutes(day.end)) {
        slotInDay += 1;
        return `${day.date}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
      }
      dayIndex += 1;
      slotInDay = 0;
    }
  };
  const book = async (customerId, extra = {}) => {
    const res = await admin.post('/appointments', { customerId, employeeId: employee, serviceIds: [service], startTime: await nextSlot(), ...extra });
    expect(res.status).toBe(201);
    return res.body.data;
  };
  const messagesFor = (customerId, template) => db.query(
    'SELECT * FROM message_logs WHERE customer_id = ? AND template = ? ORDER BY id',
    [customerId, template],
  );

  beforeAll(async () => {
    admin = await signIn();
    const link = await db.queryOne(
      `SELECT es.employee_id, es.service_id, e.user_id FROM employee_services es
       JOIN employees e ON e.id = es.employee_id JOIN services s ON s.id = es.service_id
       WHERE e.is_bookable = 1 AND e.status = 'active' AND s.is_active = 1 AND s.duration_minutes <= 60
       ORDER BY e.user_id IS NULL, e.id DESC, s.id LIMIT 1`,
    );
    employee = link.employee_id;
    employeeUserId = link.user_id;
    service = link.service_id;
    const res = await admin.put('/settings/integrations', {
      whatsapp_app_secret: APP_SECRET,
      whatsapp_verify_token: VERIFY_TOKEN,
      twilio_auth_token: TWILIO_TOKEN,
    });
    expect(res.status).toBe(200);
  });

  afterAll(async () => {
    await admin.put('/settings/integrations', {
      whatsapp_provider: 'log', whatsapp_app_secret: null, whatsapp_verify_token: '', twilio_auth_token: null, whatsapp_templates: {},
    });
  });

  test('customer messages go by WhatsApp by default', async () => {
    const channels = settings.get('notifications.channels');
    expect(channels.appointment_confirmation).toEqual(['whatsapp']);
    expect(channels.appointment_reminder).toEqual(['whatsapp']);
    expect(channels.payment_receipt).toEqual(['whatsapp']);
    const templates = settings.get('notifications.templates');
    expect(templates.appointment_confirmation).toMatch(/reply YES to confirm/);
    expect(templates.payment_receipt).toMatch(/welcoming you again/);
  });

  test('a booking sends a WhatsApp confirmation that asks the customer to confirm or report a delay', async () => {
    const c = await customer('Wanjiru Confirm');
    const appt = await book(c.id);
    const [message] = await messagesFor(c.id, 'appointment_confirmation');
    expect(message.channel).toBe('whatsapp');
    expect(message.recipient).toBe(c.phone);
    expect(message.body).toContain('Please reply YES to confirm');
    expect(message.body).toContain('LATE');
    expect(message.body).toContain(appt.code);
    // Values for the approved template, in the order they appear in the text.
    expect(message.template_params[0]).toBe('Wanjiru');
    expect(message.template_params).toContain(appt.code);
    expect(message.related_id).toBe(appt.id);
  });

  test('walk-ins get no confirmation; a booking inside the reminder window gets no second reminder', async () => {
    const walkIn = await customer('Walk In Person');
    await book(walkIn.id, { source: 'walk_in' });
    expect(await messagesFor(walkIn.id, 'appointment_confirmation')).toHaveLength(0);

    const soon = await customer('Soon Booker');
    const hours = settings.get('notifications.reminder_hours_before');
    await admin.put('/settings/notifications', { reminder_hours_before: 168 });
    try {
      const appt = await book(soon.id);
      const row = await db.queryOne('SELECT reminder_sent_at FROM appointments WHERE id = ?', [appt.id]);
      expect(row.reminder_sent_at).not.toBeNull();
    } finally {
      await admin.put('/settings/notifications', { reminder_hours_before: hours });
    }
  });

  test('an approved template is sent with its values (Meta and Twilio)', async () => {
    const c = await customer('Template Customer');
    await book(c.id);
    await admin.put('/settings/integrations', {
      whatsapp_provider: 'meta_cloud',
      whatsapp_phone_number_id: '123456',
      whatsapp_access_token: 'test-token',
      whatsapp_templates: { appointment_confirmation: { name: 'booking_confirmation', language: 'en' } },
    });
    const calls = [];
    const fetchSpy = jest.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.sent-${calls.length}` }], sid: `SM${calls.length}` }), { status: 200 });
    });
    try {
      await messaging.processQueue({ batchSize: 500 });
      const meta = calls.map((c) => JSON.parse(c.init.body)).find((b) => b.to === c.phone.slice(1));
      expect(meta.type).toBe('template');
      expect(meta.template.name).toBe('booking_confirmation');
      expect(meta.template.language.code).toBe('en');
      expect(meta.template.components[0].parameters[0]).toEqual({ type: 'text', text: 'Template' });
      const [logged] = await messagesFor(c.id, 'appointment_confirmation');
      expect(logged.status).toBe('sent');
      expect(logged.provider_ref).toMatch(/^wamid\.sent-/);

      // Twilio: the template field holds the Content SID; values are numbered.
      const t = await customer('Twilio Customer');
      await book(t.id);
      await admin.put('/settings/integrations', {
        whatsapp_provider: 'twilio', twilio_account_sid: 'AC123', twilio_from: '+14155550000',
        whatsapp_templates: { appointment_confirmation: { name: 'HX0123456789abcdef0123456789abcdef', language: '' } },
      });
      calls.length = 0;
      await messaging.processQueue({ batchSize: 500 });
      const form = calls.map((c) => new URLSearchParams(c.init.body)).find((f) => f.get('To') === `whatsapp:${t.phone}`);
      expect(form.get('ContentSid')).toBe('HX0123456789abcdef0123456789abcdef');
      expect(JSON.parse(form.get('ContentVariables'))['1']).toBe('Twilio');
      expect(form.get('Body')).toBeNull();
    } finally {
      fetchSpy.mockRestore();
      await admin.put('/settings/integrations', { whatsapp_provider: 'log', whatsapp_access_token: null, whatsapp_templates: {} });
    }
  });

  test('the webhook refuses unsigned or wrongly signed requests', async () => {
    const server = await getApp();
    const body = metaMessage({ from: uniquePhone(), text: 'YES' });
    expect((await request(server).post('/api/webhooks/whatsapp').send(body)).status).toBe(401);
    expect((await postMeta(body, { secret: 'not-the-secret' })).status).toBe(401);
    const form = await request(server).post('/api/webhooks/whatsapp').type('form').set('X-Twilio-Signature', 'bad').send({ From: 'whatsapp:+255700000001', Body: 'YES' });
    expect(form.status).toBe(401);
  });

  test('Meta webhook verification needs the verify token from Settings', async () => {
    const server = await getApp();
    const ok = await request(server).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN, 'hub.challenge': '1158201444' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('1158201444');
    const bad = await request(server).get('/api/webhooks/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'guess', 'hub.challenge': '1' });
    expect(bad.status).toBe(403);
  });

  test('YES confirms the appointment and thanks the customer', async () => {
    const c = await customer('Neema Yes');
    const appt = await book(c.id);
    expect(appt.status).toBe('pending');
    const res = await postMeta(metaMessage({ from: c.phone, text: 'Yes, see you then' }));
    expect(res.status).toBe(200);
    const row = await db.queryOne('SELECT status, confirmed_at, customer_response, customer_response_at FROM appointments WHERE id = ?', [appt.id]);
    expect(row.status).toBe('confirmed');
    expect(row.confirmed_at).not.toBeNull();
    expect(row.customer_response).toBe('confirmed');
    const [incoming] = await db.query("SELECT * FROM message_logs WHERE customer_id = ? AND direction = 'inbound'", [c.id]);
    expect(incoming.status).toBe('received');
    expect(incoming.body).toBe('Yes, see you then');
    expect(incoming.related_id).toBe(appt.id);
    const [ack] = await messagesFor(c.id, 'reply_confirmed');
    expect(ack.channel).toBe('whatsapp');
    expect(ack.body).toMatch(/Thank you, Neema! Your appointment on .+ is confirmed/);

    const detail = await admin.get(`/appointments/${appt.id}`);
    expect(detail.body.data.customerResponse).toBe('confirmed');
  });

  test('LATE 15 records the delay and alerts the front desk and the stylist', async () => {
    const c = await customer('Halima Late');
    const appt = await book(c.id);
    const before = (await db.queryOne("SELECT COALESCE(MAX(id), 0) AS id FROM notifications")).id;
    expect((await postMeta(metaMessage({ from: c.phone, text: 'Nitachelewa dakika 15' }))).status).toBe(200);
    const row = await db.queryOne('SELECT status, customer_response, customer_delay_minutes, customer_response_note FROM appointments WHERE id = ?', [appt.id]);
    expect(row.customer_response).toBe('late');
    expect(row.customer_delay_minutes).toBe(15);
    expect(row.status).toBe('confirmed');
    expect(row.customer_response_note).toBe('Nitachelewa dakika 15');
    const alerts = await db.query("SELECT user_id, title, message, link FROM notifications WHERE id > ? AND type = 'appointment.customer_late'", [before]);
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts[0].message).toContain('about 15 minutes late');
    expect(alerts[0].link).toBe(`/appointments?appointment=${appt.id}`);
    if (employeeUserId) expect(alerts.map((a) => a.user_id)).toContain(employeeUserId);
    const [ack] = await messagesFor(c.id, 'reply_late');
    expect(ack.body).toContain('about 15 minutes late');
  });

  test('a reply goes to the appointment it answers, and resent messages are handled once', async () => {
    const c = await customer('Two Bookings');
    const first = await book(c.id);
    const second = await book(c.id);
    // The customer answers the confirmation of the second booking.
    await db.query("UPDATE message_logs SET provider_ref = 'wamid.second-confirmation' WHERE related_type = 'appointment' AND related_id = ? AND template = 'appointment_confirmation'", [second.id]);
    const body = metaMessage({ from: c.phone, text: 'Confirm', type: 'button', contextId: 'wamid.second-confirmation', id: 'wamid.reply-once' });
    expect((await postMeta(body)).status).toBe(200);
    expect((await postMeta(body)).status).toBe(200); // WhatsApp retry
    expect((await db.queryOne('SELECT customer_response FROM appointments WHERE id = ?', [second.id])).customer_response).toBe('confirmed');
    expect((await db.queryOne('SELECT customer_response FROM appointments WHERE id = ?', [first.id])).customer_response).toBeNull();
    expect(await db.query("SELECT id FROM message_logs WHERE provider_ref = 'wamid.reply-once'")).toHaveLength(1);
    expect(await messagesFor(c.id, 'reply_confirmed')).toHaveLength(1);
  });

  test('CANCEL asks the front desk to call; other messages are passed on; STOP ends automatic messages', async () => {
    const c = await customer('Rehema Cancel');
    const appt = await book(c.id);
    const before = (await db.queryOne("SELECT COALESCE(MAX(id), 0) AS id FROM notifications")).id;
    await postMeta(metaMessage({ from: c.phone, text: "Sorry I can't make it, can we change?" }));
    const row = await db.queryOne('SELECT status, customer_response FROM appointments WHERE id = ?', [appt.id]);
    expect(row.customer_response).toBe('cancel_request');
    expect(row.status).toBe('pending'); // staff decide; nothing is cancelled automatically
    const cancelAlert = await db.queryOne("SELECT message FROM notifications WHERE id > ? AND type = 'appointment.customer_cancel_request' LIMIT 1", [before]);
    expect(cancelAlert.message).toContain(c.phone);

    await postMeta(metaMessage({ from: c.phone, text: 'Do you also do nails?' }));
    const note = await db.queryOne("SELECT title, message FROM notifications WHERE id > ? AND type = 'customer.whatsapp_message' LIMIT 1", [before]);
    expect(note.title).toBe('WhatsApp message from Rehema Cancel');
    expect(note.message).toContain('Do you also do nails?');
    expect((await db.queryOne('SELECT customer_response FROM appointments WHERE id = ?', [appt.id])).customer_response).toBe('cancel_request');

    await postMeta(metaMessage({ from: c.phone, text: 'STOP' }));
    const stopped = await db.queryOne('SELECT preferred_channel, marketing_opt_in FROM customers WHERE id = ?', [c.id]);
    expect(stopped).toEqual({ preferred_channel: 'none', marketing_opt_in: 0 });
    await book(c.id);
    expect(await messagesFor(c.id, 'appointment_confirmation')).toHaveLength(1); // only the one before STOP
  });

  test('a message from an unknown number reaches the front desk', async () => {
    const before = (await db.queryOne("SELECT COALESCE(MAX(id), 0) AS id FROM notifications")).id;
    const phone = uniquePhone();
    await postMeta(metaMessage({ from: phone, text: 'Hi, are you open on Sunday?' }));
    const note = await db.queryOne("SELECT title, message FROM notifications WHERE id > ? AND type = 'customer.whatsapp_message' LIMIT 1", [before]);
    expect(note.title).toBe(`WhatsApp message from ${phone}`);
    expect(note.message).toContain('not a registered customer');
  });

  test('Twilio replies are accepted with a valid signature', async () => {
    const c = await customer('Twilio Reply');
    const appt = await book(c.id);
    const server = await getApp();
    const form = { From: `whatsapp:${c.phone}`, Body: 'LATE 20', MessageSid: `SM${crypto.randomUUID().replace(/-/g, '')}` };
    // Supertest calls the app on 127.0.0.1:<port>; sign that exact URL.
    const agent = request(server);
    const sign = (url) => crypto.createHmac('sha1', TWILIO_TOKEN)
      .update(url + Object.keys(form).sort().map((k) => `${k}${form[k]}`).join('')).digest('base64');
    const req = agent.post('/api/webhooks/whatsapp').type('form');
    const url = new URL(req.url);
    const res = await req.set('X-Twilio-Signature', sign(`http://${url.host}/api/webhooks/whatsapp`)).send(form);
    expect(res.status).toBe(200);
    expect(res.text).toBe('<Response></Response>');
    const row = await db.queryOne('SELECT customer_response, customer_delay_minutes FROM appointments WHERE id = ?', [appt.id]);
    expect(row).toEqual({ customer_response: 'late', customer_delay_minutes: 20 });
  });

  test('moving the appointment clears the old reply', async () => {
    const c = await customer('Move Me');
    const appt = await book(c.id);
    await postMeta(metaMessage({ from: c.phone, text: 'yes' }));
    const res = await admin.patch(`/appointments/${appt.id}`, { startTime: await nextSlot() });
    expect(res.status).toBe(200);
    expect(res.body.data.customerResponse).toBeNull();
  });

  test('WhatsApp delivery failures are shown in the message log', async () => {
    const c = await customer('Failed Delivery');
    await book(c.id);
    const [message] = await messagesFor(c.id, 'appointment_confirmation');
    await db.query("UPDATE message_logs SET status = 'sent', provider_ref = 'wamid.will-fail' WHERE id = ?", [message.id]);
    const body = {
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.will-fail', status: 'failed', errors: [{ code: 131047, title: 'Re-engagement message' }] }] } }] }],
    };
    expect((await postMeta(body)).status).toBe(200);
    const row = await db.queryOne('SELECT status, last_error FROM message_logs WHERE id = ?', [message.id]);
    expect(row.status).toBe('failed');
    expect(row.last_error).toBe('Re-engagement message (131047)');
  });

  test('the customer is thanked after paying, including when paying later', async () => {
    const pick = await db.queryOne(
      `SELECT s.id, s.price, es.employee_id FROM services s JOIN employee_services es ON es.service_id = s.id
       JOIN employees e ON e.id = es.employee_id WHERE s.is_active = 1 AND e.status = 'active' LIMIT 1`,
    );
    const items = [{ type: 'service', serviceId: pick.id, employeeId: pick.employee_id }];

    const paidNow = await customer('Zawadi Paid');
    const sale = (await admin.post('/sales', { customerId: paidNow.id, items, payments: [{ method: 'cash', amount: Number(pick.price) }] })).body.data;
    const [thanks] = await messagesFor(paidNow.id, 'payment_receipt');
    expect(thanks.channel).toBe('whatsapp');
    expect(thanks.body).toContain('Thank you for choosing');
    expect(thanks.body).toContain(`TZS ${Number(pick.price).toLocaleString('en')}`);
    expect(thanks.body).toContain(sale.invoiceNumber);
    expect(thanks.body).toContain('welcoming you again soon');

    const payLater = await customer('Baraka Later');
    const unpaid = (await admin.post('/sales', { customerId: payLater.id, items })).body.data;
    expect(unpaid.paymentStatus).toBe('unpaid');
    expect(await messagesFor(payLater.id, 'payment_receipt')).toHaveLength(0);
    await admin.post(`/sales/${unpaid.id}/payments`, { method: 'cash', amount: 1000 });
    await admin.post(`/sales/${unpaid.id}/payments`, { method: 'cash', amount: unpaid.balanceDue - 1000 });
    const later = await messagesFor(payLater.id, 'payment_receipt');
    expect(later).toHaveLength(1); // thanked once, with the first payment
    expect(later[0].body).toContain('TZS 1,000');
  });
});

describe('understanding replies', () => {
  test.each([
    ['Yes', 'confirmed', null],
    ['Ndiyo nitakuja', 'confirmed', null],
    ['👍', 'confirmed', null],
    ["I won't be late", 'confirmed', null],
    ['LATE 15', 'late', 15],
    ['stuck in traffic, 30 min', 'late', 30],
    ['Nitachelewa saa moja', 'late', 60],
    ['nitachelewa kidogo', 'late', null],
    ["can't make it today", 'cancel_request', null],
    ['Sitakuja', 'cancel_request', null],
    ['STOP', 'stop', null],
    ['Do you do braids?', 'message', null],
  ])('%s → %s', (text, intent, minutes) => {
    expect(classifyReply(text)).toEqual({ intent, minutes });
  });
});
