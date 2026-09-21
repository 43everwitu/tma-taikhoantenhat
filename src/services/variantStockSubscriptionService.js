const db = require('../database');

/**
 * "Notify me when back in stock" subscriptions, per variant.
 * One-shot: rows are removed once the restock message was delivered.
 */
const variantStockSubscriptionService = {
  /** Returns the subscription's product id, or null when the variant does not exist. */
  subscribe(userId, variantId) {
    const variant = db.prepare('SELECT id, product_id FROM product_variants WHERE id = ?').get(variantId);
    if (!variant) return null;
    db.prepare(`
      INSERT OR IGNORE INTO variant_stock_subscriptions (user_id, product_id, variant_id)
      VALUES (?, ?, ?)
    `).run(userId, variant.product_id, variantId);
    return { productId: variant.product_id, variantId };
  },

  unsubscribe(userId, variantId) {
    db.prepare('DELETE FROM variant_stock_subscriptions WHERE user_id = ? AND variant_id = ?').run(userId, variantId);
  },

  listSubscribedVariantIds(userId, productId) {
    return db.prepare('SELECT variant_id FROM variant_stock_subscriptions WHERE user_id = ? AND product_id = ? ORDER BY variant_id')
      .all(userId, productId)
      .map((row) => row.variant_id);
  },

  listSubscriberIds(variantId) {
    return db.prepare(`
      SELECT s.user_id
      FROM variant_stock_subscriptions s
      JOIN users u ON u.telegram_id = s.user_id
      WHERE s.variant_id = ? AND u.telegram_unreachable_at IS NULL
    `).all(variantId).map((row) => row.user_id);
  },

  remove(userId, variantId) {
    this.unsubscribe(userId, variantId);
  },

  clearForVariant(variantId) {
    db.prepare('DELETE FROM variant_stock_subscriptions WHERE variant_id = ?').run(variantId);
  },
};

module.exports = variantStockSubscriptionService;
