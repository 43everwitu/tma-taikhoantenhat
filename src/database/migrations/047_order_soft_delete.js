function hasColumn(db, table, column) {
  const cols = db.pragma(`table_info(${table})`);
  return cols.some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'orders', 'deleted_at')) {
    db.exec(`ALTER TABLE orders ADD COLUMN deleted_at DATETIME`);
  }
  if (!hasColumn(db, 'orders', 'deleted_by')) {
    db.exec(`ALTER TABLE orders ADD COLUMN deleted_by INTEGER`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_orders_deleted_at
      ON orders(deleted_at);

    CREATE INDEX IF NOT EXISTS idx_orders_visible_status_created
      ON orders(deleted_at, status, created_at);
  `);
}

module.exports = { up };
