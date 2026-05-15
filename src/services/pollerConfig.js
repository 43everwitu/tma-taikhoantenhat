const db = require('../database');

/**
 * Resolve poll interval from settings.payment_poll_interval_seconds.
 * Clamps to [5, 120] seconds. Returns milliseconds. Falls back to 30000ms
 * if the setting is missing, zero, non-numeric, or below the minimum.
 */
function getPollIntervalMs() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'payment_poll_interval_seconds'").get();
  const seconds = row && row.value ? parseInt(row.value, 10) : 0;
  if (!Number.isFinite(seconds) || seconds < 5) return 30_000;
  return Math.min(seconds, 120) * 1000;
}

/**
 * Whether auto-matching of bank transactions is enabled. Combines the DB
 * setting `auto_payment_enabled` (truthy → on) with the env-time
 * PAYMENT_POLL_ENABLED. The setting wins when present so admins can toggle
 * matching from the UI without a restart. Returns true if BOTH the gate
 * is on AND MBBANK_API_TOKEN is configured (caller still checks the token).
 */
function isAutoPaymentEnabled(envFallback) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'auto_payment_enabled'").get();
  if (!row) return !!envFallback;
  const v = row.value;
  return v === 'true' || v === '1';
}

module.exports = { getPollIntervalMs, isAutoPaymentEnabled };
