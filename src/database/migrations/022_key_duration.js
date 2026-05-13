function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function up(db) {
  if (!hasColumn(db, 'stock', 'duration_days')) {
    db.exec(`ALTER TABLE stock ADD COLUMN duration_days INTEGER`);
  }
  if (!hasColumn(db, 'stock', 'reminder_sent_at')) {
    db.exec(`ALTER TABLE stock ADD COLUMN reminder_sent_at DATETIME`);
  }
  if (!hasColumn(db, 'product_variants', 'default_duration_days')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN default_duration_days INTEGER`);
  }
}

module.exports = { up };
