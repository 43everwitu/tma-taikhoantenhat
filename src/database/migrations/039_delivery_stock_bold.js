// 039_delivery_stock_bold.js
// Bold important info in delivery_keys + restyle bot.stock_replenished
// (drop 📦 emoji + "/menu" line, bold name & stock count — the open-shop button
// is now attached as an inline keyboard at send time).
// Only rewrites body when it still matches the previous default, so admin edits
// survive. Always refreshes default_body + label.

const fs = require('fs');
const path = require('path');

const OLD_DEFAULTS = {
  'delivery_keys': '✅ Đơn #{{orderCode}} — {{productName}} (×{{quantity}})\n\n🔑 Key:\n{{keysBlock}}{{usageBlock}}\n\nCảm ơn bạn đã mua hàng.',
  'bot.stock_replenished': '🔔 <b>{{productEmoji}} {{productName}}</b> đã có hàng!\nCòn {{stockCount}} sản phẩm. Mua ngay: /menu',
};

const KEYS = Object.keys(OLD_DEFAULTS);

function up(db) {
  const seedPath = path.join(__dirname, '..', 'seeds', 'message-templates.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));

  const sync = db.prepare(`
    UPDATE message_templates
       SET body = CASE WHEN body = ? THEN ? ELSE body END,
           default_body = ?,
           label = ?,
           updated_at = CURRENT_TIMESTAMP
     WHERE key = ?
  `);

  for (const key of KEYS) {
    const next = seed[key];
    if (!next) throw new Error(`migration 039: missing seed entry for ${key}`);
    sync.run(OLD_DEFAULTS[key], next.body, next.body, next.label, key);
  }
}

module.exports = { up };
