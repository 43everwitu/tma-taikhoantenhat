/**
 * Migration 010: Customer email + password auth.
 * Adds password_hash to users and a unique-on-email constraint so customers
 * who linked Telegram can also log in with email/password from the web,
 * and reset that password through the bot DM.
 */

function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'users', 'password_hash')) {
    db.exec(`ALTER TABLE users ADD COLUMN password_hash TEXT`);
  }

  // Unique-on-email allows multiple NULL emails (legacy users without email
  // set). Case-insensitive uniqueness via LOWER().
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
      ON users(LOWER(email)) WHERE email IS NOT NULL AND email != '';
  `);
}

module.exports = { up };
