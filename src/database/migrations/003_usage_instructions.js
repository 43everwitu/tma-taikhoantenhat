/**
 * Migration 003: Add usage_instructions column + reseed orders AUTOINCREMENT
 * Adds nullable TEXT column usage_instructions to products.
 * Reseeds sqlite_sequence for orders to 99999 so the next insert ID is 100000.
 */

function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'products', 'usage_instructions')) {
    db.exec(`ALTER TABLE products ADD COLUMN usage_instructions TEXT`);
  }

  // Reseed orders id to start from 100000 if currently lower
  const row = db.prepare(`SELECT seq FROM sqlite_sequence WHERE name = 'orders'`).get();
  const current = row ? row.seq : 0;
  if (current < 100000) {
    db.prepare(`INSERT OR REPLACE INTO sqlite_sequence (name, seq) VALUES ('orders', 99999)`).run();
  }
}

module.exports = { up };
