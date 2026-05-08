const fs = require('fs');
const path = require('path');

function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_templates (
      key TEXT PRIMARY KEY,
      channel TEXT NOT NULL,
      label TEXT NOT NULL,
      variables TEXT NOT NULL,
      body TEXT NOT NULL,
      default_body TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_message_templates_channel ON message_templates(channel);
  `);

  const seedPath = path.join(__dirname, '..', 'seeds', 'message-templates.json');
  const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  const insert = db.prepare(`
    INSERT INTO message_templates (key, channel, label, variables, body, default_body)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      channel = excluded.channel,
      label = excluded.label,
      variables = excluded.variables,
      default_body = excluded.default_body
  `);
  for (const [key, t] of Object.entries(seed)) {
    insert.run(key, t.channel, t.label, JSON.stringify(t.variables), t.body, t.body);
  }
}

module.exports = { up };
