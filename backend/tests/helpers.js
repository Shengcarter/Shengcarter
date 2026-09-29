'use strict';

const request = require('supertest');
const { DateTime } = require('luxon');
const createApp = require('../src/app');
const db = require('../src/config/database');
const settings = require('../src/services/settingsService');

let app;

async function getApp() {
  if (!app) {
    await settings.load();
    app = createApp();
  }
  return app;
}

const ADMIN = { email: 'admin@test.local', password: 'TestAdmin2026!' };
const DEMO = {
  receptionist: { email: 'receptionist.demo@zolastylish.local', password: 'TestDemo2026!' },
  stylist: { email: 'stylist.demo@zolastylish.local', password: 'TestDemo2026!' },
  accountant: { email: 'accountant.demo@zolastylish.local', password: 'TestDemo2026!' },
};

/** Sign in and return a small client that sends the bearer token. */
async function signIn({ email, password } = ADMIN) {
  const server = await getApp();
  const res = await request(server).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  return client(res.body.data.accessToken, res);
}

function client(token, loginResponse = null) {
  const call = (method) => async (url, body) => {
    const server = await getApp();
    const req = request(server)[method](`/api${url}`).set('Authorization', `Bearer ${token}`);
    return body === undefined ? req : req.send(body);
  };
  // Binary downloads (Excel, backups): buffer the raw bytes.
  const download = async (url) => {
    const server = await getApp();
    return request(server)
      .get(`/api${url}`)
      .set('Authorization', `Bearer ${token}`)
      .buffer(true)
      .parse((res, done) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });
  };
  return { token, loginResponse, download, get: call('get'), post: call('post'), put: call('put'), patch: call('patch'), delete: call('delete') };
}

const crypto = require('crypto');
/** A random, valid Tanzanian mobile number for test customers. */
function uniquePhone() {
  return `+2557${crypto.randomInt(10_000_000, 99_999_999)}`;
}

/** Next date (business time zone) at least `minDaysAhead` away on which the employee works. */
async function nextWorkingDay(employeeId, minDaysAhead = 2) {
  const zone = settings.get('system.timezone') || 'Africa/Dar_es_Salaam';
  const rows = await db.query('SELECT day_of_week, start_time, end_time FROM employee_schedules WHERE employee_id = ? AND is_working = 1', [employeeId]);
  for (let i = minDaysAhead; i < minDaysAhead + 14; i += 1) {
    const day = DateTime.now().setZone(zone).plus({ days: i });
    const schedule = rows.find((r) => r.day_of_week === day.weekday % 7);
    const onLeave = await db.queryOne("SELECT id FROM leave_records WHERE employee_id = ? AND status = 'approved' AND ? BETWEEN start_date AND end_date", [employeeId, day.toISODate()]);
    if (schedule && !onLeave) return { date: day.toISODate(), start: schedule.start_time.slice(0, 5), end: schedule.end_time.slice(0, 5) };
  }
  throw new Error('No working day found for employee');
}

module.exports = { getApp, signIn, client, ADMIN, DEMO, uniquePhone, nextWorkingDay, db, request };
