'use strict';

const ExcelJS = require('exceljs');
const { DateTime } = require('luxon');
const { signIn, DEMO, getApp, request, db } = require('./helpers');
const settings = require('../src/services/settingsService');

/** Build an .xlsx upload from a header row and data rows. */
async function workbook(rows, sheetName = 'Sheet1') {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet(sheetName).addRows(rows);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function upload(token, url, buffer, fileName, fields = {}) {
  const server = await getApp();
  const req = request(server).post(`/api${url}`).set('Authorization', `Bearer ${token}`);
  for (const [k, v] of Object.entries(fields)) req.field(k, v);
  return req.attach('file', buffer, fileName);
}

describe('sales charge exactly the listed price', () => {
  test('no tax is added by default', async () => {
    const admin = await signIn();
    const s = await db.queryOne('SELECT s.id, s.price, es.employee_id FROM services s JOIN employee_services es ON es.service_id = s.id WHERE s.is_active = 1 LIMIT 1');
    const quote = await admin.post('/sales/quote', { items: [{ type: 'service', serviceId: s.id, employeeId: s.employee_id }] });
    expect(quote.status).toBe(200);
    expect(quote.body.data.taxMode).toBe('none');
    expect(quote.body.data.taxAmount).toBe(0);
    expect(quote.body.data.total).toBe(Number(s.price));
  });
});

describe('importing customers', () => {
  let admin;
  let existing;

  beforeAll(async () => {
    admin = await signIn();
    existing = await db.queryOne('SELECT phone, full_name FROM customers WHERE deleted_at IS NULL LIMIT 1');
  });

  const file = () => workbook([
    // The user's own headings: close to the template's, not identical.
    ['Name', 'Phone number', 'E-mail', 'Sex', 'DOB', 'Location', 'Comments', 'Promotions', 'Channel'],
    ['Import Test Asha', '0799 111 001', 'asha.import@example.com', 'Female', '14/02/1994', 'Sinza', 'Likes braids', 'Yes', 'WhatsApp'],
    ['Import Test Juma', 799111002, '', 'M', new Date(Date.UTC(1990, 4, 20)), '', '', 'no', 'sms'],
    ['Import Test Copy', '+255799111001', '', '', '', '', '', '', ''],
    ['Already Here', existing.phone, '', '', '', '', '', '', ''],
    ['', '0799111005', '', '', '', '', '', '', ''],
    ['Import Test Bad Gender', '0799111006', '', 'abc', '', '', '', '', ''],
    ['Import Test Bad Email', '0799111007', 'not-an-email', '', '', '', '', '', ''],
  ]);

  test('the template downloads as an Excel workbook', async () => {
    const res = await admin.download('/imports/customers/template');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/spreadsheetml/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body);
    expect(wb.worksheets[0].getRow(1).values).toEqual(expect.arrayContaining(['Full name*', 'Phone*']));
  });

  test('preview checks every row and saves nothing', async () => {
    const before = await db.queryOne('SELECT COUNT(*) AS n FROM customers');
    const res = await upload(admin.token, '/imports/customers/preview', await file(), 'my customers.xlsx');
    expect(res.status).toBe(200);
    const { summary, rows, columns } = res.body.data;
    expect(summary).toMatchObject({ rows: 7, ready: 2, skipped: 2, errors: 3, newCustomers: 2 });
    expect(columns.mapped.map((c) => c.key)).toEqual(expect.arrayContaining(['fullName', 'phone', 'email', 'gender', 'dateOfBirth']));
    const byRow = Object.fromEntries(rows.map((r) => [r.rowNumber, r]));
    expect(byRow[3].display.phone).toBe('+255799111002'); // leading zero lost in Excel is fine
    expect(byRow[4].messages[0]).toMatch(/row 2/);
    expect(byRow[5].messages[0]).toMatch(/Already registered/);
    expect(byRow[6].status).toBe('error');
    expect(byRow[7].messages.join(' ')).toMatch(/Gender/);
    expect(byRow[8].messages.join(' ')).toMatch(/Email/i);
    expect((await db.queryOne('SELECT COUNT(*) AS n FROM customers')).n).toBe(before.n);
  });

  test('rows with problems block the import until the user chooses to skip them', async () => {
    const blocked = await upload(admin.token, '/imports/customers', await file(), 'customers.xlsx');
    expect(blocked.status).toBe(422);
    const res = await upload(admin.token, '/imports/customers', await file(), 'customers.xlsx', { skipInvalid: 'true' });
    expect(res.status).toBe(201);
    expect(res.body.data.imported).toBe(2);
    const asha = await db.queryOne('SELECT full_name, email, gender, date_of_birth, marketing_opt_in, preferred_channel, code FROM customers WHERE phone = ?', ['+255799111001']);
    expect(asha).toMatchObject({ full_name: 'Import Test Asha', email: 'asha.import@example.com', gender: 'female', date_of_birth: '1994-02-14', marketing_opt_in: 1, preferred_channel: 'whatsapp' });
    expect(asha.code).toMatch(/^CUS-\d{6}$/);
    const juma = await db.queryOne('SELECT gender, date_of_birth, marketing_opt_in FROM customers WHERE phone = ?', ['+255799111002']);
    expect(juma).toMatchObject({ gender: 'male', date_of_birth: '1990-05-20', marketing_opt_in: 0 });
    const log = await db.queryOne("SELECT description FROM activity_logs WHERE action = 'customers.imported' ORDER BY id DESC LIMIT 1");
    expect(log.description).toMatch(/Imported 2 customers/);
  });

  test('importing the same file again adds nothing', async () => {
    const res = await upload(admin.token, '/imports/customers', await file(), 'customers.xlsx', { skipInvalid: 'true' });
    expect(res.status).toBe(400);
  });

  test('CSV files work too, including semicolon-separated ones from Excel', async () => {
    const csv = Buffer.from('﻿Full name;Phone;Notes\n"Import Test, CSV";0799111010;"Said ""hi"""\n', 'utf8');
    const res = await upload(admin.token, '/imports/customers', csv, 'customers.csv');
    expect(res.status).toBe(201);
    const row = await db.queryOne('SELECT full_name, notes FROM customers WHERE phone = ?', ['+255799111010']);
    expect(row).toEqual({ full_name: 'Import Test, CSV', notes: 'Said "hi"' });
  });

  test('files that are not spreadsheets, or lack required columns, are refused', async () => {
    const fake = await upload(admin.token, '/imports/customers/preview', Buffer.from('MZ not a workbook'), 'evil.xlsx');
    expect(fake.status).toBe(422);
    const exe = await upload(admin.token, '/imports/customers/preview', Buffer.from('x'), 'tool.exe');
    expect(exe.status).toBe(422);
    const noPhone = await upload(admin.token, '/imports/customers/preview', await workbook([['Name'], ['Somebody']]), 'x.xlsx');
    expect(noPhone.status).toBe(422);
    expect(noPhone.body.errors[0].message).toMatch(/"Phone"/);
  });

  test('importing needs the import permission', async () => {
    const stylist = await signIn(DEMO.stylist);
    expect((await upload(stylist.token, '/imports/customers/preview', await file(), 'c.xlsx')).status).toBe(403);
    const receptionist = await signIn(DEMO.receptionist);
    expect((await upload(receptionist.token, '/imports/customers/preview', await file(), 'c.xlsx')).status).toBe(200);
    expect((await upload(receptionist.token, '/imports/sales/preview', await file(), 's.xlsx')).status).toBe(403);
  });
});

describe('importing past sales', () => {
  let admin;
  let service;
  let product;
  let staff;
  let customer;
  let day;
  const header = ['Date', 'Time', 'Receipt no', 'Customer phone', 'Customer name', 'Type', 'Item', 'Staff', 'Quantity', 'Amount', 'Payment method', 'Notes'];

  beforeAll(async () => {
    admin = await signIn();
    await settings.load();
    service = await db.queryOne('SELECT id, name, price FROM services WHERE is_active = 1 ORDER BY id LIMIT 1');
    product = await db.queryOne("SELECT id, name, selling_price, purchase_price, quantity FROM products WHERE status = 'active' AND quantity > 0 ORDER BY id LIMIT 1");
    staff = await db.queryOne("SELECT id, full_name FROM employees WHERE status = 'active' ORDER BY id LIMIT 1");
    customer = await db.queryOne('SELECT id, phone, full_name, loyalty_points, visit_count, total_spent FROM customers WHERE deleted_at IS NULL ORDER BY id LIMIT 1');
    day = DateTime.now().setZone(settings.get('system.timezone')).minus({ days: 10 });
  });

  const file = async () => workbook([
    header,
    // Receipt R-9001: a service and a product together, existing customer, M-Pesa.
    [day.toFormat('dd/MM/yyyy'), '10:30', 'R-9001', customer.phone, customer.full_name, 'Service', service.name, staff.full_name, 1, 12345, 'M-Pesa', ''],
    [day.toFormat('dd/MM/yyyy'), '10:30', 'R-9001', customer.phone, customer.full_name, 'Product', product.name, '', 2, '', 'M-Pesa', ''],
    // Receipt R-9002: a new customer.
    [day.toJSDate(), '', 'R-9002', '0799222001', 'Import Sale Customer', '', service.name, '', 1, '5,000', 'cash', 'Paid late'],
    // No receipt number: a walk-in on its own.
    [day.toISODate(), '15:00', '', '', '', '', service.name, '', '', 4000, 'Card', ''],
    // Problems.
    [day.toISODate(), '', 'R-9003', '', '', '', 'Unicorn Treatment', '', 1, 1000, 'cash', ''],
    [DateTime.now().plus({ days: 3 }).toISODate(), '', 'R-9004', '', '', '', service.name, '', 1, 1000, 'cash', ''],
    [day.toISODate(), '', 'R-9005', '', '', '', service.name, '', 1, 1000, 'cash', ''],
    [day.minus({ days: 1 }).toISODate(), '', 'R-9005', '', '', '', service.name, '', 1, 1000, 'cash', ''],
  ], 'Sales');

  test('preview groups rows into sales and explains every problem', async () => {
    const res = await upload(admin.token, '/imports/sales/preview', await file(), 'old sales.xlsx');
    expect(res.status).toBe(200);
    const { summary, rows } = res.body.data;
    const productTotal = Number(product.selling_price) * 2;
    expect(summary).toMatchObject({ rows: 8, ready: 4, errors: 4, sales: 3, newCustomers: 1, total: 12345 + productTotal + 5000 + 4000 });
    const byRow = Object.fromEntries(rows.map((r) => [r.rowNumber, r]));
    expect(byRow[3].messages[0]).toMatch(/price list/);
    expect(byRow[4].messages.join(' ')).toMatch(/new customer/);
    expect(byRow[6].messages[0]).toMatch(/No service or product called "Unicorn Treatment"/);
    expect(byRow[7].messages[0]).toMatch(/future/);
    expect(byRow[9].messages[0]).toMatch(/different date/);
    expect(byRow[8].status).toBe('error'); // its sale (R-9005) is imported whole or not at all
  });

  test('imported sales record the exact amounts without touching stock, loyalty or commission', async () => {
    const stockBefore = (await db.queryOne('SELECT quantity FROM products WHERE id = ?', [product.id])).quantity;
    const res = await upload(admin.token, '/imports/sales', await file(), 'old sales.xlsx', { skipInvalid: 'true' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ imported: 3, rows: 4, newCustomers: 1 });

    const r1 = await db.queryOne("SELECT * FROM sales WHERE import_reference = 'R-9001'");
    expect(r1).toMatchObject({ is_imported: 1, customer_id: customer.id, tax_amount: 0, balance_due: 0, payment_status: 'paid' });
    expect(Number(r1.total)).toBe(12345 + Number(product.selling_price) * 2);
    expect(Number(r1.cost_of_goods)).toBe(Number(product.purchase_price) * 2);
    const local = DateTime.fromJSDate(r1.sold_at).setZone(settings.get('system.timezone'));
    expect(local.toFormat('yyyy-MM-dd HH:mm')).toBe(`${day.toISODate()} 10:30`);
    const items = await db.query('SELECT item_type, employee_id, line_total, commission_amount FROM sale_items WHERE sale_id = ? ORDER BY id', [r1.id]);
    expect(items).toEqual([
      { item_type: 'service', employee_id: staff.id, line_total: 12345, commission_amount: 0 },
      { item_type: 'product', employee_id: null, line_total: Number(product.selling_price) * 2, commission_amount: 0 },
    ]);
    expect((await db.queryOne('SELECT method, amount FROM payments WHERE sale_id = ?', [r1.id]))).toEqual({ method: 'mobile_money', amount: Number(r1.total) });
    expect((await db.queryOne('SELECT COUNT(*) AS n FROM commissions WHERE sale_id = ?', [r1.id])).n).toBe(0);
    expect((await db.queryOne('SELECT quantity FROM products WHERE id = ?', [product.id])).quantity).toBe(stockBefore);

    const after = await db.queryOne('SELECT loyalty_points, visit_count, total_spent FROM customers WHERE id = ?', [customer.id]);
    expect(after.loyalty_points).toBe(customer.loyalty_points);
    expect(after.visit_count).toBe(customer.visit_count + 1);
    expect(Number(after.total_spent)).toBeCloseTo(Number(customer.total_spent) + Number(r1.total), 2);

    const created = await db.queryOne("SELECT id, full_name, marketing_opt_in FROM customers WHERE phone = '+255799222001'");
    expect(created).toMatchObject({ full_name: 'Import Sale Customer', marketing_opt_in: 0 });
    expect(Number((await db.queryOne("SELECT total FROM sales WHERE import_reference = 'R-9002'")).total)).toBe(5000);
  });

  test('importing the same file again skips the receipts that are already in', async () => {
    const res = await upload(admin.token, '/imports/sales/preview', await file(), 'old sales.xlsx');
    const byRow = Object.fromEntries(res.body.data.rows.map((r) => [r.rowNumber, r]));
    expect(byRow[2].status).toBe('skip');
    expect(byRow[2].messages[0]).toMatch(/already imported/);
    expect(byRow[4].status).toBe('skip');
  });

  test('refunding an imported sale does not put stock back', async () => {
    const r1 = await db.queryOne("SELECT id FROM sales WHERE import_reference = 'R-9001'");
    const stockBefore = (await db.queryOne('SELECT quantity FROM products WHERE id = ?', [product.id])).quantity;
    const res = await admin.post(`/sales/${r1.id}/refund`, { reason: 'Import test refund' });
    expect(res.status).toBe(200);
    expect((await db.queryOne('SELECT quantity FROM products WHERE id = ?', [product.id])).quantity).toBe(stockBefore);
  });

  test('the accountant may import sales and download the template', async () => {
    const accountant = await signIn(DEMO.accountant);
    expect((await upload(accountant.token, '/imports/sales/preview', await file(), 's.xlsx')).status).toBe(200);
    expect((await accountant.download('/imports/sales/template')).status).toBe(200);
  });
});
