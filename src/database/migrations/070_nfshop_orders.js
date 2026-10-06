function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nfshop_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tma_order_id INTEGER NOT NULL UNIQUE,
      user_id INTEGER NOT NULL,
      variant_id INTEGER,
      nfshop_package_id INTEGER NOT NULL,
      nfshop_order_id INTEGER NOT NULL,
      public_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT 'create',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_nfshop_orders_renewal ON nfshop_orders(user_id, nfshop_package_id, kind, id);
    CREATE TABLE IF NOT EXISTS nfshop_fulfillment_attempts (
      tma_order_id INTEGER PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      gave_up INTEGER NOT NULL DEFAULT 0,
      alerted_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

module.exports = { up };
