function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function up(db) {
  if (!hasColumn(db, 'discount_codes', 'notify_title')) {
    db.exec(`ALTER TABLE discount_codes ADD COLUMN notify_title TEXT`);
  }
}

module.exports = { up };
