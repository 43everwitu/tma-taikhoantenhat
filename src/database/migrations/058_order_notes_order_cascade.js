function up(db) {
  const table = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'order_notes'
  `).get();
  if (!table) return;

  const orderFk = db.prepare('PRAGMA foreign_key_list(order_notes)').all()
    .find(row => row.table === 'orders' && row.from === 'order_id');

  if (orderFk?.on_delete === 'CASCADE') {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_order_notes_order_updated
        ON order_notes (order_id, updated_at DESC, id DESC);
    `);
    return;
  }

  db.exec(`
    CREATE TABLE order_notes_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      created_by_admin_id INTEGER,
      updated_by_admin_id INTEGER,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by_admin_id) REFERENCES admins(id),
      FOREIGN KEY (updated_by_admin_id) REFERENCES admins(id)
    );

    INSERT INTO order_notes_new (
      id,
      order_id,
      created_by_admin_id,
      updated_by_admin_id,
      content,
      created_at,
      updated_at
    )
    SELECT
      n.id,
      n.order_id,
      n.created_by_admin_id,
      n.updated_by_admin_id,
      n.content,
      n.created_at,
      n.updated_at
    FROM order_notes n
    WHERE EXISTS (SELECT 1 FROM orders o WHERE o.id = n.order_id);

    DROP TABLE order_notes;
    ALTER TABLE order_notes_new RENAME TO order_notes;

    CREATE INDEX IF NOT EXISTS idx_order_notes_order_created
      ON order_notes (order_id, created_at DESC, id DESC);

    CREATE INDEX IF NOT EXISTS idx_order_notes_order_updated
      ON order_notes (order_id, updated_at DESC, id DESC);
  `);
}

module.exports = { up };
