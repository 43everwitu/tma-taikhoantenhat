function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function up(db) {
  if (!hasColumn(db, 'discount_codes', 'app_meta_mode')) {
    db.exec(`ALTER TABLE discount_codes ADD COLUMN app_meta_mode TEXT NOT NULL DEFAULT 'auto'`);
  }
  if (!hasColumn(db, 'discount_codes', 'app_meta_text')) {
    db.exec(`ALTER TABLE discount_codes ADD COLUMN app_meta_text TEXT`);
  }
}

module.exports = { up };
