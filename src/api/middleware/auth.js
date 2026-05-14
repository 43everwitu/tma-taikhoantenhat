const authService = require('../../services/authService');

/**
 * Admin JWT authentication middleware.
 */
function requireAdmin(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token required' } });

  authService.verifyAdminToken(token).then(payload => {
    if (!payload) return res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
    req.admin = payload;
    next();
  }).catch(() => {
    res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
  });
}

/**
 * Customer JWT authentication middleware.
 */
function requireCustomer(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Token required' } });

  authService.verifyCustomerToken(token).then(payload => {
    if (!payload) return res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
    req.customer = payload;
    next();
  }).catch(() => {
    res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid token' } });
  });
}

/**
 * Optional customer auth — sets req.customer if token present, but doesn't block.
 */
function optionalCustomer(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();

  authService.verifyCustomerToken(token).then(payload => {
    if (payload) req.customer = payload;
    next();
  }).catch(() => next());
}

function extractToken(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  return req.cookies?.token || null;
}

const permissionService = require('../../services/permissionService');
const db = require('../../database');

function loadAdminPermissions(req, res, next) {
  if (!req.admin?.adminId) return next();
  const row = db.prepare('SELECT id, role, permissions FROM admins WHERE id = ? AND is_active = 1').get(req.admin.adminId);
  if (!row) return res.status(401).json({ success: false, error: { code: 'ADMIN_INACTIVE' } });
  req.admin.role = row.role;
  req.admin.permissions = row.permissions;
  req.admin.perms = permissionService.resolvePerms(row);
  next();
}

function requirePermission(perm) {
  return (req, res, next) => {
    if (!permissionService.has(req.admin, perm)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: `Yêu cầu quyền ${perm}` } });
    }
    next();
  };
}

// Reject tokens that are not full admin sessions (i.e. the 2FA challenge or
// enrollment-step tokens). Mount on admin routes that should be inaccessible
// during enrollment. /admin/me + /admin/me/2fa/* skip this gate.
function requireFullAuth(req, res, next) {
  if (req.admin?.step) {
    return res.status(403).json({
      success: false,
      error: { code: 'STEP_REQUIRED', message: 'Phải hoàn tất 2FA trước', step: req.admin.step },
    });
  }
  next();
}

module.exports = { requireAdmin, requireCustomer, optionalCustomer, requirePermission, loadAdminPermissions, requireFullAuth };
