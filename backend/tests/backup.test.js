'use strict';

const path = require('path');
const zlib = require('zlib');
const config = require('../src/config');
const db = require('../src/config/database');
const backupService = require('../src/services/backupService');
const { signIn, DEMO, getApp, request, uniquePhone } = require('./helpers');

describe('backups', () => {
  test('an administrator can create, download and delete a backup', async () => {
    const admin = await signIn();
    const created = await admin.post('/backups', {});
    expect(created.status).toBe(201);
    const backup = created.body.data;
    expect(backup.status).toBe('completed');
    expect(backup.filename).toMatch(/^zola-backup-\d{8}-\d{6}\.sql\.gz$/);

    const file = await admin.download(`/backups/${backup.id}/download`);
    expect(file.status).toBe(200);
    const sql = zlib.gunzipSync(file.body).toString('utf8');
    expect(sql).toContain('ZOLA STYLISH MANAGEMENT SYSTEM database backup');
    expect(sql).toContain('CREATE TABLE `sales`');
    expect(sql).toMatch(/INSERT INTO `customers`/);

    expect((await admin.delete(`/backups/${backup.id}`)).status).toBe(200);
    expect((await admin.get(`/backups/${backup.id}/download`)).status).toBe(404);
  });

  test('backups are never publicly reachable and require backups.manage', async () => {
    const admin = await signIn();
    const { filename, id } = (await admin.post('/backups', {})).body.data;
    const server = await getApp();
    expect((await request(server).get('/api/backups')).status).toBe(401);
    expect((await request(server).get(`/api/backups/${id}/download`)).status).toBe(401);
    // No public path serves backup files (unknown paths fall back to the web app page).
    for (const url of [`/storage/backups/${filename}`, `/backups/${filename}`, `/uploads/../backups/${filename}`, `/uploads/..%2fbackups/${filename}`]) {
      const res = await request(server).get(url).buffer(true);
      const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.text || '');
      expect(res.headers['content-type'] || '').not.toMatch(/gzip|octet-stream/);
      expect(body.slice(0, 2).equals(Buffer.from([0x1f, 0x8b]))).toBe(false);
    }
    const accountant = await signIn(DEMO.accountant);
    expect((await accountant.post('/backups', {})).status).toBe(403);
    expect((await accountant.get(`/backups/${id}/download`)).status).toBe(403);
    await admin.delete(`/backups/${id}`);
  });

  test('restoring a backup brings back the earlier data and is recorded in the activity log', async () => {
    const admin = await signIn();
    // Non-ASCII text inside a JSON column must survive the round trip unchanged.
    const unicode = 'Saluni ya Zola — Café ✂️';
    await db.query("INSERT INTO activity_logs (action, metadata) VALUES ('test.unicode', ?)", [JSON.stringify({ name: unicode })]);
    const { id, filename } = (await admin.post('/backups', {})).body.data;
    const [{ total: salesBefore }] = await db.query('SELECT COUNT(*) AS total FROM sales');

    const phone = uniquePhone();
    const added = await admin.post('/customers', { fullName: 'Added After Backup', phone });
    expect(added.status).toBe(201);

    await backupService.restoreFile(path.join(config.paths.backups, filename));

    expect(await db.queryOne('SELECT id FROM customers WHERE phone = ?', [added.body.data.phone])).toBeFalsy();
    const [{ total: salesAfter }] = await db.query('SELECT COUNT(*) AS total FROM sales');
    expect(salesAfter).toBe(salesBefore);
    const backup = await db.queryOne('SELECT status FROM backups WHERE id = ?', [id]);
    expect(backup.status).toBe('completed');
    const log = await db.queryOne("SELECT description FROM activity_logs WHERE action = 'backup.restored' ORDER BY id DESC LIMIT 1");
    expect(log.description).toContain(filename);
    const kept = await db.queryOne("SELECT JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.name')) AS name FROM activity_logs WHERE action = 'test.unicode'");
    expect(kept.name).toBe(unicode);

    // The restored database is fully usable.
    const again = await signIn();
    expect((await again.get('/customers?limit=1')).status).toBe(200);
    await again.delete(`/backups/${id}`);
  });
});
