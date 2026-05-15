// 029_settings_2fa_lowstock.js
// Adds 3 settings rows for the v0.33 mini-fixes:
//   require_2fa_all    — bool, super_admin global force.
//   low_stock_chat_id  — chat id for low-stock alerts (defaults to ADMIN_ID at read).
//   low_stock_thread_id — optional message_thread_id for forum topics.
function up(db) {
  const ins = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`
  );
  ins.run('require_2fa_all', 'false');
  ins.run('low_stock_chat_id', '');
  ins.run('low_stock_thread_id', '');
}
module.exports = { up };
