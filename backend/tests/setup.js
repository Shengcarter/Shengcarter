'use strict';

const db = require('../src/config/database');

afterAll(async () => {
  await db.close().catch(() => {});
});
