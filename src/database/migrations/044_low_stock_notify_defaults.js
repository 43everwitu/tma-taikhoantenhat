/**
 * Default low-stock Telegram destination: group chat + forum thread.
 * Replaces empty seeds from migration 029 so alerts do not fall back to ADMIN_ID.
 */
function up(db) {
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  upsert.run('low_stock_chat_id', '-1003865156744');
  upsert.run('low_stock_thread_id', '2');
}

module.exports = { up };
