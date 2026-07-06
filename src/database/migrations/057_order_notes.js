function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      created_by_admin_id INTEGER,
      updated_by_admin_id INTEGER,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (created_by_admin_id) REFERENCES admins(id),
      FOREIGN KEY (updated_by_admin_id) REFERENCES admins(id)
    );

    CREATE INDEX IF NOT EXISTS idx_order_notes_order_created
      ON order_notes (order_id, created_at DESC, id DESC);
  `);
}

module.exports = { up };
