'use strict';

const bcrypt = require('bcryptjs');
const { getApp, signIn, request, db, ADMIN, DEMO, uniquePhone } = require('./helpers');

describe('authentication', () => {
  test('login returns an access token and sets an httpOnly refresh cookie', async () => {
    const admin = await signIn();
    const res = admin.loginResponse;
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.user.email).toBe(ADMIN.email);
    const cookie = res.headers['set-cookie'].join(';');
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);
  });

  test('passwords are stored as bcrypt hashes', async () => {
    const row = await db.queryOne('SELECT password_hash FROM users WHERE email = ?', [ADMIN.email]);
    expect(row.password_hash).not.toBe(ADMIN.password);
    expect(row.password_hash).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare(ADMIN.password, row.password_hash)).toBe(true);
  });

  test('wrong password is rejected without revealing which part was wrong', async () => {
    const server = await getApp();
    const res = await request(server).post('/api/auth/login').send({ email: ADMIN.email, password: 'NotThePassword1!' });
    expect(res.status).toBe(401);
    const unknown = await request(server).post('/api/auth/login').send({ email: 'nobody@test.local', password: 'NotThePassword1!' });
    expect(unknown.status).toBe(401);
    expect(unknown.body.message).toBe(res.body.message);
  });

  test('protected endpoints require a valid token', async () => {
    const server = await getApp();
    expect((await request(server).get('/api/customers')).status).toBe(401);
    expect((await request(server).get('/api/customers').set('Authorization', 'Bearer not-a-token')).status).toBe(401);
  });

  test('account locks after repeated failed logins', async () => {
    const admin = await signIn();
    const roles = await admin.get('/roles');
    const receptionistRole = roles.body.data.find((r) => r.slug === 'receptionist');
    const email = `lockout.${Date.now()}@test.local`;
    const created = await admin.post('/users', { fullName: 'Lockout Tester', email, roleId: receptionistRole.id, password: 'LockTest2026!' });
    expect(created.status).toBe(201);

    const server = await getApp();
    for (let i = 0; i < 5; i += 1) await request(server).post('/api/auth/login').send({ email, password: 'WrongPass2026!' });
    const locked = await request(server).post('/api/auth/login').send({ email, password: 'LockTest2026!' });
    expect(locked.status).toBe(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  test('new accounts must change their password before using the system', async () => {
    const admin = await signIn();
    const roles = await admin.get('/roles');
    const role = roles.body.data.find((r) => r.slug === 'accountant');
    const email = `firstlogin.${Date.now()}@test.local`;
    await admin.post('/users', { fullName: 'First Login', email, roleId: role.id, password: 'FirstLogin2026!' });

    const user = await signIn({ email, password: 'FirstLogin2026!' });
    const blocked = await user.get('/customers');
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await user.post('/auth/change-password', { currentPassword: 'FirstLogin2026!', newPassword: 'SecondLogin2026!', confirmPassword: 'SecondLogin2026!' });
    expect(changed.status).toBe(200);
    const fresh = await signIn({ email, password: 'SecondLogin2026!' });
    expect((await fresh.get('/customers')).status).toBe(200);
  });

  test('refresh rotates the token and logout revokes the session', async () => {
    const server = await getApp();
    const agent = request.agent(server);
    const login = await agent.post('/api/auth/login').send(ADMIN);
    expect(login.status).toBe(200);

    const refreshed = await agent.post('/api/auth/refresh');
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.accessToken).toBeTruthy();

    const logout = await agent.post('/api/auth/logout');
    expect(logout.status).toBe(200);
    const after = await agent.post('/api/auth/refresh');
    expect(after.status).toBe(401);
  });

  test('reusing a rotated refresh token revokes the whole session family', async () => {
    const server = await getApp();
    const login = await request(server).post('/api/auth/login').send(ADMIN);
    const firstCookie = login.headers['set-cookie'].find((c) => c.startsWith('zola_rt=')).split(';')[0];

    const rotated = await request(server).post('/api/auth/refresh').set('Cookie', firstCookie);
    expect(rotated.status).toBe(200);
    const secondCookie = rotated.headers['set-cookie'].find((c) => c.startsWith('zola_rt=')).split(';')[0];

    // Replaying the old token after the grace window is treated as theft.
    await db.query('UPDATE refresh_tokens SET revoked_at = DATE_SUB(revoked_at, INTERVAL 5 MINUTE) WHERE revoked_at IS NOT NULL');
    const replay = await request(server).post('/api/auth/refresh').set('Cookie', firstCookie);
    expect(replay.status).toBe(401);
    const stolen = await request(server).post('/api/auth/refresh').set('Cookie', secondCookie);
    expect(stolen.status).toBe(401);
  });
});

describe('own details (My profile)', () => {
  test('anyone signed in can change their own name and phone, and the session shows it', async () => {
    const accountant = await signIn(DEMO.accountant);
    const before = accountant.loginResponse.body.data.user;
    const phone = uniquePhone();
    try {
      const res = await accountant.patch('/users/me', { fullName: '  Grace Kimaro ', phone, email: 'someone.else@test.local', roleId: 1 });
      expect(res.status).toBe(200);
      expect(res.body.data.fullName).toBe('Grace Kimaro');

      // The greeting reads the session, so /auth/me must carry the new name.
      const me = await accountant.get('/auth/me');
      expect(me.body.data.user.fullName).toBe('Grace Kimaro');
      expect(me.body.data.user.phone).toBe(phone);
      // Email and role are not self-service: extra fields are ignored.
      expect(me.body.data.user.email).toBe(DEMO.accountant.email);
      expect(me.body.data.user.role.slug).toBe('accountant');

      const log = await db.queryOne("SELECT description FROM activity_logs WHERE entity_type = 'user' AND entity_id = ? ORDER BY id DESC LIMIT 1", [before.id]);
      expect(log.description).toBe(`Changed own name from ${before.fullName} to Grace Kimaro`);
    } finally {
      await db.query('UPDATE users SET full_name = ?, phone = ? WHERE id = ?', [before.fullName, before.phone, before.id]);
    }
  });

  test('a name is required', async () => {
    const stylist = await signIn(DEMO.stylist);
    const res = await stylist.patch('/users/me', { fullName: '   ' });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].field).toBe('fullName');
  });
});
