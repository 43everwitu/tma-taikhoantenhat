function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function hasTable(db, name) {
  return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(name);
}

function up(db) {
  if (!hasTable(db, 'product_variants')) {
    db.exec(`
      CREATE TABLE product_variants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        price INTEGER NOT NULL,
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        requires_input INTEGER DEFAULT 0,
        input_label TEXT,
        input_placeholder TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products(id)
      )
    `);
    db.exec(`CREATE INDEX idx_variants_product ON product_variants(product_id, is_active, sort_order)`);
  }

  if (!hasColumn(db, 'stock', 'variant_id')) {
    db.exec(`ALTER TABLE stock ADD COLUMN variant_id INTEGER`);
    db.exec(`CREATE INDEX idx_stock_variant_available ON stock(product_id, variant_id, is_sold)`);
  }

  if (!hasColumn(db, 'orders', 'variant_id')) {
    db.exec(`ALTER TABLE orders ADD COLUMN variant_id INTEGER`);
  }

  if (!hasColumn(db, 'orders', 'input_value')) {
    db.exec(`ALTER TABLE orders ADD COLUMN input_value TEXT`);
  }

  if (!hasColumn(db, 'products', 'is_featured')) {
    db.exec(`ALTER TABLE products ADD COLUMN is_featured INTEGER DEFAULT 0`);
  }
}

module.exports = { up };
