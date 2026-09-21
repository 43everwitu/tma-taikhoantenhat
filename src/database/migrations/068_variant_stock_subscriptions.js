function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS variant_stock_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, variant_id)
    );
    CREATE INDEX IF NOT EXISTS idx_variant_stock_subs_variant ON variant_stock_subscriptions(variant_id);
    CREATE INDEX IF NOT EXISTS idx_variant_stock_subs_product ON variant_stock_subscriptions(user_id, product_id);
  `);
}

module.exports = { up };
