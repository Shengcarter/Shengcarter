'use strict';

const jwt = require('jsonwebtoken');
const { authenticator } = require('otplib');

const generate = async ({ secret }) => authenticator.generate(secret);
const config = require('../src/config');
const settings = require('../src/services/settingsService');
const { getApp, signIn, request, db } = require('./helpers');

/**
 * Two-step sign-in: setting it up with an authenticator app, signing in with
 * a code or a recovery code, codes never accepted twice, wrong codes locking
 * the account, the "required for administrators" policy and resets.
 */
describe('two-step sign-in', () => {
  let admin;
  let roleId;
  const PASSWORD = 'TwoStep2026!';

  const post = async (url, body, token) => {
    const req = request(await getApp()).post(`/api${url}`);
    if (token) req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };
  const newUser = async (suffix) => {
    const email = `twostep.${suffix}.${Date.now()}@test.local`;
    const res = await admin.post('/users', { fullName: `Two Step ${suffix}`, email, roleId, password: PASSWORD });
    expect(res.status).toBe(201);
    await db.query('UPDATE users SET must_change_password = 0 WHERE email = ?', [email]);
    return { email, id: res.body.data.id };
  };
  /** Turn it on for a signed-in user; returns the secret and recovery codes. */
  const enable = async (user) => {
    const setup = await user.post('/auth/two-factor/setup', { password: PASSWORD });
    expect(setup.status).toBe(200);
    const confirm = await user.post('/auth/two-factor/confirm', { code: await generate({ secret: setup.body.data.secret }) });
    expect(confirm.status).toBe(200);
    return { secret: setup.body.data.secret, recoveryCodes: confirm.body.data.recoveryCodes };
  };
  /** A later 30-second step has come: the last used step no longer blocks the current code. */
  const nextStep = (userId) => db.query('UPDATE users SET totp_last_step = totp_last_step - 2 WHERE id = ?', [userId]);

  beforeAll(async () => {
    admin = await signIn();
    roleId = (await admin.get('/roles')).body.data.find((r) => r.slug === 'receptionist').id;
  });

  test('setting it up needs the password and a code from the app; the secret is stored encrypted', async () => {
    const { email, id } = await newUser('setup');
    const user = await signIn({ email, password: PASSWORD });
    const other = await signIn({ email, password: PASSWORD }); // another device
    expect((await user.get('/auth/two-factor')).body.data).toMatchObject({ enabled: false, required: false });

    expect((await user.post('/auth/two-factor/setup', { password: 'WrongPass2026!' })).status).toBe(422);
    const setup = await user.post('/auth/two-factor/setup', { password: PASSWORD });
    expect(setup.body.data.uri).toMatch(/^otpauth:\/\/totp\//);
    expect(setup.body.data.qrCode).toMatch(/^data:image\/png;base64,/);

    expect((await user.post('/auth/two-factor/confirm', { code: '000000' })).status).toBe(422);
    const confirm = await user.post('/auth/two-factor/confirm', { code: await generate({ secret: setup.body.data.secret }) });
    expect(confirm.status).toBe(200);
    expect(confirm.body.data.recoveryCodes).toHaveLength(10);
    expect(confirm.body.data.recoveryCodes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(confirm.body.data.session.user.twoFactorEnabled).toBe(true);

    const row = await db.queryOne('SELECT totp_secret, totp_pending_secret FROM users WHERE id = ?', [id]);
    expect(row.totp_secret).toMatch(/^enc:v1:/);
    expect(row.totp_secret).not.toContain(setup.body.data.secret);
    expect(row.totp_pending_secret).toBeNull();
    const codes = await db.query('SELECT code_hash FROM user_recovery_codes WHERE user_id = ?', [id]);
    expect(codes).toHaveLength(10);
    expect(codes.map((c) => c.code_hash)).not.toContain(confirm.body.data.recoveryCodes[0]);

    // This session stays; the other device must sign in again with a code.
    expect((await user.get('/auth/me')).status).toBe(200);
    expect((await other.get('/auth/me')).status).toBe(401);
    const log = await db.queryOne("SELECT new_values FROM activity_logs WHERE action = 'auth.two_factor_enabled' AND entity_id = ?", [id]);
    expect(log.new_values).toEqual({ twoFactor: true });
  });

  test('signing in then needs the code: no session until it is right, and a code works only once', async () => {
    const { email, id } = await newUser('login');
    const { secret } = await enable(await signIn({ email, password: PASSWORD }));

    const first = await post('/auth/login', { email, password: PASSWORD });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ twoFactorRequired: true });
    expect(first.body.data.accessToken).toBeUndefined();
    expect(first.headers['set-cookie']).toBeUndefined();
    const { challenge } = first.body.data;

    // The challenge is not an access token.
    expect((await request(await getApp()).get('/api/auth/me').set('Authorization', `Bearer ${challenge}`)).status).toBe(401);

    const wrong = await post('/auth/login/two-factor', { challenge, code: '123456' });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('INVALID_TWO_FACTOR_CODE');

    await nextStep(id);
    const code = await generate({ secret });
    const ok = await post('/auth/login/two-factor', { challenge, code });
    expect(ok.status).toBe(200);
    expect(ok.body.data.accessToken).toBeTruthy();
    expect(ok.headers['set-cookie'].join(';')).toMatch(/zola_rt=/);
    expect((await db.queryOne('SELECT failed_login_attempts FROM users WHERE id = ?', [id])).failed_login_attempts).toBe(0);

    // Replaying the same code (e.g. seen over a shoulder) is refused.
    const again = await post('/auth/login/two-factor', { challenge, code });
    expect(again.status).toBe(401);
  });

  test('a recovery code signs in once', async () => {
    const { email } = await newUser('recovery');
    const { recoveryCodes } = await enable(await signIn({ email, password: PASSWORD }));
    const { challenge } = (await post('/auth/login', { email, password: PASSWORD })).body.data;
    const used = recoveryCodes[3].toLowerCase().replace('-', ' ');
    expect((await post('/auth/login/two-factor', { challenge, code: used })).status).toBe(200);
    expect((await post('/auth/login/two-factor', { challenge, code: recoveryCodes[3] })).status).toBe(401);
    expect(await db.queryOne("SELECT id FROM activity_logs WHERE action = 'auth.recovery_code_used' ORDER BY id DESC LIMIT 1")).toBeTruthy();
  });

  test('an expired or forged challenge is refused, and wrong codes lock the account', async () => {
    const { email, id } = await newUser('lock');
    await enable(await signIn({ email, password: PASSWORD }));
    const expired = jwt.sign({ sub: id, type: 'two_factor' }, config.auth.jwtSecret, { algorithm: 'HS256', expiresIn: -10 });
    expect((await post('/auth/login/two-factor', { challenge: expired, code: '123456' })).body.code).toBe('CHALLENGE_EXPIRED');
    const forged = jwt.sign({ sub: id, type: 'two_factor' }, 'someone-elses-secret-that-is-long-enough-123', { algorithm: 'HS256' });
    expect((await post('/auth/login/two-factor', { challenge: forged, code: '123456' })).status).toBe(401);
    const access = jwt.sign({ sub: id, type: 'access' }, config.auth.jwtSecret, { algorithm: 'HS256' });
    expect((await post('/auth/login/two-factor', { challenge: access, code: '123456' })).body.code).toBe('CHALLENGE_EXPIRED');

    const { challenge } = (await post('/auth/login', { email, password: PASSWORD })).body.data;
    let last;
    for (let i = 0; i < config.auth.maxLoginAttempts; i += 1) last = await post('/auth/login/two-factor', { challenge, code: '000000' });
    expect(last.status).toBe(423);
    expect((await post('/auth/login', { email, password: PASSWORD })).status).toBe(423);
    await db.query('UPDATE users SET locked_until = NULL, failed_login_attempts = 0 WHERE id = ?', [id]);
  });

  test('turning it off needs the password and a code; new recovery codes replace the old', async () => {
    const { email, id } = await newUser('off');
    const user = await signIn({ email, password: PASSWORD });
    const { secret, recoveryCodes } = await enable(user);
    await nextStep(id);
    const fresh = await user.post('/auth/two-factor/recovery-codes', { password: PASSWORD, code: await generate({ secret }) });
    expect(fresh.status).toBe(200);
    expect(fresh.body.data.recoveryCodes).not.toContain(recoveryCodes[0]);
    expect((await user.post('/auth/two-factor/disable', { password: PASSWORD, code: recoveryCodes[0] })).status).toBe(422);
    expect((await user.post('/auth/two-factor/disable', { password: 'WrongPass2026!', code: fresh.body.data.recoveryCodes[0] })).status).toBe(422);
    const off = await user.post('/auth/two-factor/disable', { password: PASSWORD, code: fresh.body.data.recoveryCodes[0] });
    expect(off.status).toBe(200);
    expect(off.body.data.user.twoFactorEnabled).toBe(false);
    expect((await post('/auth/login', { email, password: PASSWORD })).body.data.accessToken).toBeTruthy();
  });

  test('when required for administrators, an administrator must set it up before doing anything else', async () => {
    const { email } = await newUser('policy');
    const res = await admin.put('/settings/security', { two_factor_required: 'admins' });
    expect(res.status).toBe(200);
    try {
      const blocked = await admin.get('/customers');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('TWO_FACTOR_SETUP_REQUIRED');
      const me = await admin.get('/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.data.user.twoFactorSetupRequired).toBe(true);
      expect((await admin.get('/auth/two-factor')).body.data).toMatchObject({ required: true, enabled: false });
      // Other roles are not affected.
      expect((await (await signIn({ email, password: PASSWORD })).get('/customers')).status).toBe(200);
    } finally {
      await db.query("UPDATE settings SET setting_value = CAST('\"none\"' AS JSON) WHERE setting_key = 'security.two_factor_required'");
      await settings.load();
    }
    expect((await admin.get('/customers')).status).toBe(200);
  });

  test('an administrator can reset it for someone who lost their phone; that signs them out', async () => {
    const { email, id } = await newUser('reset');
    const user = await signIn({ email, password: PASSWORD });
    await enable(user);
    const receptionist = await signIn({ email: 'receptionist.demo@zolastylish.local', password: 'TestDemo2026!' });
    expect((await receptionist.post(`/users/${id}/reset-two-factor`)).status).toBe(403);
    const reset = await admin.post(`/users/${id}/reset-two-factor`);
    expect(reset.status).toBe(200);
    expect(reset.body.data.twoFactorEnabled).toBe(false);
    expect((await user.get('/auth/me')).status).toBe(401);
    expect((await post('/auth/login', { email, password: PASSWORD })).body.data.accessToken).toBeTruthy();
    expect(await db.queryOne("SELECT id FROM activity_logs WHERE action = 'user.two_factor_reset' AND entity_id = ?", [id])).toBeTruthy();
  });

  test('passwords longer than bcrypt can use are refused rather than cut short', async () => {
    const res = await admin.post('/users', { fullName: 'Long Password', email: `long.${Date.now()}@test.local`, roleId, password: `A1${'x'.repeat(75)}` });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].message).toMatch(/72 bytes/);
  });
});
