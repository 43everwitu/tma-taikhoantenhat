/**
 * Migration 006: Track last low-stock alert per product
 * Adds last_low_stock_alert_at to products so the bot can throttle alerts
 * to once per 24h per product instead of spamming every 5 minutes.
 */

function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'products', 'last_low_stock_alert_at')) {
    db.exec(`ALTER TABLE products ADD COLUMN last_low_stock_alert_at DATETIME`);
  }
}

module.exports = { up };
