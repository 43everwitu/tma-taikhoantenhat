/**
 * Migration 005: Track QR message id per order
 * Adds qr_chat_id + qr_message_id to orders so the bot can delete the QR
 * caption after auto-delivery, keeping the customer's chat tidy.
 */

function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'orders', 'qr_chat_id')) {
    db.exec(`ALTER TABLE orders ADD COLUMN qr_chat_id INTEGER`);
  }
  if (!hasColumn(db, 'orders', 'qr_message_id')) {
    db.exec(`ALTER TABLE orders ADD COLUMN qr_message_id INTEGER`);
  }
}

module.exports = { up };
