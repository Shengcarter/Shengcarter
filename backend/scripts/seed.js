'use strict';

/**
 * Seed ZOLA STYLISH MANAGEMENT SYSTEM.
 *
 *   • Reference data (roles, permissions, categories, settings) — always.
 *   • First Super Admin from ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD — only
 *     when no Super Admin exists. No production password is hard-coded; the
 *     administrator must change it at first login.
 *   • Demo data + demo accounts — only when SEED_DEMO_DATA=true.
 *
 * Usage: npm run seed
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { password: passwordRule } = require('../src/validators/common');
const { connect, runSqlFile } = require('./lib/db');

const DEMO_USERS = [
  { role: 'receptionist', name: 'Demo Receptionist', email: 'receptionist.demo@zolastylish.local', employeeCode: 'EMP-0007' },
  { role: 'stylist', name: 'Demo Stylist (Neema)', email: 'stylist.demo@zolastylish.local', employeeCode: 'EMP-0001' },
  { role: 'accountant', name: 'Demo Accountant', email: 'accountant.demo@zolastylish.local', employeeCode: null },
];

function checkPassword(value, variable) {
  const result = passwordRule.safeParse(value || '');
  if (!result.success) {
    throw new Error(`${variable} is not a valid password: ${result.error.issues[0].message}`);
  }
}

async function ensureSuperAdmin(conn) {
  const [existing] = await conn.query(
    "SELECT u.id FROM users u JOIN roles r ON r.id = u.role_id WHERE r.slug = 'super_admin' LIMIT 1",
  );
  if (existing.length) {
    console.log('• Super Admin already exists — skipped.');
    return;
  }

  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const name = (process.env.ADMIN_NAME || 'System Administrator').trim();
  const password = process.env.ADMIN_PASSWORD || '';
  if (!email || !password) {
    throw new Error('No Super Admin exists yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env, then run "npm run seed" again.');
  }
  checkPassword(password, 'ADMIN_PASSWORD');

  const [[role]] = await conn.query("SELECT id FROM roles WHERE slug = 'super_admin'");
  const [[branch]] = await conn.query('SELECT id FROM branches WHERE is_default = 1 ORDER BY id LIMIT 1');
  const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
  await conn.query(
    `INSERT INTO users (role_id, branch_id, full_name, email, password_hash, must_change_password, password_changed_at)
     VALUES (?, ?, ?, ?, ?, 1, UTC_TIMESTAMP())`,
    [role.id, branch?.id || null, name, email, hash],
  );
  console.log(`✔ Super Admin created: ${email} (password change required at first login).`);
}

async function seedDemo(conn) {
  const [[{ total }]] = await conn.query('SELECT COUNT(*) AS total FROM services WHERE is_demo = 1');
  if (Number(total) === 0) {
    console.log('• Loading demo data (database/demo-data.sql)...');
    await runSqlFile(conn, path.join(config.paths.database, 'demo-data.sql'));
  } else {
    console.log('• Demo data already loaded — skipped.');
  }

  const demoPassword = process.env.DEMO_PASSWORD || '';
  checkPassword(demoPassword, 'DEMO_PASSWORD');
  const hash = await bcrypt.hash(demoPassword, config.auth.bcryptRounds);
  const [[branch]] = await conn.query('SELECT id FROM branches WHERE is_default = 1 ORDER BY id LIMIT 1');

  for (const demo of DEMO_USERS) {
    const [[exists]] = await conn.query('SELECT id FROM users WHERE email = ?', [demo.email]);
    if (exists) continue;
    const [[role]] = await conn.query('SELECT id FROM roles WHERE slug = ?', [demo.role]);
    const [result] = await conn.query(
      `INSERT INTO users (role_id, branch_id, full_name, email, password_hash, must_change_password, is_demo, password_changed_at)
       VALUES (?, ?, ?, ?, ?, 0, 1, UTC_TIMESTAMP())`,
      [role.id, branch.id, demo.name, demo.email, hash],
    );
    if (demo.employeeCode) {
      await conn.query('UPDATE employees SET user_id = ? WHERE code = ? AND user_id IS NULL', [result.insertId, demo.employeeCode]);
    }
    console.log(`✔ Demo account: ${demo.email} (${demo.role})`);
  }

  // Historical appointments & sales are generated through the real services
  // so every demo sale has consistent items, payments, stock and loyalty rows.
  const generateActivity = require('./demo/generateActivity');
  await generateActivity();
}

async function seed() {
  const conn = await connect();
  try {
    console.log('• Loading reference data (database/seed.sql)...');
    await runSqlFile(conn, path.join(config.paths.database, 'seed.sql'));
    await ensureSuperAdmin(conn);
    if (process.env.SEED_DEMO_DATA === 'true') await seedDemo(conn);
    console.log('✔ Seed complete.');
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(`✖ Seed failed: ${error.message}`);
      process.exit(1);
    });
}

module.exports = seed;
