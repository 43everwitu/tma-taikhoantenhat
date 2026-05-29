// 038_web_notify_templates.js
// Adds the web-channel counterparts for notifications that go to both the bot
// (Telegram chat) and the Mini App (in-app notification). Lets admins word the
// in-app message differently from the bot message.
// Idempotent: ON CONFLICT(key) DO NOTHING.

const fs = require('fs');
const path = require('path');

const KEYS = [
  'web.stock_replenished',
  'web.product_new',
  'web.product_updated',
];

function up(db) {
  const seedPath = path.join(__dirname, '..', 'seeds', 'message-templates.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const insert = db.prepare(`
    INSERT INTO message_templates (key, channel, label, variables, body, default_body, is_enabled)
    VALUES (?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(key) DO NOTHING
  `);
  for (const key of KEYS) {
    const t = seed[key];
    if (!t) throw new Error(`migration 038: missing seed entry for ${key}`);
    insert.run(key, t.channel, t.label, JSON.stringify(t.variables), t.body, t.body);
  }
}

module.exports = { up };
