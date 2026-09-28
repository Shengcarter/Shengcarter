'use strict';

/** Build a fresh test database once per run: schema, reference data, demo records. */
module.exports = async function globalSetup() {
  require('./env');
  const config = require('../src/config');
  if (!/test/i.test(config.db.database)) {
    throw new Error(`Refusing to run tests against "${config.db.database}": the test database name must contain "test".`);
  }
  const { connect } = require('../scripts/lib/db');
  const admin = await connect({ withDatabase: false });
  await admin.query(`DROP DATABASE IF EXISTS \`${config.db.database}\``);
  await admin.end();

  const log = console.log;
  console.log = () => {};
  try {
    await require('../scripts/migrate')({ silent: true });
    await require('../scripts/seed')();
  } finally {
    console.log = log;
  }

  // Tests sign in as the administrator directly; the forced first-login
  // password change is covered by its own test with a new account.
  const conn = await connect();
  await conn.query('UPDATE users SET must_change_password = 0 WHERE email = ?', [process.env.ADMIN_EMAIL]);
  await conn.end();
};
