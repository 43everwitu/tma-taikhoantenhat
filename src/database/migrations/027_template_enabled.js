// 027_template_enabled.js
// Adds is_enabled flag (default 1) so admin can disable optional templates.
// Core templates ignore this column at the service layer.

function up(db) {
  const cols = db.prepare("PRAGMA table_info(message_templates)").all();
  if (cols.some((c) => c.name === 'is_enabled')) return;
  db.exec(`ALTER TABLE message_templates ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 1`);
}

module.exports = { up };
