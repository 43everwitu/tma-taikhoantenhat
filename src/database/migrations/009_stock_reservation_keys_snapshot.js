/**
 * Migration 009: Stock reservation + delivered keys snapshot.
 * - stock.reserved_for_order_id, reserved_at — let orderService.create
 *   atomically claim N stock rows so two pending orders cannot fight over
 *   the same inventory.
 * - orders.delivered_keys_json — snapshot of delivered keys so admin can
 *   resend if the user blocked the bot or the original message was lost.
 */

function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function addCol(db, table, col, def) {
  if (!hasColumn(db, table, col)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
}

function up(db) {
  addCol(db, 'stock', 'reserved_for_order_id', 'INTEGER');
  addCol(db, 'stock', 'reserved_at', 'DATETIME');
  addCol(db, 'orders', 'delivered_keys_json', 'TEXT');
  addCol(db, 'orders', 'delivered_keys_resent_at', 'DATETIME');
  // 'bank' (default — VietQR transfer), 'wallet' (paid from user balance)
  addCol(db, 'orders', 'payment_method', "TEXT DEFAULT 'bank'");

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_stock_reservation
      ON stock(reserved_for_order_id) WHERE reserved_for_order_id IS NOT NULL;
  `);
}

module.exports = { up };
