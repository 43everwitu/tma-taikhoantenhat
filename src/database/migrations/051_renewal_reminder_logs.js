function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS renewal_reminder_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stock_id INTEGER,
      order_id INTEGER,
      user_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      expiry_date TEXT,
      days_before_expiry INTEGER,
      telegram_sent INTEGER DEFAULT 0,
      web_notification_id INTEGER,
      status TEXT NOT NULL,
      error_message TEXT,
      message_body TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (stock_id) REFERENCES stock(id),
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (user_id) REFERENCES users(telegram_id),
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (web_notification_id) REFERENCES notifications(id)
    );
    CREATE INDEX IF NOT EXISTS idx_renewal_reminder_logs_created
      ON renewal_reminder_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_renewal_reminder_logs_status
      ON renewal_reminder_logs(status);
    CREATE INDEX IF NOT EXISTS idx_renewal_reminder_logs_user
      ON renewal_reminder_logs(user_id);
  `);
}

module.exports = { up };
