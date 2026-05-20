const db = require('../database');

const insertAudit = db.prepare(`
  INSERT INTO audit_log (admin_id, action, entity_type, entity_id, details, ip_address)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// Per-entity SQL to pull a human-readable label. Run only when entity_id is
// non-null and the caller did not already supply details.entityLabel (e.g. a
// pre-delete snapshot). Each query selects exactly one column aliased to
// `label` so the helper can read it generically.
const ENTITY_LABEL_QUERIES = {
  product:      'SELECT name AS label FROM products WHERE id = ?',
  category:     'SELECT name AS label FROM categories WHERE id = ?',
  discount:     'SELECT code AS label FROM discount_codes WHERE id = ?',
  stock:        'SELECT data AS label FROM stock WHERE id = ?',
  variant:      'SELECT name AS label FROM product_variants WHERE id = ?',
  admin:        'SELECT display_name AS label FROM admins WHERE id = ?',
  order:        'SELECT payment_code AS label FROM orders WHERE id = ?',
  announcement: 'SELECT title AS label FROM announcements WHERE id = ?',
};

const LABEL_MAX_LEN = 80;

function enrichDetailsWithLabel(entityType, entityId, details) {
  if (!entityType || entityId == null) return details;
  if (details && Object.prototype.hasOwnProperty.call(details, 'entityLabel')) return details;
  const query = ENTITY_LABEL_QUERIES[entityType];
  if (!query) return details;
  try {
    const row = db.prepare(query).get(entityId);
    if (!row || row.label == null) return details;
    let label = String(row.label);
    if (label.length > LABEL_MAX_LEN) label = label.slice(0, LABEL_MAX_LEN) + '…';
    return { ...(details || {}), entityLabel: label };
  } catch {
    return details;
  }
}

const auditService = {
  log(adminId, action, entityType = null, entityId = null, details = null, ipAddress = null) {
    const enriched = enrichDetailsWithLabel(entityType, entityId, details);
    insertAudit.run(
      adminId,
      action,
      entityType,
      entityId,
      enriched ? JSON.stringify(enriched) : null,
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
