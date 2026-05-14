// 028_admin_2fa.js
// Adds TOTP 2FA columns to admins + lockout-tracking table.
// Idempotent: checks PRAGMA table_info before each ADD COLUMN.

function up(db) {
  const cols = db.prepare("PRAGMA table_info(admins)").all().map(c => c.name);
  if (!cols.includes('totp_secret')) {
    db.exec(`ALTER TABLE admins ADD COLUMN totp_secret TEXT`);
  }
  if (!cols.includes('totp_enabled')) {
    db.exec(`ALTER TABLE admins ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes('totp_required')) {
    db.exec(`ALTER TABLE admins ADD COLUMN totp_required INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.includes('totp_backup_codes')) {
    db.exec(`ALTER TABLE admins ADD COLUMN totp_backup_codes TEXT`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_2fa_attempts (
      admin_id INTEGER PRIMARY KEY,
      attempts INTEGER NOT NULL DEFAULT 0,
      locked_until DATETIME
    )
  `);

  // manager + admin roles get required=1 by default; existing rows left alone
  // so they don't get force-locked on next login (super_admin handles that
  // explicitly via the UI).
}

module.exports = { up };
