const { Router } = require('express');
const { z } = require('zod');
const bcrypt = require('bcrypt');
const db = require('../../../database');
const auditService = require('../../../services/auditService');
const permissionService = require('../../../services/permissionService');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/auth');

const router = Router();

router.use(requirePermission('admins.read'));

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, username, display_name, role, is_active, last_login_at, created_at, permissions
      FROM admins ORDER BY id
  `).all();
  res.json({
    success: true,
    data: rows.map(r => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      role: r.role,
      isActive: !!r.is_active,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
      permissions: permissionService.resolvePerms(r),
    })),
  });
});

router.post('/', requirePermission('admins.write'), validate(z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  displayName: z.string().min(1).max(100),
  role: z.enum(['super_admin', 'manager', 'admin']),
})), async (req, res) => {
  const { username, password, displayName, role } = req.validated;
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = db.prepare(`
      INSERT INTO admins (username, password_hash, display_name, role)
      VALUES (?, ?, ?, ?)
    `).run(username, hash, displayName, role);
    auditService.log(req.admin.adminId, 'admin.create', 'admin', r.lastInsertRowid, { role }, req.ip);
    res.status(201).json({ success: true, data: { id: r.lastInsertRowid } });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ success: false, error: { code: 'USERNAME_TAKEN' } });
    }
    throw err;
  }
});

router.patch('/:id', requirePermission('admins.write'), validate(z.object({
  role: z.enum(['super_admin', 'manager', 'admin']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).max(100).optional(),
  displayName: z.string().min(1).max(100).optional(),
})), async (req, res) => {
  const id = parseInt(req.params.id);
  const sets = [];
  const params = [];
  if (req.validated.role !== undefined) { sets.push('role = ?'); params.push(req.validated.role); }
  if (req.validated.isActive !== undefined) { sets.push('is_active = ?'); params.push(req.validated.isActive ? 1 : 0); }
  if (req.validated.displayName !== undefined) { sets.push('display_name = ?'); params.push(req.validated.displayName); }
  if (req.validated.password !== undefined) {
    sets.push('password_hash = ?');
    params.push(await bcrypt.hash(req.validated.password, 10));
  }
  if (sets.length === 0) return res.json({ success: true, data: { changes: 0 } });
  params.push(id);
  const r = db.prepare(`UPDATE admins SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  auditService.log(req.admin.adminId, 'admin.update', 'admin', id, { fields: Object.keys(req.validated) }, req.ip);
  res.json({ success: true, data: { changes: r.changes } });
});

module.exports = router;
