/**
 * Tách cấu hình channel đơn hàng khỏi low_stock_chat_id.
 * low_stock_* chỉ dành cho cảnh báo tồn kho; order_channel_* dành cho card đơn hàng.
 */
function up(db) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  upsert.run('order_channel_chat_id', '-1003865156744');
  upsert.run('order_channel_thread_id', '2');
}

module.exports = { up };
