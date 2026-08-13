const crypto = require('node:crypto');

function signPayload(secret, timestamp, rawBody) {
  const payload = Buffer.concat([
    Buffer.from(`${timestamp}.`),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody),
  ]);
  const digest = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `v1=${digest}`;
}

function verifySignedPayload({ secret, timestamp, signature, rawBody, nowSeconds, maxAgeSeconds }) {
  if (!secret || !/^-?\d+$/.test(String(timestamp))) {
    return false;
  }
  const signedAt = Number(timestamp);
  const now = nowSeconds === undefined ? Math.floor(Date.now() / 1000) : Number(nowSeconds);
  const maxAge = maxAgeSeconds === undefined ? 300 : Number(maxAgeSeconds);
  if (!Number.isSafeInteger(signedAt) || !Number.isInteger(now) || !Number.isInteger(maxAge) || maxAge < 0) {
    return false;
  }
  if (Math.abs(now - signedAt) > maxAge) return false;

  const expected = Buffer.from(signPayload(secret, timestamp, rawBody));
  const received = Buffer.from(String(signature || ''));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

module.exports = { signPayload, verifySignedPayload };
