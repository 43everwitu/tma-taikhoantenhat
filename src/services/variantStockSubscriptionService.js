const db = require('../database');
const variantService = require('./variantService');

/**
 * "Notify me when back in stock" subscriptions, per variant.
 * A subscription is "waiting" while notified_at IS NULL. Once the restock
 * message went out it is kept with notified_at set (demand history for the
 * admin); the customer cancelling deletes the row.
 */
const variantStockSubscriptionService = {
  /** Returns the subscription's product id, or null when the variant does not exist. */
  subscribe(userId, variantId) {
    const variant = db.prepare('SELECT id, product_id FROM product_variants WHERE id = ?').get(variantId);
    if (!variant) return null;
    // Re-subscribing after a delivered notification makes the row waiting again.
    db.prepare(`
      INSERT INTO variant_stock_subscriptions (user_id, product_id, variant_id)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id, variant_id) DO UPDATE SET notified_at = NULL, created_at = CURRENT_TIMESTAMP
      WHERE notified_at IS NOT NULL
    `).run(userId, variant.product_id, variantId);
    return { productId: variant.product_id, variantId };
  },

  unsubscribe(userId, variantId) {
    db.prepare('DELETE FROM variant_stock_subscriptions WHERE user_id = ? AND variant_id = ?').run(userId, variantId);
  },

  listSubscribedVariantIds(userId, productId) {
    return db.prepare(`
      SELECT variant_id FROM variant_stock_subscriptions
      WHERE user_id = ? AND product_id = ? AND notified_at IS NULL
      ORDER BY variant_id
    `).all(userId, productId).map((row) => row.variant_id);
  },

  /** Waiting subscribers of one variant that can still be reached on Telegram. */
  listSubscriberIds(variantId) {
    return db.prepare(`
      SELECT s.user_id
      FROM variant_stock_subscriptions s
      JOIN users u ON u.telegram_id = s.user_id
      WHERE s.variant_id = ? AND s.notified_at IS NULL AND u.telegram_unreachable_at IS NULL
    `).all(variantId).map((row) => row.user_id);
  },

  /**
   * Users who asked to be told about this product (or one specific variant),
   * regardless of Telegram reachability — they are the only ones who get an
   * in-app notification row for a restock.
   */
  listFollowerIds({ productId, variantId = null }) {
    const rows = variantId == null
      ? db.prepare('SELECT DISTINCT user_id FROM variant_stock_subscriptions WHERE product_id = ? AND notified_at IS NULL').all(productId)
      : db.prepare('SELECT DISTINCT user_id FROM variant_stock_subscriptions WHERE product_id = ? AND variant_id = ? AND notified_at IS NULL').all(productId, variantId);
    return rows.map((row) => row.user_id);
  },

  markNotified(userId, variantId) {
    db.prepare(`
      UPDATE variant_stock_subscriptions SET notified_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND variant_id = ? AND notified_at IS NULL
    `).run(userId, variantId);
  },

  markNotifiedForVariant(variantId) {
    db.prepare(`
      UPDATE variant_stock_subscriptions SET notified_at = CURRENT_TIMESTAMP
      WHERE variant_id = ? AND notified_at IS NULL
    `).run(variantId);
  },

  /**
   * Admin demand view: per product, per variant — how many customers are
   * waiting now and how many were notified in the last `days` days.
   * Sorted by waiting (most wanted first).
   */
  getDemand({ days = 30 } = {}) {
    const rows = db.prepare(`
      SELECT p.id AS product_id, p.name AS product_name, p.slug AS slug,
             v.id AS variant_id, v.name AS variant_name, v.is_backorder AS is_backorder,
             SUM(CASE WHEN s.notified_at IS NULL THEN 1 ELSE 0 END) AS waiting,
             SUM(CASE WHEN s.notified_at IS NOT NULL AND s.notified_at >= datetime('now', ?) THEN 1 ELSE 0 END) AS notified_recent,
             MAX(s.created_at) AS last_subscribed_at
        FROM variant_stock_subscriptions s
        JOIN product_variants v ON v.id = s.variant_id
        JOIN products p ON p.id = v.product_id
       GROUP BY v.id
      HAVING waiting > 0 OR notified_recent > 0
       ORDER BY waiting DESC, notified_recent DESC, last_subscribed_at DESC
    `).all(`-${Math.max(1, Math.floor(Number(days) || 30))} days`);

    const byProduct = new Map();
    for (const row of rows) {
      if (!byProduct.has(row.product_id)) {
        byProduct.set(row.product_id, {
          productId: row.product_id,
          name: row.product_name,
          slug: row.slug,
          waiting: 0,
          notifiedRecent: 0,
          variants: [],
        });
      }
      const product = byProduct.get(row.product_id);
      product.waiting += row.waiting;
      product.notifiedRecent += row.notified_recent;
      product.variants.push({
        variantId: row.variant_id,
        name: row.variant_name,
        isBackorder: !!row.is_backorder,
        waiting: row.waiting,
        notifiedRecent: row.notified_recent,
        stock: variantService.countAvailableStock(db, row.product_id, row.variant_id),
        lastSubscribedAt: row.last_subscribed_at,
      });
    }
    return [...byProduct.values()].sort((a, b) => b.waiting - a.waiting || b.notifiedRecent - a.notifiedRecent || a.name.localeCompare(b.name));
  },
};

module.exports = variantStockSubscriptionService;
