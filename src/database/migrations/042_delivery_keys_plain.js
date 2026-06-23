// 042_delivery_keys_plain.js
// Plain-text keysBlock (no <code> wrap) + simpler delivery_keys default body.
// Only rewrites body when it still matches a known previous default.

const fs = require('fs');
const path = require('path');

const KEY = 'delivery_keys';

const OLD_VARIANTS = [
  '✅ Đơn <b>#{{orderCode}}</b> — <b>{{productName}}</b> (×<b>{{quantity}}</b>)\n\n🔑 <b>Key:</b>\n{{keysBlock}}{{usageBlock}}\n\nCảm ơn bạn đã mua hàng.',
  '✅ Đơn #{{orderCode}} — {{productName}} (×{{quantity}})\n\n🔑 Key:\n{{keysBlock}}{{usageBlock}}\n\nCảm ơn bạn đã mua hàng!',
  '✅ Đơn #{{orderCode}} — {{productName}} (×{{quantity}})\n\n🔑 Key:\n{{keysBlock}}{{usageBlock}}\n\nCảm ơn bạn đã mua hàng.',
];

function up(db) {
  const seedPath = path.join(__dirname, '..', 'seeds', 'message-templates.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const next = seed[KEY];
  if (!next) throw new Error(`migration 042: missing seed entry for ${KEY}`);

  const row = db.prepare('SELECT body FROM message_templates WHERE key = ?').get(KEY);
  if (row && OLD_VARIANTS.includes(row.body)) {
    db.prepare('UPDATE message_templates SET body = ?, default_body = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?')
      .run(next.body, next.body, KEY);
  } else {
    db.prepare('UPDATE message_templates SET default_body = ? WHERE key = ?').run(next.body, KEY);
  }
}

module.exports = { up };
