/**
 * Migration 008: Admin notification preference toggles.
 * Default: only delivered + low_stock fire to ADMIN_ID. Other events go silent
 * unless BOT_NOISE_CHAT_ID env var is set (forwarded there for audit).
 */

function up(db) {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  insertSetting.run('notify_admin_new_order', 'false');
  insertSetting.run('notify_admin_payment_short', 'false');
  insertSetting.run('notify_admin_no_stock', 'false');
  insertSetting.run('notify_admin_delivered', 'true');
  insertSetting.run('notify_admin_low_stock', 'true');
}

module.exports = { up };
