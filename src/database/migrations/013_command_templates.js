const fs = require('fs');
const path = require('path');

function up(db) {
  const seedPath = path.join(__dirname, '..', 'seeds', 'command-templates.json');
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
