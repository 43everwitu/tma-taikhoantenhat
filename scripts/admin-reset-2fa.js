// scripts/admin-reset-2fa.js
// Bootstrap escape: clear an admin's TOTP state from the DB without an API
// session. Use when the admin (especially super_admin) loses their device.
//
//   node scripts/admin-reset-2fa.js <username>
//
// After this, the next login bypasses 2FA. Set totp_required back on via the
// admin UI once the admin re-enrolls.

const db = require('../src/database');

const username = process.argv[2];
if (!username) {
  console.error('Usage: node scripts/admin-reset-2fa.js <username>');
  process.exit(1);
}

const admin = db.prepare('SELECT id, username, role FROM admins WHERE username = ?').get(username);
if (!admin) {
  console.error(`No admin with username "${username}"`);
  process.exit(1);
}

const result = db.prepare(`
  UPDATE admins
     SET totp_secret = NULL,
         totp_enabled = 0,
         totp_required = 0,
         totp_backup_codes = NULL
   WHERE id = ?
`).run(admin.id);

db.prepare('DELETE FROM admin_2fa_attempts WHERE admin_id = ?').run(admin.id);

console.log(`Cleared 2FA for ${admin.username} (role=${admin.role}, id=${admin.id}, changes=${result.changes})`);
