const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const auditService = require('../../../services/auditService');
const { sanitizeRich } = require('../../../utils/richHtml');
const { validate } = require('../../middleware/validate');

const router = Router();

function shapeAnnouncement(r) {
  let errorDetails = null;
  if (r.error_details) {
    try { errorDetails = JSON.parse(r.error_details); } catch { errorDetails = null; }
  }
  return {
    id: String(r.id),
    title: r.title,
    body: r.body,
    imageUrl: r.image_url || '',
    target: r.target || 'all',
    pinned: !!r.is_pinned,
    sentCount: r.sent_count || 0,
    failedCount: r.failed_count || 0,
    adminId: r.admin_id,
    createdAt: r.created_at,
    errorDetails,
  };
}

function formatAnnouncementBody(raw) {
  if (raw == null) return '';
  const withMarkdown = String(raw)
    .replace(/\*\*([^\n*][\s\S]*?[^\n*]|\S)\*\*/g, '<b>$1</b>')
    .replace(/~~([^\n~][\s\S]*?[^\n~]|\S)~~/g, '<s>$1</s>');
  return sanitizeRich(withMarkdown);
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
  imageUrl: z.string().max(500).nullable().optional(),
  target: z.enum(['all', 'telegram', 'web']).optional().default('all'),
  isPinned: z.boolean().optional().default(false),
})), async (req, res) => {
  const d = req.validated;
  const cleanBody = formatAnnouncementBody(d.body);

  const notificationService = req.app.locals.notificationService;
  if (!notificationService) {
    return res.status(500).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });
  }

  const imageUrl = d.imageUrl ? d.imageUrl.trim() : null;
  const result = await notificationService.broadcast(d.title, cleanBody, d.target, req.admin.adminId, undefined, { imageUrl });

  // Update pinned status
  if (d.isPinned) {
    db.prepare('UPDATE announcements SET is_pinned = 1 WHERE id = ?').run(result.announcementId);
  }

  auditService.log(req.admin.adminId, 'announcement.create', 'announcement', result.announcementId, { sent: result.sent, failed: result.failed }, req.ip);

  res.json({ success: true, data: result });
});

// PATCH /admin/announcements/:id — update title/body/target/pinned (no resend)
router.patch('/:id', validate(z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(1).max(5000).optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  target: z.enum(['all', 'telegram', 'web']).optional(),
  isPinned: z.boolean().optional(),
})), (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT id FROM announcements WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const sets = []; const params = [];
  if (req.validated.title !== undefined) { sets.push('title = ?'); params.push(req.validated.title); }
  if (req.validated.body !== undefined) {
    const cleanBody = formatAnnouncementBody(req.validated.body);
    sets.push('body = ?'); params.push(cleanBody);
  }
  if (req.validated.imageUrl !== undefined) {
    sets.push('image_url = ?'); params.push(req.validated.imageUrl ? req.validated.imageUrl.trim() : null);
  }
  if (req.validated.target !== undefined) { sets.push('target = ?'); params.push(req.validated.target); }
  if (req.validated.isPinned !== undefined) { sets.push('is_pinned = ?'); params.push(req.validated.isPinned ? 1 : 0); }
  if (sets.length === 0) return res.status(400).json({ success: false, error: { code: 'NO_CHANGES' } });
  params.push(id);
  db.prepare(`UPDATE announcements SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  auditService.log(req.admin.adminId, 'announcement.update', 'announcement', id, req.validated, req.ip);
  res.json({ success: true });
});

// POST /admin/announcements/:id/resend — re-broadcast existing announcement
router.post('/:id/resend', async (req, res) => {
  const id = parseInt(req.params.id);
  const row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const notificationService = req.app.locals.notificationService;
  if (!notificationService) return res.status(500).json({ success: false, error: { code: 'SERVICE_UNAVAILABLE' } });

  const result = await notificationService.broadcast(row.title, row.body, row.target || 'all', req.admin.adminId, undefined, {
    imageUrl: row.image_url || null,
  });
  // Merge stats — overwrite with latest run's stats so admin sees fresh numbers.
  // Delete the new row created by broadcast (it dup-inserted) and update original.
  db.prepare('DELETE FROM announcements WHERE id = ?').run(result.announcementId);
  db.prepare(`
    UPDATE announcements
       SET sent_count = ?, failed_count = ?, error_details = ?
     WHERE id = ?
  `).run(result.sent, result.failed, result.errors && result.errors.length > 0 ? JSON.stringify(result.errors) : null, id);

  auditService.log(req.admin.adminId, 'announcement.resend', 'announcement', id, { sent: result.sent, failed: result.failed }, req.ip);
  res.json({ success: true, data: { sent: result.sent, failed: result.failed } });
});

// DELETE /admin/announcements/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const annSnap = db.prepare('SELECT title, target FROM announcements WHERE id = ?').get(id);
  db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  auditService.log(req.admin.adminId, 'announcement.delete', 'announcement', id, annSnap ? {
    entityLabel: annSnap.title,
    target: annSnap.target,
  } : null, req.ip);
  res.json({ success: true });
});

module.exports = router;
