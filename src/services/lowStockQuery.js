const db = require('../database');

/**
 * Danh sách bucket tồn kho thấp. Ngưỡng mỗi dòng =
 *   COALESCE(products.low_stock_threshold, settings.low_stock_alert_threshold, 5).
 *
 * Product không có biến thể active non-backorder -> bucket product.
 * Product có biến thể active non-backorder -> bucket từng biến thể.
 */
function getDefaultLowStockThreshold() {
  const def = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_alert_threshold'").get();
  const value = def && def.value ? parseInt(def.value, 10) : 5;
  return Number.isFinite(value) && value >= 0 ? value : 5;
}

function effectiveLowStockProducts() {
  const defaultThreshold = getDefaultLowStockThreshold();
  return db.prepare(`
    SELECT * FROM (
      SELECT
        'product' AS target_type,
        'p:' || p.id AS target_key,
        p.id,
        p.name,
        p.emoji,
        NULL AS variant_id,
        NULL AS variant_name,
        COALESCE(p.low_stock_threshold, ?) AS effective_threshold,
        COALESCE(st.last_alert_at, p.last_low_stock_alert_at) AS last_low_stock_alert_at,
        COALESCE(st.snoozed_until, p.low_stock_snoozed_until) AS low_stock_snoozed_until,
        (
          SELECT COUNT(*) FROM stock s
          WHERE s.product_id = p.id
            AND s.variant_id IS NULL
            AND s.is_sold = 0
            AND s.reserved_for_order_id IS NULL
        ) AS stock_count
      FROM products p
      LEFT JOIN low_stock_alert_states st ON st.target_key = 'p:' || p.id
      WHERE p.is_active = 1
        AND NOT EXISTS (
          SELECT 1 FROM product_variants v
          WHERE v.product_id = p.id
            AND v.is_active = 1
            AND COALESCE(v.is_backorder, 0) = 0
        )

      UNION ALL

      SELECT
        'variant' AS target_type,
        'v:' || v.id AS target_key,
        p.id,
        p.name,
        p.emoji,
        v.id AS variant_id,
        v.name AS variant_name,
        COALESCE(p.low_stock_threshold, ?) AS effective_threshold,
        st.last_alert_at AS last_low_stock_alert_at,
        st.snoozed_until AS low_stock_snoozed_until,
        (
          SELECT COUNT(*) FROM stock s
          WHERE s.product_id = p.id
            AND s.variant_id = v.id
            AND s.is_sold = 0
            AND s.reserved_for_order_id IS NULL
        ) AS stock_count
      FROM products p
      JOIN product_variants v ON v.product_id = p.id
      LEFT JOIN low_stock_alert_states st ON st.target_key = 'v:' || v.id
      WHERE p.is_active = 1
        AND v.is_active = 1
        AND COALESCE(v.is_backorder, 0) = 0
    )
    WHERE stock_count > 0
      AND effective_threshold > 0
      AND stock_count <= effective_threshold
      AND last_low_stock_alert_at IS NULL
      AND (low_stock_snoozed_until IS NULL OR low_stock_snoozed_until <= CURRENT_TIMESTAMP)
  `).all(defaultThreshold, defaultThreshold);
}

function effectiveOutOfStockProducts() {
  const defaultThreshold = getDefaultLowStockThreshold();
  return db.prepare(`
    SELECT * FROM (
      SELECT
        'product' AS target_type,
        'p:' || p.id AS target_key,
        p.id,
        p.name,
        p.emoji,
        NULL AS variant_id,
        NULL AS variant_name,
        COALESCE(p.low_stock_threshold, ?) AS effective_threshold,
        st.last_alert_at AS last_low_stock_alert_at,
        st.snoozed_until AS low_stock_snoozed_until,
        st.out_of_stock_alert_at,
        (
          SELECT COUNT(*) FROM stock s
          WHERE s.product_id = p.id
            AND s.variant_id IS NULL
            AND s.is_sold = 0
            AND s.reserved_for_order_id IS NULL
        ) AS stock_count
      FROM products p
      JOIN low_stock_alert_states st ON st.target_key = 'p:' || p.id
      WHERE p.is_active = 1
        AND NOT EXISTS (
          SELECT 1 FROM product_variants v
          WHERE v.product_id = p.id
            AND v.is_active = 1
        )

      UNION ALL

      SELECT
        'variant' AS target_type,
        'v:' || v.id AS target_key,
        p.id,
        p.name,
        p.emoji,
        v.id AS variant_id,
        v.name AS variant_name,
        COALESCE(p.low_stock_threshold, ?) AS effective_threshold,
        st.last_alert_at AS last_low_stock_alert_at,
        st.snoozed_until AS low_stock_snoozed_until,
        st.out_of_stock_alert_at,
        (
          SELECT COUNT(*) FROM stock s
          WHERE s.product_id = p.id
            AND s.variant_id = v.id
            AND s.is_sold = 0
            AND s.reserved_for_order_id IS NULL
        ) AS stock_count
      FROM products p
      JOIN product_variants v ON v.product_id = p.id
      JOIN low_stock_alert_states st ON st.target_key = 'v:' || v.id
      WHERE p.is_active = 1
        AND v.is_active = 1
        AND COALESCE(v.is_backorder, 0) = 0
    )
    WHERE stock_count = 0
      AND last_low_stock_alert_at IS NOT NULL
      AND out_of_stock_alert_at IS NULL
  `).all(defaultThreshold, defaultThreshold);
}

function clearRecoveredLowStockStates() {
  const defaultThreshold = getDefaultLowStockThreshold();
  db.prepare(`
    UPDATE low_stock_alert_states
    SET out_of_stock_alert_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE out_of_stock_alert_at IS NOT NULL
      AND (
        (
          target_type = 'variant'
          AND (
            SELECT COUNT(*) FROM stock s
            WHERE s.variant_id = low_stock_alert_states.variant_id
              AND s.is_sold = 0
              AND s.reserved_for_order_id IS NULL
          ) > 0
        )
        OR (
          target_type = 'product'
          AND (
            SELECT COUNT(*) FROM stock s
            WHERE s.product_id = low_stock_alert_states.product_id
              AND s.variant_id IS NULL
              AND s.is_sold = 0
              AND s.reserved_for_order_id IS NULL
          ) > 0
        )
      )
  `).run();

  db.prepare(`
    UPDATE low_stock_alert_states
    SET last_alert_at = NULL,
        snoozed_until = NULL,
        out_of_stock_alert_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE (
      target_type = 'variant'
      AND (
        SELECT COUNT(*) FROM stock s
        WHERE s.variant_id = low_stock_alert_states.variant_id
          AND s.is_sold = 0
          AND s.reserved_for_order_id IS NULL
      ) > (
        SELECT COALESCE(p.low_stock_threshold, ?)
        FROM products p
        WHERE p.id = low_stock_alert_states.product_id
      )
    ) OR (
      target_type = 'product'
      AND (
        SELECT COUNT(*) FROM stock s
        WHERE s.product_id = low_stock_alert_states.product_id
          AND s.variant_id IS NULL
          AND s.is_sold = 0
          AND s.reserved_for_order_id IS NULL
      ) > (
        SELECT COALESCE(p.low_stock_threshold, ?)
        FROM products p
        WHERE p.id = low_stock_alert_states.product_id
      )
    )
  `).run(defaultThreshold, defaultThreshold);
}

function countEffectiveLowStockBuckets() {
  return effectiveLowStockProducts().length;
}

module.exports = {
  effectiveLowStockProducts,
  effectiveOutOfStockProducts,
  getDefaultLowStockThreshold,
  clearRecoveredLowStockStates,
  countEffectiveLowStockBuckets,
};
