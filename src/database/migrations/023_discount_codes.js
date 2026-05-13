function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discount_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL CHECK(type IN ('percent','fixed')),
      amount INTEGER NOT NULL,
      max_discount INTEGER,
      min_order INTEGER DEFAULT 0,
      usage_limit INTEGER,
      used_count INTEGER NOT NULL DEFAULT 0,
      per_user_limit INTEGER,
      starts_at DATETIME,
      ends_at DATETIME,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_discount_codes_code ON discount_codes(code);
    CREATE INDEX IF NOT EXISTS idx_discount_codes_active ON discount_codes(is_active);
  `);
  if (!hasColumn(db, 'orders', 'discount_code_id')) {
    db.exec(`ALTER TABLE orders ADD COLUMN discount_code_id INTEGER REFERENCES discount_codes(id)`);
  }
  if (!hasColumn(db, 'orders', 'discount_amount')) {
    db.exec(`ALTER TABLE orders ADD COLUMN discount_amount INTEGER DEFAULT 0`);
  }
}

module.exports = { up };
