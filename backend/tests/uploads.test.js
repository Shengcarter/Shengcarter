'use strict';

const fs = require('fs');
const net = require('net');
const path = require('path');
const config = require('../src/config');
const { getApp, signIn, request, db, DEMO } = require('./helpers');

/**
 * Upload security: private expense receipts, and virus scanning through a
 * stand-in for the ClamAV daemon (same INSTREAM protocol). The "virus" is a
 * harmless marker, so no real test signature is stored in the repository.
 */
const MARKER = 'ZOLA-TEST-MALWARE-MARKER';
const pdf = (extra = '') => Buffer.from(`%PDF-1.4\n% receipt\n${extra}\n%%EOF\n`);

/** A minimal clamd: answers OK, or FOUND when the stream contains the marker. */
function fakeClamd() {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);
      if (!buffer.subarray(0, 10).equals(Buffer.from('zINSTREAM\0'))) return;
      let offset = 10;
      const parts = [];
      while (offset + 4 <= buffer.length) {
        const size = buffer.readUInt32BE(offset);
        if (size === 0) {
          const content = Buffer.concat(parts).toString('latin1');
          socket.end(content.includes(MARKER) ? 'stream: Zola.Test.Marker FOUND\0' : 'stream: OK\0');
          return;
        }
        if (offset + 4 + size > buffer.length) return;
        parts.push(buffer.subarray(offset + 4, offset + 4 + size));
        offset += 4 + size;
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

describe('upload security', () => {
  let admin;
  let expenseId;
  const scanner = config.uploads.scanner;
  const original = { ...scanner };

  const attach = async (id, buffer, name = 'receipt.pdf', type = 'application/pdf') => request(await getApp())
    .post(`/api/expenses/${id}/attachment`)
    .set('Authorization', `Bearer ${admin.token}`)
    .attach('attachment', buffer, { filename: name, contentType: type });

  beforeAll(async () => {
    admin = await signIn();
    const category = (await admin.get('/expenses/categories')).body.data[0];
    const created = await admin.post('/expenses', {
      categoryId: category.id, expenseDate: new Date().toISOString().slice(0, 10), amount: 12000, description: 'Upload security test',
    });
    expect(created.status).toBe(201);
    expenseId = created.body.data.id;
  });

  afterEach(() => Object.assign(scanner, original));

  test('expense receipts are private: not at a public address, only through the API for people who see expenses', async () => {
    const res = await attach(expenseId, pdf());
    expect(res.status).toBe(200);
    const stored = res.body.data.attachment;
    expect(stored).toMatch(/^\/uploads\/expenses\//);

    expect((await request(await getApp()).get(stored)).status).toBe(404);

    const file = await admin.download(`/expenses/${expenseId}/attachment`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('application/pdf');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['cache-control']).toMatch(/no-store/);
    expect(file.body.subarray(0, 5).toString()).toBe('%PDF-');

    const stylist = await signIn(DEMO.stylist);
    expect((await stylist.get(`/expenses/${expenseId}/attachment`)).status).toBe(403);
    const accountant = await signIn(DEMO.accountant);
    expect((await accountant.download(`/expenses/${expenseId}/attachment`)).status).toBe(200);
  });

  test('a file the virus scanner flags is refused, deleted and logged; a clean one is kept', async () => {
    const server = await fakeClamd();
    Object.assign(scanner, { host: '127.0.0.1', port: server.address().port, required: false });
    try {
      const before = fs.readdirSync(path.join(config.paths.uploads, 'expenses')).length;
      const infected = await attach(expenseId, pdf(MARKER));
      expect(infected.status).toBe(422);
      expect(infected.body.errors[0].message).toMatch(/virus scanner/);
      expect(fs.readdirSync(path.join(config.paths.uploads, 'expenses')).length).toBe(before);
      const log = await db.queryOne("SELECT metadata FROM activity_logs WHERE action = 'upload.malware_blocked' ORDER BY id DESC LIMIT 1");
      expect(log.metadata).toMatchObject({ signature: 'Zola.Test.Marker', fileName: 'receipt.pdf' });

      expect((await attach(expenseId, pdf('clean'))).status).toBe(200);

      // Spreadsheet imports are scanned too.
      const csv = await request(await getApp()).post('/api/imports/customers/preview').set('Authorization', `Bearer ${admin.token}`)
        .attach('file', Buffer.from(`Full name,Phone\n${MARKER},0712000000\n`), 'customers.csv');
      expect(csv.status).toBe(422);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test('with the scanner down, uploads continue unless scanning is required', async () => {
    const closed = await fakeClamd();
    const { port } = closed.address();
    await new Promise((resolve) => closed.close(resolve)); // nothing listens there now
    Object.assign(scanner, { host: '127.0.0.1', port, timeoutMs: 2000, required: false });
    expect((await attach(expenseId, pdf('optional'))).status).toBe(200);
    Object.assign(scanner, { required: true });
    const refused = await attach(expenseId, pdf('required'));
    expect(refused.status).toBe(503);
    expect(refused.body.code).toBe('SCANNER_UNAVAILABLE');
  });

  test('a file whose content does not match its type is refused', async () => {
    const res = await attach(expenseId, Buffer.from('MZ this is not a pdf'), 'receipt.pdf');
    expect(res.status).toBe(422);
    const exe = await attach(expenseId, Buffer.from('MZ'), 'tool.exe', 'application/octet-stream');
    expect(exe.status).toBe(422);
  });
});
