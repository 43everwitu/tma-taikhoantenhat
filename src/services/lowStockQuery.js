const db = require('../database');

/**
 * Effective low-stock list. Threshold per row =
 *   COALESCE(NULLIF(products.low_stock_threshold, 0), settings.low_stock_alert_threshold, 5).
 *
 * Returns: [{ id, name, emoji, effective_threshold, stock_count, last_low_stock_alert_at }, ...]
 * Filters: is_active=1, stock_count > 0, stock_count <= effective_threshold,
 * last_low_stock_alert_at NULL (cleared on replenish or self-heal).
 */
function effectiveLowStockProducts() {
  const def = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_alert_threshold'").get();
  const defaultThreshold = def && def.value ? parseInt(def.value, 10) : 5;
  // Alert only on transition into low-stock state. The marker stays set until
  // either notifyStockReplenished() clears it (admin uploaded keys) or the
  // self-heal pass in checkLowStock() clears it (stock rose back above
  // threshold via any other path — refund, cancel, manual edit). This makes
  // the alert "once per episode" instead of "once per 24h" — restart-safe
  // because the marker lives in the products table.
  return db.prepare(`
    SELECT * FROM (
      SELECT p.id, p.name, p.emoji,
        COALESCE(NULLIF(p.low_stock_threshold, 0), ?) AS effective_threshold,
        p.last_low_stock_alert_at,
        (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) AS stock_count
      FROM products p
      WHERE p.is_active = 1
    )
    WHERE stock_count > 0
      AND stock_count <= effective_threshold
      AND last_low_stock_alert_at IS NULL
  `).all(defaultThreshold);
}

module.exports = { effectiveLowStockProducts };
