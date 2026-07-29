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
  const parsedTimestamp = Number(timestamp);
  const now = Number(nowSeconds);
  const maxAge = Number(maxAgeSeconds);
  if (!secret || !Number.isFinite(parsedTimestamp) || !Number.isFinite(now) || !Number.isFinite(maxAge)) {
    return false;
  }
  if (parsedTimestamp > now || now - parsedTimestamp > maxAge) return false;

  const expected = Buffer.from(signPayload(secret, timestamp, rawBody));
  const received = Buffer.from(String(signature || ''));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

module.exports = { signPayload, verifySignedPayload };
