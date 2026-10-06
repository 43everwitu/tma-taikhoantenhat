const db = require('../database');

// Fan-out notification kinds: one row per recipient, never read in practice
// (is_read stayed 0 on ~588k rows), so keep a short window only. Personal
// kinds (order_update, renewal_reminder) are kept.
const BULK_TYPES = ['stock_alert', 'announcement', 'product_new', 'product_updated'];
const RETENTION_DAYS = 30;
const BATCH_SIZE = 5000;
const INTERVAL_MS = 24 * 60 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 2 * 60 * 1000;

/**
 * Delete bulk notifications older than `days`, in batches so the write lock is
 * released between statements. Returns the number of rows removed.
 */
function purgeOld(database = db, { days = RETENTION_DAYS, batchSize = BATCH_SIZE, types = BULK_TYPES } = {}) {
  const marks = types.map(() => '?').join(',');
  const stmt = database.prepare(`
    DELETE FROM notifications WHERE id IN (
      SELECT id FROM notifications
      WHERE type IN (${marks}) AND created_at < datetime('now', ?)
      LIMIT ?
    )
  `);
  let total = 0;
  let changed;
  do {
    changed = stmt.run(...types, `-${days} days`, batchSize).changes;
    total += changed;
  } while (changed === batchSize);
  return total;
}

function start({ intervalMs = INTERVAL_MS, firstRunDelayMs = FIRST_RUN_DELAY_MS } = {}) {
  const run = () => {
    try {
      const removed = purgeOld();
      if (removed > 0) console.log(`🧹 Purged ${removed} bulk notifications older than ${RETENTION_DAYS} days`);
    } catch (err) {
      console.error('notification retention failed:', err.message);
    }
  };
  const first = setTimeout(run, firstRunDelayMs);
  first.unref();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return function stop() {
    clearTimeout(first);
    clearInterval(timer);
  };
}

module.exports = { purgeOld, start, BULK_TYPES, RETENTION_DAYS };
