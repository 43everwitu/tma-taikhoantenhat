const db = require('../database');

/**
 * Effective low-stock list. Threshold per row =
 *   COALESCE(NULLIF(products.low_stock_threshold, 0), settings.low_stock_alert_threshold, 5).
 *
 * Returns: [{ id, name, emoji, effective_threshold, stock_count, last_low_stock_alert_at }, ...]
 * Filters: is_active=1, stock_count > 0, stock_count <= effective_threshold,
 * last_low_stock_alert_at NULL or older than 24h.
 */
function effectiveLowStockProducts() {
  const def = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_alert_threshold'").get();
  const defaultThreshold = def && def.value ? parseInt(def.value, 10) : 5;
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
      AND (last_low_stock_alert_at IS NULL
           OR last_low_stock_alert_at < datetime('now', '-24 hours'))
  `).all(defaultThreshold);
}

module.exports = { effectiveLowStockProducts };
