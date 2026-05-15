// 030_orders_status_expires_index.js
// Composite index for cleanupExpiredOrders + getRecentlyExpired scans —
// both filter by (status, expires_at).

function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_status_expires_at
      ON orders (status, expires_at)
  `);
}

module.exports = { up };
