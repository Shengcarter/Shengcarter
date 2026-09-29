'use strict';

const crypto = require('crypto');
const config = require('../config');

const ENCRYPTION_PREFIX = 'enc:v1:';
const key = crypto.createHash('sha256').update(String(config.encryptionKey)).digest();

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** AES-256-GCM encryption for integration secrets stored in the database. */
function encrypt(plainText) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ENCRYPTION_PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(payload) {
  if (typeof payload !== 'string' || !payload.startsWith(ENCRYPTION_PREFIX)) return null;
  try {
    const raw = Buffer.from(payload.slice(ENCRYPTION_PREFIX.length), 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    // Wrong key (e.g. JWT_SECRET changed) — treat the secret as not set.
    return null;
  }
}

module.exports = { sha256, randomToken, encrypt, decrypt };
