// 026_template_prune_tone.js
// Delete 14 unused message templates. Sync default_body (and body when not
// admin-edited) for templates whose tone was rewritten to a neutral
// professional voice. Idempotent: re-running deletes nothing new and resets
// only rows still matching the previous defaults.

const fs = require('fs');
const path = require('path');

const DEAD_KEYS = [
  'order_created',
  'payment_pending',
  'payment_failed',
  'order_cancelled',
  'low_stock_user',
  'balance_low',
  'refund',
  'bot.order_expired_short',
  'bot.order_cancelled_short',
  'web.new_stock',
  'web.restock_email',
  'web.order_success',
  'web.payment_failed',
  'web.payment_expired',
];

// Keys whose tone or wording changed. For each: update default_body always,
// and update body only when body == old default_body (no admin edit yet).
const REWRITTEN_KEYS = [
  'welcome',
  'payment_short',
  'payment_expired',
  'payment_success',
  'topup_success',
];

function up(db) {
  const delStmt = db.prepare('DELETE FROM message_templates WHERE key = ?');
  for (const key of DEAD_KEYS) delStmt.run(key);

  const seedPath = path.join(__dirname, '..', 'seeds', 'message-templates.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const sync = db.prepare(`
    UPDATE message_templates
       SET body = CASE WHEN body = default_body THEN ? ELSE body END,
           default_body = ?,
           updated_at = CURRENT_TIMESTAMP
     WHERE key = ?
  `);
  for (const key of REWRITTEN_KEYS) {
    const t = seed[key];
    if (!t) throw new Error(`migration 026: missing seed entry for ${key}`);
    sync.run(t.body, t.body, key);
  }
}

module.exports = { up };
