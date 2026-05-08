const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const sanitizeHtml = require('sanitize-html');
const auditService = require('../../../services/auditService');
const { validate } = require('../../middleware/validate');

const router = Router();

function shapeAnnouncement(r) {
  return {
    id: String(r.id),
    title: r.title,
    body: r.body,
    target: r.target || 'all',
    pinned: !!r.is_pinned,
    sentCount: r.sent_count || 0,
    failedCount: r.failed_count || 0,
    adminId: r.admin_id,
    createdAt: r.created_at,
  };
}

// GET /admin/announcements
router.get('/', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM announcements ORDER BY created_at DESC LIMIT 50'
  ).all();
  res.json({ success: true, data: rows.map(shapeAnnouncement) });
});

// POST /admin/announcements — Create and send
router.post('/', validate(z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  target: z.enum(['all', 'telegram', 'web']).optional().default('all'),
  isPinned: z.boolean().optional().default(false),
})), async (req, res) => {
  const d = req.validated;
  const cleanBody = sanitizeHtml(d.body, {
    allowedTags: ['b', 'i', 'a', 'code', 'pre'],
    allowedAttributes: { a: ['href'] },
  });

  const notificationService = req.app.locals.notificationService;
  if (!notificationService) {
    return res.status(500).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  }

  const result = await notificationService.broadcast(d.title, cleanBody, d.target, req.admin.adminId);

  // Update pinned status
  if (d.isPinned) {
    db.prepare('UPDATE announcements SET is_pinned = 1 WHERE id = ?').run(result.announcementId);
  }

  auditService.log(req.admin.adminId, 'announcement.create', 'announcement', result.announcementId, { sent: result.sent, failed: result.failed }, req.ip);

  res.json({ success: true, data: result });
});

// DELETE /admin/announcements/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  auditService.log(req.admin.adminId, 'announcement.delete', 'announcement', id, null, req.ip);
  res.json({ success: true });
});

module.exports = router;
