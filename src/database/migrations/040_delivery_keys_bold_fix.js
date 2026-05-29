// 040_delivery_keys_bold_fix.js
// Follow-up to 039: the live delivery_keys body ended with "!" (an older default
// variant) so 039's OLD_DEFAULT (ending ".") didn't match and the bold rewrite
// was skipped. Rewrite when the body still matches either un-bold variant.

const fs = require('fs');
const path = require('path');

const KEY = 'delivery_keys';

const OLD_VARIANTS = [
  '✅ Đơn #{{orderCode}} — {{productName}} (×{{quantity}})\n\n🔑 Key:\n{{keysBlock}}{{usageBlock}}\n\nCảm ơn bạn đã mua hàng!',
  '✅ Đơn #{{orderCode}} — {{productName}} (×{{quantity}})\n\n🔑 Key:\n{{keysBlock}}{{usageBlock}}\n\nCảm ơn bạn đã mua hàng.',
];

function up(db) {
  const seedPath = path.join(__dirname, '..', 'seeds', 'message-templates.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const next = seed[KEY];
  if (!next) throw new Error(`migration 040: missing seed entry for ${KEY}`);

  const row = db.prepare('SELECT body FROM message_templates WHERE key = ?').get(KEY);
  if (row && OLD_VARIANTS.includes(row.body)) {
    db.prepare('UPDATE message_templates SET body = ?, default_body = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?')
      .run(next.body, next.body, KEY);
  } else {
    // Keep admin edits; only refresh default_body.
    db.prepare('UPDATE message_templates SET default_body = ? WHERE key = ?').run(next.body, KEY);
  }
}

module.exports = { up };
