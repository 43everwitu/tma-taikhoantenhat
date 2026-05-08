const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const { slugify } = require('../../../utils/slugify');
const auditService = require('../../../services/auditService');
const { validate } = require('../../middleware/validate');

const router = Router();

// GET /admin/categories
router.get('/', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order').all();
  res.json({ success: true, data: categories });
});

// POST /admin/categories
router.post('/', validate(z.object({
  name: z.string().min(1).max(100),
  emoji: z.string().max(10).optional().default('📦'),
  description: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().optional().default(0),
})), (req, res) => {
  const d = req.validated;
  const result = db.prepare(
    'INSERT INTO categories (name, emoji, slug, description, sort_order) VALUES (?, ?, ?, ?, ?)'
  ).run(d.name, d.emoji, slugify(d.name), d.description || null, d.sortOrder);

  auditService.log(req.admin.adminId, 'category.create', 'category', result.lastInsertRowid, { name: d.name }, req.ip);
  const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(result.lastInsertRowid);
  res.json({ success: true, data: cat });
});

// PUT /admin/categories/:id
router.put('/:id', validate(z.object({
  name: z.string().min(1).max(100).optional(),
  emoji: z.string().max(10).optional(),
  description: z.string().max(500).nullable().optional(),
  sortOrder: z.number().int().optional(),
})), (req, res) => {
  const id = parseInt(req.params.id);
  const d = req.validated;
  const sets = [];
  const params = [];

  if (d.name !== undefined) { sets.push('name = ?', 'slug = ?'); params.push(d.name, slugify(d.name)); }
  if (d.emoji !== undefined) { sets.push('emoji = ?'); params.push(d.emoji); }
  if (d.description !== undefined) { sets.push('description = ?'); params.push(d.description); }
  if (d.sortOrder !== undefined) { sets.push('sort_order = ?'); params.push(d.sortOrder); }

  if (sets.length === 0) return res.json({ success: true });

  params.push(id);
  db.prepare(`UPDATE categories SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  auditService.log(req.admin.adminId, 'category.update', 'category', id, d, req.ip);

  const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
  res.json({ success: true, data: updated });
});

// DELETE /admin/categories/:id
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  auditService.log(req.admin.adminId, 'category.delete', 'category', id, null, req.ip);
  res.json({ success: true });
});

module.exports = router;
