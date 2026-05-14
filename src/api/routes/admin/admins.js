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

function shape2faInList(row) {
  let backupCount = 0;
  if (row.totp_backup_codes) {
    try { backupCount = JSON.parse(row.totp_backup_codes).length; } catch {}
  }
  return {
    enabled: !!row.totp_enabled,
    required: row.role === 'super_admin' || !!row.totp_required,
    backupCount,
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, username, display_name, role, is_active, last_login_at, created_at, permissions,
           totp_enabled, totp_required, totp_backup_codes
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
      twoFactor: shape2faInList(r),
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
  const hash = await bcrypt.hash(password, 12);
  // Manager + admin roles default to totp_required so first login forces
  // enrollment. super_admin is always implicitly required at the service layer.
  const totpRequired = (role === 'manager' || role === 'admin') ? 1 : 0;
  try {
    const r = db.prepare(`
      INSERT INTO admins (username, password_hash, display_name, role, totp_required)
      VALUES (?, ?, ?, ?, ?)
    `).run(username, hash, displayName, role, totpRequired);
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
    params.push(await bcrypt.hash(req.validated.password, 12));
  }
  if (sets.length === 0) return res.json({ success: true, data: { changes: 0 } });
  params.push(id);
  const r = db.prepare(`UPDATE admins SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  auditService.log(req.admin.adminId, 'admin.update', 'admin', id, { fields: Object.keys(req.validated) }, req.ip);
  res.json({ success: true, data: { changes: r.changes } });
});

// PATCH /admin/admins/:id/2fa — super_admin can force-required or fully reset
// another admin's 2FA. Reset clears the secret + backup codes + sets
// totp_required so the user is bounced into enrollment on next login.
router.patch('/:id/2fa', requirePermission('admins.write'), validate(z.object({
  required: z.boolean().optional(),
  reset: z.boolean().optional(),
})), (req, res) => {
  if (req.admin.role !== 'super_admin') {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Chỉ super_admin có thể chỉnh 2FA tài khoản khác.' } });
  }
  const id = parseInt(req.params.id);
  const target = db.prepare('SELECT id, role FROM admins WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const sets = [];
  const params = [];
  if (req.validated.required !== undefined) {
    sets.push('totp_required = ?');
    params.push(req.validated.required ? 1 : 0);
  }
  if (req.validated.reset === true) {
    sets.push('totp_enabled = 0', 'totp_secret = NULL', 'totp_backup_codes = NULL', 'totp_required = 1');
    db.prepare('DELETE FROM admin_2fa_attempts WHERE admin_id = ?').run(id);
  }
  if (sets.length === 0) return res.json({ success: true, data: { changes: 0 } });
  params.push(id);
  db.prepare(`UPDATE admins SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  auditService.log(req.admin.adminId,
    req.validated.reset ? 'admin.2fa.reset' : 'admin.2fa.force',
    'admin', id, req.validated, req.ip);
  res.json({ success: true, data: { updated: true } });
});

module.exports = router;
