const crypto = require('node:crypto');

const MAX_AGE_SECONDS = 24 * 3600;

/**
 * Verify a Telegram WebApp initData query string.
 * Returns { ok: true, user, authDate } on success, or { ok: false, reason } on failure.
 *
 * Reasons: 'EMPTY', 'BAD_HASH', 'EXPIRED', 'NO_USER', 'NO_AUTH_DATE'.
 */
function verifyInitData(initData, botToken) {
  if (!initData) return { ok: false, reason: 'EMPTY' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'BAD_HASH' };
  params.delete('hash');

  // Build data-check-string: sort keys, join "key=value" with newlines.
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = sorted.map(([k, v]) => `${k}=${v}`).join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!timingSafeEqualHex(computed, hash)) return { ok: false, reason: 'BAD_HASH' };

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) return { ok: false, reason: 'NO_AUTH_DATE' };
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'NO_AUTH_DATE' };
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > MAX_AGE_SECONDS) return { ok: false, reason: 'EXPIRED' };

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'NO_USER' };
  let user;
  try { user = JSON.parse(userRaw); } catch { return { ok: false, reason: 'NO_USER' }; }
  if (!user || typeof user.id !== 'number') return { ok: false, reason: 'NO_USER' };

  return { ok: true, user, authDate };
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

module.exports = { verifyInitData };
