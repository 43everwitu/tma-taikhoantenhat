// Removes templates whose owning bot commands were dropped in the thin-bot
// rewrite (sub-project #7). Keeps cmd_myid.
const PURGED_KEYS = [
  'cmd_balance',
  'cmd_account_info',
  'cmd_support',
  'cmd_website',
  'cmd_products_header',
  'cmd_products_empty',
  'cmd_orders_header',
  'cmd_orders_empty',
];

function up(db) {
  const stmt = db.prepare('DELETE FROM message_templates WHERE key = ?');
  for (const key of PURGED_KEYS) {
    stmt.run(key);
  }
}

module.exports = { up };
