const db = require('../database');

const insertAudit = db.prepare(`
  INSERT INTO audit_log (admin_id, action, entity_type, entity_id, details, ip_address)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const auditService = {
  log(adminId, action, entityType = null, entityId = null, details = null, ipAddress = null) {
    insertAudit.run(
      adminId,
      action,
      entityType,
      entityId,
      details ? JSON.stringify(details) : null,
      ipAddress
    );
  },

  getRecent(limit = 50, offset = 0, filters = {}) {
    let where = '1=1';
    const params = [];

    if (filters.adminId) {
      where += ' AND al.admin_id = ?';
      params.push(filters.adminId);
    }
    if (filters.action) {
      where += ' AND al.action LIKE ?';
      params.push(`%${filters.action}%`);
    }
    if (filters.entityType) {
      where += ' AND al.entity_type = ?';
      params.push(filters.entityType);
    }
    if (filters.from) {
      where += ' AND al.created_at >= ?';
      params.push(filters.from);
    }
    if (filters.to) {
      where += ' AND al.created_at <= ?';
      params.push(filters.to);
    }
    if (filters.q) {
      where += ' AND (al.details LIKE ? OR al.action LIKE ?)';
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }

    const rows = db.prepare(`
      SELECT al.*, a.display_name as admin_name
      FROM audit_log al
      LEFT JOIN admins a ON al.admin_id = a.id
      WHERE ${where}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = db.prepare(`
      SELECT COUNT(*) as c
      FROM audit_log al
      LEFT JOIN admins a ON al.admin_id = a.id
      WHERE ${where}
    `).all(...params)[0].c;

    return { rows, total };
  },

  getEntityTypes() {
    return db.prepare(`
      SELECT DISTINCT entity_type
      FROM audit_log
      WHERE entity_type IS NOT NULL
      ORDER BY entity_type
    `).all().map(r => r.entity_type);
  },
};

module.exports = auditService;
