// 025_admin_group_templates.js
// Adds 11 admin/group/bot template rows from seeds/message-templates.json.
// Idempotent: ON CONFLICT(key) DO NOTHING — existing rows are untouched so a
// re-run after an admin edits a body won't clobber their changes.

const fs = require('fs');
const path = require('path');

const KEYS = [
  'admin.backorder_paid',
  'admin.delivered',
  'admin.no_stock',
  'admin.payment_short',
  'admin.low_stock',
  'group.order_card',
  'bot.expiry_reminder',
  'bot.backorder_wait',
  'bot.order_expired_short',
  'bot.order_cancelled_short',
  'bot.stock_replenished',
];

function up(db) {
  const seedPath = path.join(__dirname, '..', 'seeds', 'message-templates.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const insert = db.prepare(`
    INSERT INTO message_templates (key, channel, label, variables, body, default_body)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO NOTHING
  `);
  for (const key of KEYS) {
    const t = seed[key];
    if (!t) throw new Error(`migration 025: missing seed entry for ${key}`);
    insert.run(key, t.channel, t.label, JSON.stringify(t.variables), t.body, t.body);
  }
}

module.exports = { up };
