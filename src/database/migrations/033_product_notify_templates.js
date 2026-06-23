// 033_product_notify_templates.js
// Adds product_new / product_updated bot templates for broadcast notifications.
// Idempotent: ON CONFLICT(key) DO NOTHING.

const fs = require('fs');
const path = require('path');

const KEYS = [
  'bot.product_new',
  'bot.product_updated',
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
    if (!t) throw new Error(`migration 033: missing seed entry for ${key}`);
    insert.run(key, t.channel, t.label, JSON.stringify(t.variables), t.body, t.body);
  }
}

module.exports = { up };
