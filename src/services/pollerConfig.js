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

module.exports = { getPollIntervalMs };
