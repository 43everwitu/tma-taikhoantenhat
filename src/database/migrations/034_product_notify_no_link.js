// 034_product_notify_no_link.js
// Remove product URLs from product notification templates, and keep admin-edited
// bodies intact by only rewriting body when it still matches the previous default.

const fs = require('fs');
const path = require('path');

const KEYS = ['bot.product_new', 'bot.product_updated'];

const OLD_DEFAULTS = {
  'bot.product_new': '🆕 <b>{{productEmoji}} {{productName}}</b> vừa lên kệ!\n💰 Giá: <b>{{productPrice}}</b>\n{{productUrl}}',
  'bot.product_updated': '🔄 <b>{{productEmoji}} {{productName}}</b> vừa được cập nhật.\n💰 Giá hiện tại: <b>{{productPrice}}</b>\n{{productUrl}}',
};

function up(db) {
  const seedPath = path.join(__dirname, '..', 'seeds', 'message-templates.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const sync = db.prepare(`
    UPDATE message_templates
       SET body = CASE WHEN body = ? THEN ? ELSE body END,
           default_body = ?,
           variables = ?,
           updated_at = CURRENT_TIMESTAMP
     WHERE key = ?
  `);

  for (const key of KEYS) {
    const next = seed[key];
    if (!next) throw new Error(`migration 034: missing seed entry for ${key}`);
    sync.run(
      OLD_DEFAULTS[key],
      next.body,
      next.body,
      JSON.stringify(next.variables),
      key,
    );
  }
}

module.exports = { up };
