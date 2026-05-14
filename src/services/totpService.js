const crypto = require('node:crypto');
const bcrypt = require('bcrypt');
const qrcode = require('qrcode');
const { encryptString, decryptString } = require('../utils/secrets');

const ISSUER = 'Taikhoantenhat';
const BCRYPT_ROUNDS = 12;
const BACKUP_COUNT = 10;
const STEP_SECONDS = 30;
const DIGITS = 6;
const WINDOW = 1; // accept ±1 step (~30s skew)
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ---------- base32 ----------

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 0x1f];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 0x1f];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

// ---------- TOTP (RFC 6238) ----------

function hotp(keyBuf, counter) {
  const buf = Buffer.alloc(8);
  // counter as big-endian 64-bit; safe in JS for values < 2^53
  buf.writeBigUInt64BE(BigInt(counter), 0);
  const hmac = crypto.createHmac('sha1', keyBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % 10 ** DIGITS).padStart(DIGITS, '0');
}

function totp(secretBase32, when = Date.now()) {
  const key = base32Decode(secretBase32);
  const counter = Math.floor(when / 1000 / STEP_SECONDS);
  return hotp(key, counter);
}

function verifyCode(secretBase32, code) {
  if (!secretBase32 || !code) return false;
  const clean = String(code).replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  let key;
  try { key = base32Decode(secretBase32); }
  catch { return false; }
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS);
  for (let w = -WINDOW; w <= WINDOW; w++) {
    if (hotp(key, counter + w) === clean) return true;
  }
  return false;
}

function generateSecret() {
  // 20 bytes = 160 bits — RFC 4226 minimum recommended.
  return base32Encode(crypto.randomBytes(20));
}

function otpauthUrl(secret, label) {
  const issuer = encodeURIComponent(ISSUER);
  const acct = encodeURIComponent(`${ISSUER}:${label}`);
  return `otpauth://totp/${acct}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

async function makeQrDataUrl(url) {
  return qrcode.toDataURL(url, { margin: 1, width: 240 });
}

function encryptSecret(secret) { return encryptString(secret); }
function decryptSecret(blob) { return decryptString(blob); }

// ---------- backup codes ----------

function formatBackup(rawHex) {
  return rawHex.slice(0, 4).toUpperCase() + '-' + rawHex.slice(4, 8).toUpperCase();
}

async function generateBackupCodes(n = BACKUP_COUNT) {
  const plaintext = [];
  const hashes = [];
  for (let i = 0; i < n; i++) {
    const code = formatBackup(crypto.randomBytes(4).toString('hex'));
    plaintext.push(code);
    hashes.push(await bcrypt.hash(code, BCRYPT_ROUNDS));
  }
  return { plaintext, hashes };
}

async function verifyBackupCode(hashes, code) {
  const normalized = String(code).replace(/\s+/g, '').toUpperCase();
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(normalized, hashes[i])) {
      const remaining = hashes.slice(0, i).concat(hashes.slice(i + 1));
      return { ok: true, remaining };
    }
  }
  return { ok: false, remaining: hashes };
}

module.exports = {
  generateSecret,
  otpauthUrl,
  makeQrDataUrl,
  totp,
  verifyCode,
  encryptSecret,
  decryptSecret,
  generateBackupCodes,
  verifyBackupCode,
  ISSUER,
};
