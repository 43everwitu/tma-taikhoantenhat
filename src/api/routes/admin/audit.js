const { Router } = require('express');
const auditService = require('../../../services/auditService');
const { requirePermission } = require('../../middleware/auth');

const router = Router();

router.use(requirePermission('audit.read'));

// GET /admin/audit-log/entity-types
// Distinct entity_type values present in audit_log (for the filter dropdown).
router.get('/entity-types', (req, res) => {
  res.json({ success: true, data: auditService.getEntityTypes() });
});

// GET /admin/audit-log?adminId=&action=&entityType=&from=&to=&q=&page=1&limit=50
router.get('/', (req, res) => {
  const { adminId, action, entityType, from, to, q, page = 1, limit = 50 } = req.query;
  const parsedPage = Math.max(1, parseInt(page) || 1);
  const parsedLimit = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset = (parsedPage - 1) * parsedLimit;
  const trimmedQ = typeof q === 'string' ? q.trim().slice(0, 200) : null;

  const result = auditService.getRecent(parsedLimit, offset, {
    adminId: adminId ? parseInt(adminId) : null,
    action: typeof action === 'string' && action.trim() ? action.trim() : null,
    entityType: typeof entityType === 'string' && entityType.trim() ? entityType.trim() : null,
    from: typeof from === 'string' && from.trim() ? from.trim() : null,
    to: typeof to === 'string' && to.trim() ? to.trim() : null,
    q: trimmedQ || null,
  });

  res.json({
    success: true,
    data: result.rows,
    meta: { page: parsedPage, limit: parsedLimit, total: result.total },
  });
});

module.exports = router;
