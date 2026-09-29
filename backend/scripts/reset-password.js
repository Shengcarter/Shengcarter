'use strict';

/**
 * Reset a user's password from the server's command line — for when the only
 * administrator has forgotten theirs and email is not configured.
 *
 * Sets a temporary password (the user must choose a new one at next sign-in),
 * unlocks the account, signs out all of its sessions and records the change
 * in the activity log. Run it on the server itself; it needs the database
 * credentials from .env, so it cannot be used from another computer.
 *
 * Usage:
 *   npm run user:reset-password -- admin@example.com
 *   (asks for the new password; or set NEW_PASSWORD for unattended use)
 */
const readline = require('readline');
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const { password: passwordRule } = require('../src/validators/common');
const { connect } = require('./lib/db');

function ask(question, { hidden = false } = {}) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    // Echo "*" instead of the typed characters.
    rl._writeToOutput = (text) => {
      rl.output.write(text.startsWith(question) ? question + '*'.repeat(rl.line.length) : '*');
    };
  }
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function readNewPassword() {
  if (process.env.NEW_PASSWORD) return process.env.NEW_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('Set NEW_PASSWORD when running without a terminal.');
  const first = await ask('New temporary password: ', { hidden: true });
  const second = await ask('Repeat the password:    ', { hidden: true });
  if (first !== second) throw new Error('The passwords do not match.');
  return first;
}

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email || email.startsWith('-')) {
    console.error('Usage: npm run user:reset-password -- <email address>');
    process.exit(1);
  }

  const conn = await connect();
  try {
    const [[user]] = await conn.query(
      `SELECT u.id, u.full_name, u.is_active, r.name AS role_name
         FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?`,
      [email],
    );
    if (!user) throw new Error(`No user with the email address ${email}.`);

    const password = await readNewPassword();
    const check = passwordRule.safeParse(password);
    if (!check.success) throw new Error(check.error.issues[0].message);

    const hash = await bcrypt.hash(password, config.auth.bcryptRounds);
    await conn.beginTransaction();
    await conn.query(
      `UPDATE users SET password_hash = ?, must_change_password = 1, password_changed_at = UTC_TIMESTAMP(),
              failed_login_attempts = 0, locked_until = NULL
        WHERE id = ?`,
      [hash, user.id],
    );
    await conn.query(
      "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(), revoked_reason = 'admin' WHERE user_id = ? AND revoked_at IS NULL",
      [user.id],
    );
    await conn.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, description)
       VALUES (NULL, 'user.password_reset', 'user', ?, ?)`,
      [user.id, `Reset password for ${user.full_name} from the server command line`],
    );
    await conn.commit();

    console.log(`✓ Password reset for ${user.full_name} (${user.role_name}).`);
    if (!user.is_active) {
      console.log('  Note: this account is deactivated — another administrator must reactivate it in Settings → Users.');
    }
    console.log('  Sign in with the temporary password; you will be asked to choose a new one.');
  } catch (error) {
    await conn.rollback().catch(() => {});
    throw error;
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
