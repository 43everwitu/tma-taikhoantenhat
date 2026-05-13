function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function up(db) {
  if (!hasColumn(db, 'product_variants', 'is_backorder')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN is_backorder INTEGER DEFAULT 0`);
  }
}

module.exports = { up };
