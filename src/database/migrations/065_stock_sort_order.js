function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some((row) => row.name === column);
}

function up(db) {
  if (!hasColumn(db, 'stock', 'sort_order')) {
    db.exec('ALTER TABLE stock ADD COLUMN sort_order REAL NOT NULL DEFAULT 0');
    db.exec('UPDATE stock SET sort_order = id');
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stock_priority
    ON stock(product_id, variant_id, is_sold, sort_order)
  `);
}

module.exports = { up };
