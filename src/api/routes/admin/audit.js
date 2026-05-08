const { Router } = require('express');
const auditService = require('../../../services/auditService');

const router = Router();

// GET /admin/audit-log?adminId=&action=&entityType=&page=1&limit=50
router.get('/', (req, res) => {
  const { adminId, action, entityType, page = 1, limit = 50 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const result = auditService.getRecent(parseInt(limit), offset, {
    adminId: adminId ? parseInt(adminId) : null,
    action: action || null,
    entityType: entityType || null,
  });

  res.json({ success: true, data: result.rows, meta: { page: parseInt(page), limit: parseInt(limit), total: result.total } });
});

module.exports = router;
