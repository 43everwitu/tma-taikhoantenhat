const crypto = require('node:crypto');
const config = require('../config');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;

function getKey() {
  const hex = config.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function encryptString(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]).toString('base64');
}

function decryptString(packed) {
  if (packed == null || packed === '') return null;
  const buf = Buffer.from(packed, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + 16);
  const ct = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encryptString, decryptString };
