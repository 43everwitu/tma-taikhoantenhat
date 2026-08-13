function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS twofa_order_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      binding_id TEXT NOT NULL UNIQUE,
      shop_order_id INTEGER NOT NULL,
      telegram_user_id INTEGER NOT NULL,
      uurl TEXT NOT NULL,
      order_host TEXT NOT NULL,
      order_url TEXT NOT NULL,
      recipient_label TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      last_error TEXT,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      synced_at DATETIME,
      FOREIGN KEY (shop_order_id) REFERENCES orders(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_twofa_binding_order_uurl
    ON twofa_order_bindings(shop_order_id, uurl);

    CREATE INDEX IF NOT EXISTS idx_twofa_binding_uurl_status
    ON twofa_order_bindings(uurl, status);

    CREATE TABLE IF NOT EXISTS twofa_notification_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT NOT NULL UNIQUE,
      binding_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'processing',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sent_at DATETIME,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

module.exports = { up };
