const db = require('../database');

const TTL_MS = 30_000;
let cache = null;
let cacheAt = 0;

function isGlobalForceOn() {
  if (cache !== null && Date.now() - cacheAt < TTL_MS) return cache;
  const row = db.prepare("SELECT value FROM settings WHERE key = 'require_2fa_all'").get();
  cache = row?.value === 'true' || row?.value === '1';
  cacheAt = Date.now();
  return cache;
}

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

/**
 * Whether an admin must enroll TOTP before being granted a normal session.
 *   - super_admin always required
 *   - per-row totp_required flag
 *   - global settings.require_2fa_all
 * Already-enrolled (totp_enabled=1) admins are never asked to re-enroll.
 */
function isEnrollmentRequired(admin) {
  if (admin.totp_enabled) return false;
  if (admin.role === 'super_admin') return true;
  if (admin.totp_required) return true;
  return isGlobalForceOn();
}

/**
 * Display flag used by /admin/me and the disable-2fa guard. True when admin is
 * required to keep 2FA on (regardless of current enrolled state). Used to
 * forbid voluntary disable when global force or per-row required is set.
 */
function isRequired(admin) {
  if (admin.role === 'super_admin') return true;
  if (admin.totp_required) return true;
  return isGlobalForceOn();
}

module.exports = { isEnrollmentRequired, isRequired, invalidateCache, isGlobalForceOn };
