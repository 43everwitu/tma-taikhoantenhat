function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function up(db) {
  if (!hasColumn(db, 'discount_codes', 'is_global')) {
    db.exec(`ALTER TABLE discount_codes ADD COLUMN is_global INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, 'discount_codes', 'app_message')) {
    db.exec(`ALTER TABLE discount_codes ADD COLUMN app_message TEXT`);
  }
  if (!hasColumn(db, 'discount_codes', 'bot_message')) {
    db.exec(`ALTER TABLE discount_codes ADD COLUMN bot_message TEXT`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_discount_codes_global
    ON discount_codes(is_global, is_active);
  `);
}

module.exports = { up };
