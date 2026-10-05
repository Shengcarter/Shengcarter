'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
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

describe('sessions', () => {
  const cookieOf = (res) => res.headers['set-cookie'].find((c) => c.startsWith('zola_rt='));
  const bearerGet = async (token, url = '/api/customers') => request(await getApp()).get(url).set('Authorization', `Bearer ${token}`);
  const familyOf = async (token) => jwt.decode(token).sid;

  test('the refresh cookie is HttpOnly and SameSite=Strict, and lasts only for the browser session without "remember me"', async () => {
    const server = await getApp();
    const plain = cookieOf(await request(server).post('/api/auth/login').send(ADMIN));
    expect(plain).toMatch(/HttpOnly/i);
    expect(plain).toMatch(/SameSite=Strict/i);
    expect(plain).not.toMatch(/Expires=/i);
    const remembered = cookieOf(await request(server).post('/api/auth/login').send({ ...ADMIN, remember: true }));
    expect(remembered).toMatch(/Expires=/i);
  });

  test('signing out ends the session at once: the access token stops working too, and history cannot bring it back', async () => {
    const server = await getApp();
    const agent = request.agent(server);
    const login = await agent.post('/api/auth/login').send(ADMIN);
    const token = login.body.data.accessToken;
    expect((await bearerGet(token)).status).toBe(200);

    expect((await agent.post('/api/auth/logout').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    const after = await bearerGet(token);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('SESSION_ENDED');
    expect((await agent.post('/api/auth/refresh')).status).toBe(401);
  });

  test('signing out with only the access token (another tab) also ends the cookie session', async () => {
    const server = await getApp();
    const agent = request.agent(server);
    const token = (await agent.post('/api/auth/login').send(ADMIN)).body.data.accessToken;
    expect((await request(server).post('/api/auth/logout').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    expect((await agent.post('/api/auth/refresh')).status).toBe(401);
    expect((await bearerGet(token)).status).toBe(401);
  });

  test('signing in again starts a new session and ends the one this browser had', async () => {
    const server = await getApp();
    const agent = request.agent(server);
    const first = (await agent.post('/api/auth/login').send(ADMIN)).body.data.accessToken;
    const second = (await agent.post('/api/auth/login').send(ADMIN)).body.data.accessToken;
    expect(await familyOf(first)).not.toBe(await familyOf(second));
    expect((await bearerGet(first)).status).toBe(401);
    expect((await bearerGet(second)).status).toBe(200);
  });

  test('a session ends a fixed time after sign-in, however often it is refreshed', async () => {
    const server = await getApp();
    const agent = request.agent(server);
    const token = (await agent.post('/api/auth/login').send(ADMIN)).body.data.accessToken;
    expect((await agent.post('/api/auth/refresh')).status).toBe(200);
    // Signed in 25 hours ago (normal sessions last at most SESSION_MAX_HOURS = 24).
    await db.query('UPDATE refresh_tokens SET session_started_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 25 HOUR) WHERE family_id = ?', [await familyOf(token)]);
    const expired = await agent.post('/api/auth/refresh');
    expect(expired.status).toBe(401);
    expect(expired.body.code).toBe('SESSION_EXPIRED');
    expect((await bearerGet(token)).status).toBe(401);
  });

  test('an expired or forged access token is refused, and so is one from before sessions were checked', async () => {
    const admin = await signIn();
    const { sub, sid } = jwt.decode(admin.token);
    const expired = jwt.sign({ sub, sid, type: 'access' }, config.auth.jwtSecret, { algorithm: 'HS256', expiresIn: -10 });
    expect((await bearerGet(expired)).body.code).toBe('TOKEN_EXPIRED');
    const forged = jwt.sign({ sub, sid, type: 'access' }, 'not-the-server-secret-but-long-enough-0123456789', { algorithm: 'HS256' });
    expect((await bearerGet(forged)).status).toBe(401);
    const noSession = jwt.sign({ sub, type: 'access' }, config.auth.jwtSecret, { algorithm: 'HS256', expiresIn: '15m' });
    expect((await bearerGet(noSession)).body.code).toBe('SESSION_ENDED');
  });

  test('changing the password keeps this session and ends every other one', async () => {
    const admin = await signIn();
    const role = (await admin.get('/roles')).body.data.find((r) => r.slug === 'receptionist');
    const email = `sessions.${Date.now()}@test.local`;
    await admin.post('/users', { fullName: 'Session Tester', email, roleId: role.id, password: 'Session2026!' });
    await db.query('UPDATE users SET must_change_password = 0 WHERE email = ?', [email]);
    const here = await signIn({ email, password: 'Session2026!' });
    const elsewhere = await signIn({ email, password: 'Session2026!' });
    const changed = await here.post('/auth/change-password', { currentPassword: 'Session2026!', newPassword: 'Session2027!', confirmPassword: 'Session2027!' });
    expect(changed.status).toBe(200);
    expect((await bearerGet(changed.body.data.accessToken, '/api/auth/me')).status).toBe(200);
    expect((await bearerGet(here.token, '/api/auth/me')).status).toBe(200);
    expect((await bearerGet(elsewhere.token, '/api/auth/me')).status).toBe(401);
  });

  test('the cookie endpoints refuse requests started by another site (CSRF)', async () => {
    const server = await getApp();
    const agent = request.agent(server);
    expect((await agent.post('/api/auth/login').set('Origin', 'https://evil.example').send(ADMIN)).status).toBe(403);
    const ok = await agent.post('/api/auth/login').set('Origin', config.corsOrigins[0]).send(ADMIN);
    expect(ok.status).toBe(200);
    const forged = await agent.post('/api/auth/refresh').set('Origin', 'https://evil.example');
    expect(forged.status).toBe(403);
    expect(forged.body.code).toBe('CROSS_SITE_REQUEST');
    expect((await agent.post('/api/auth/logout').set('Referer', 'https://evil.example/page')).status).toBe(403);
    expect((await agent.post('/api/auth/refresh').set('Origin', 'null')).status).toBe(403);
    // The session survived the forged requests.
    expect((await agent.post('/api/auth/refresh').set('Origin', config.corsOrigins[0])).status).toBe(200);
  });

  test('API responses are never stored by the browser', async () => {
    const admin = await signIn();
    const res = await admin.get('/auth/me');
    expect(res.headers['cache-control']).toBe('no-store');
    const denied = await request(await getApp()).get('/api/customers');
    expect(denied.headers['cache-control']).toBe('no-store');
  });

  test('a signed-in user without permission is refused by the server, whatever the screen shows', async () => {
    const stylist = await signIn(DEMO.stylist);
    expect((await stylist.get('/sales')).status).toBe(403);
    expect((await stylist.post('/sales/1/void', { reason: 'Not mine' })).status).toBe(403);
    expect((await stylist.put('/services/1/financial-rule', { rule: { method: 'general' } })).status).toBe(403);
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
