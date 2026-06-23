// 043_order_channel_message.js
// Persist Telegram order-channel card message id so backorder cards can be
// edited in-place when the order is fulfilled instead of posting a duplicate.

function up(db) {
  db.exec(`
    ALTER TABLE orders ADD COLUMN order_channel_chat_id TEXT;
    ALTER TABLE orders ADD COLUMN order_channel_message_id INTEGER;
  `);
}

module.exports = { up };
