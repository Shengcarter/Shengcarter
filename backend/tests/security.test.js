'use strict';

const config = require('../src/config');
const createApp = require('../src/app');
const { getApp, signIn, request, db, DEMO } = require('./helpers');

/**
 * Cross-cutting protections: security headers, HTTPS-only mode, error
 * responses that never leak internals, logged permission refusals, the
 * security checklist and injection attempts.
 */
describe('security headers', () => {
  test('every response carries the protective headers', async () => {
    const res = await request(await getApp()).get('/api/health');
    const h = res.headers;
    expect(h['content-security-policy']).toMatch(/default-src 'self'/);
    expect(h['content-security-policy']).toMatch(/object-src 'none'/);
    expect(h['content-security-policy']).toMatch(/frame-ancestors 'self'/);
    expect(h['content-security-policy']).toMatch(/script-src 'self'(;|$)/);
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('SAMEORIGIN');
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['permissions-policy']).toMatch(/camera=\(self\)/);
    expect(h['permissions-policy']).toMatch(/geolocation=\(\)/);
    expect(h['x-powered-by']).toBeUndefined();
    // Plain-HTTP (development / LAN) install: no HSTS.
    expect(h['strict-transport-security']).toBeUndefined();
  });

  test('HTTPS-only mode redirects pages, refuses API calls over HTTP and sends HSTS', async () => {
    const before = config.auth.forceHttps;
    config.auth.forceHttps = true;
    try {
      const app = createApp();
      const page = await request(app).get('/login');
      expect(page.status).toBe(301);
      expect(page.headers.location).toMatch(/^https:\/\//);
      const api = await request(app).post('/api/auth/login').send({ email: 'a@b.c', password: 'x' });
      expect(api.status).toBe(403);
      expect(api.body.code).toBe('HTTPS_REQUIRED');
      const health = await request(app).get('/api/health');
      expect(health.status).toBe(200);
      expect(health.headers['strict-transport-security']).toMatch(/max-age=31536000/);
    } finally {
      config.auth.forceHttps = before;
    }
  });
});

describe('error responses', () => {
  test('in production, unexpected errors never reveal messages, SQL, stack traces or credentials', () => {
    jest.isolateModules(() => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const { errorHandler } = require('../src/middleware/errorHandler');
        const err = new Error(`ER_PARSE_ERROR: You have an error in your SQL syntax near 'SELECT * FROM users WHERE password_hash' using password ${config.db.password || 'secret'}`);
        err.sql = 'SELECT * FROM users';
        let status;
        let body;
        const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
        errorHandler(err, { method: 'GET', originalUrl: '/api/x' }, res, () => {});
        expect(status).toBe(500);
        const text = JSON.stringify(body);
        expect(body.message).toBe('Something went wrong. Please try again or contact your administrator.');
        expect(text).not.toMatch(/SQL|SELECT|password|stack|ER_PARSE/i);
        expect(body.debug).toBeUndefined();
      } finally {
        process.env.NODE_ENV = previous;
      }
    });
  });

  test('bad JSON and unknown routes get short, safe answers', async () => {
    const server = await getApp();
    const bad = await request(server).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ success: false, code: 'INVALID_JSON' });
    expect(JSON.stringify(bad.body)).not.toMatch(/at .*\.js/);
    // Signed out: 401 for everything (which routes exist is not revealed); signed in: 404.
    expect((await request(server).get('/api/does-not-exist')).status).toBe(401);
    expect((await (await signIn()).get('/does-not-exist')).status).toBe(404);
  });
});

describe('authorization and input handling', () => {
  test('a refused request is logged with who, what and the permission it needed', async () => {
    const stylist = await signIn(DEMO.stylist);
    expect((await stylist.get('/sales')).status).toBe(403);
    const log = await db.queryOne(
      "SELECT user_id, metadata FROM activity_logs WHERE action = 'auth.permission_denied' ORDER BY id DESC LIMIT 1",
    );
    expect(log.metadata).toMatchObject({ method: 'GET', path: '/api/sales', needs: ['sales.view'] });
  });

  test('the security checklist is for administrators and reports the plain-HTTP install', async () => {
    const admin = await signIn();
    const res = await admin.get('/settings/security-check');
    expect(res.status).toBe(200);
    const https = res.body.data.checks.find((c) => c.id === 'https');
    expect(https.status).toBe('warn');
    expect(JSON.stringify(res.body)).not.toContain(config.auth.jwtSecret);
    const receptionist = await signIn(DEMO.receptionist);
    expect((await receptionist.get('/settings/security-check')).status).toBe(403);
  });

  test('injection attempts in search, sorting and ids are treated as plain values', async () => {
    const admin = await signIn();
    const customers = await db.queryOne('SELECT COUNT(*) AS n FROM customers WHERE deleted_at IS NULL');
    const search = await admin.get(`/customers?search=${encodeURIComponent("' OR 1=1 -- ")}&limit=100`);
    expect(search.status).toBe(200);
    expect(search.body.data.length).toBeLessThan(Number(customers.n));
    const sort = await admin.get(`/customers?sortBy=${encodeURIComponent('name; DROP TABLE customers')}`);
    expect([200, 422]).toContain(sort.status);
    expect((await db.queryOne('SELECT COUNT(*) AS n FROM customers WHERE deleted_at IS NULL')).n).toBe(customers.n);
    expect((await admin.get(`/customers/${encodeURIComponent('1 OR 1=1')}`)).status).toBe(422);
    // Script in a name is stored as text and returned as text (React escapes it on screen).
    const xss = await admin.post('/customers', { fullName: '<img src=x onerror=alert(1)>', phone: `+2557${Date.now().toString().slice(-8)}` });
    expect(xss.status).toBe(201);
    expect(xss.body.data.fullName).toBe('<img src=x onerror=alert(1)>');
    expect(xss.headers['content-type']).toMatch(/application\/json/);
  });
});

describe('no one can give more rights than they hold', () => {
  let admin;
  let manager;
  let superAdminId;
  let receptionistRoleId;
  const PASSWORD = 'Manager2026!';

  beforeAll(async () => {
    admin = await signIn();
    // A custom role that may manage users and roles, but is not the Super Admin.
    const role = await admin.post('/roles', { name: `Manager ${Date.now()}`, permissions: ['users.manage', 'roles.manage', 'customers.view'] });
    expect(role.status).toBe(201);
    const email = `manager.${Date.now()}@test.local`;
    await admin.post('/users', { fullName: 'Shop Manager', email, roleId: role.body.data.id, password: PASSWORD });
    await db.query('UPDATE users SET must_change_password = 0 WHERE email = ?', [email]);
    manager = await signIn({ email, password: PASSWORD });
    superAdminId = (await db.queryOne("SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.slug = 'super_admin' ORDER BY u.id LIMIT 1")).id;
    receptionistRoleId = (await db.queryOne("SELECT id FROM roles WHERE slug = 'receptionist'")).id;
  });

  test('a manager cannot create, promote or take over a Super Admin', async () => {
    const superRole = (await db.queryOne("SELECT id FROM roles WHERE slug = 'super_admin'")).id;
    const created = await manager.post('/users', { fullName: 'Sneaky Admin', email: `sneaky.${Date.now()}@test.local`, roleId: superRole, password: PASSWORD });
    expect(created.status).toBe(403);
    expect((await manager.post(`/users/${superAdminId}/reset-password`, { password: 'Takeover2026!' })).status).toBe(403);
    expect((await manager.patch(`/users/${superAdminId}`, { isActive: false })).status).toBe(403);
    expect((await manager.post(`/users/${superAdminId}/reset-two-factor`)).status).toBe(403);
    expect((await manager.patch(`/users/${manager.loginResponse.body.data.user.id}`, { roleId: superRole })).status).toBe(403); // not even their own role
  });

  test('a manager cannot give a role with rights they lack, nor add such rights to a role', async () => {
    const res = await manager.post('/users', { fullName: 'Front Desk', email: `desk.${Date.now()}@test.local`, roleId: receptionistRoleId, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/permissions you do not have/);
    expect((await manager.post('/roles', { name: `Backup role ${Date.now()}`, permissions: ['backups.manage'] })).status).toBe(403);
    expect((await manager.patch(`/roles/${receptionistRoleId}`, { permissions: ['customers.view'] })).status).toBe(403);
    // Within their own rights it works.
    const small = await manager.post('/roles', { name: `Viewer ${Date.now()}`, permissions: ['customers.view'] });
    expect(small.status).toBe(201);
    const user = await manager.post('/users', { fullName: 'Viewer Person', email: `viewer.${Date.now()}@test.local`, roleId: small.body.data.id, password: PASSWORD });
    expect(user.status).toBe(201);
  });
});
