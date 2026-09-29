'use strict';

/**
 * First-time .env helper for ZOLA STYLISH MANAGEMENT SYSTEM (used by setup.bat
 * and scripts/linux/setup.sh). Creates .env from .env.example when missing,
 * replaces placeholder secrets with strong random values and points APP_URL at
 * this computer's network address so QR codes work on other salon devices.
 * Existing real values are never overwritten.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..');
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal && /^(10|172\.(1[6-9]|2\d|3[01])|192\.168)\./.test(addr.address)) return addr.address;
    }
  }
  return null;
}

let created = false;
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(examplePath, envPath);
  created = true;
}
let text = fs.readFileSync(envPath, 'utf8');
const get = (key) => (text.match(new RegExp(`^${key}=(.*)$`, 'm')) || [])[1] ?? '';
const set = (key, value) => {
  text = new RegExp(`^${key}=`, 'm').test(text) ? text.replace(new RegExp(`^${key}=.*$`, 'm'), `${key}=${value}`) : `${text.trimEnd()}\n${key}=${value}\n`;
};

const changes = [];
if (!get('JWT_SECRET') || get('JWT_SECRET').startsWith('replace-with')) {
  set('JWT_SECRET', crypto.randomBytes(48).toString('hex'));
  changes.push('generated a new JWT_SECRET');
}
if (get('MYSQL_ROOT_PASSWORD').startsWith('change-this')) {
  set('MYSQL_ROOT_PASSWORD', crypto.randomBytes(18).toString('base64url'));
  changes.push('generated MYSQL_ROOT_PASSWORD (Docker only)');
}
const ip = lanAddress();
if (ip && /localhost|127\.0\.0\.1/.test(get('APP_URL'))) {
  set('APP_URL', `http://${ip}:${get('PORT') || 5000}`);
  changes.push(`APP_URL set to http://${ip}:${get('PORT') || 5000}`);
}
fs.writeFileSync(envPath, text);

console.log(created ? '✔ Created .env from .env.example' : '✔ Checked .env');
for (const c of changes) console.log(`  – ${c}`);
const missing = ['DATABASE_PASSWORD', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'].filter((k) => !get(k) || /change-this|example\.com/.test(get(k)));
if (missing.length) console.log(`  ! Still to fill in: ${missing.join(', ')}`);
process.exitCode = missing.length ? 2 : 0;
