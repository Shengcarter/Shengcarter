'use strict';

const zlib = require('zlib');
const { signIn, DEMO, getApp, request } = require('./helpers');

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
});
