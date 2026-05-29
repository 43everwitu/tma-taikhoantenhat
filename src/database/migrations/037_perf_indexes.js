function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_featured
      ON products (is_active, is_featured, sort_order);

    CREATE INDEX IF NOT EXISTS idx_products_active_created
      ON products (is_active, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_orders_user_discount
      ON orders (user_id, discount_code_id, status);
  `);
}

module.exports = { up };
