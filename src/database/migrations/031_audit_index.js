// 031_audit_index.js
// Date-range scans on /admin/audit otherwise table-walk audit_log.
// Existing 002_platform.js already indexes (admin_id) and (entity_type,
// entity_id) but nothing on created_at.

function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_created_at
      ON audit_log (created_at DESC)
  `);
}

module.exports = { up };
