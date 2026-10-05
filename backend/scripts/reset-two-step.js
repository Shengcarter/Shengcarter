'use strict';

/**
 * Turn off two-step sign-in for a user from the server's command line — for
 * when the only administrator has lost their phone and their recovery codes.
 *
 * Signs out all of the user's sessions and records the change in the activity
 * log. If the salon requires two-step sign-in for them, they are asked to set
 * it up again right after signing in with their password. Run it on the
 * server itself; it needs the database credentials from .env.
 *
 * Usage:
 *   npm run user:reset-two-step -- admin@example.com
 */
const { connect } = require('./lib/db');

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email || email.startsWith('-')) {
    console.error('Usage: npm run user:reset-two-step -- <email address>');
    process.exit(1);
  }
  const conn = await connect();
  try {
    const [[user]] = await conn.query('SELECT id, full_name, totp_enabled_at, totp_pending_secret FROM users WHERE email = ?', [email]);
    if (!user) throw new Error(`No user with the email address ${email}.`);
    if (!user.totp_enabled_at && !user.totp_pending_secret) {
      console.log(`Two-step sign-in is not on for ${user.full_name}; nothing to do.`);
      return;
    }
    await conn.beginTransaction();
    await conn.query(
      'UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE id = ?',
      [user.id],
    );
    await conn.query('DELETE FROM user_recovery_codes WHERE user_id = ?', [user.id]);
    await conn.query(
      "UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(), revoked_reason = 'two_factor' WHERE user_id = ? AND revoked_at IS NULL",
      [user.id],
    );
    await conn.query(
      `INSERT INTO activity_logs (user_id, action, entity_type, entity_id, description)
       VALUES (NULL, 'user.two_factor_reset', 'user', ?, ?)`,
      [user.id, `Reset two-step sign-in for ${user.full_name} from the server command line`],
    );
    await conn.commit();
    console.log(`✓ Two-step sign-in turned off for ${user.full_name}. All of their sessions were signed out.`);
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
