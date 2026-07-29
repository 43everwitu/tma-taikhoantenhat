const authService = require('../../services/authService');
const userModerationService = require('../../services/userModerationService');

function bannedResponse(res) {
  return res.status(403).json({
    success: false,
    error: {
      code: 'USER_BANNED',
      message: 'Tài khoản của bạn đã bị hạn chế. Vui lòng liên hệ hỗ trợ.',
    },
  });
}

/**
 * Admin JWT authentication middleware.
 */
function requireAdmin(req, res, next) {
  const token = extractToken(req);
  if (!token) return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Vui lòng đăng nhập để tiếp tục.' } });

  authService.verifyAdminToken(token).then(payload => {
    if (!payload) return res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.' } });
    req.admin = payload;
    next();
  }).catch(() => {
    res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại.' } });
  });
}

/**
 * Customer JWT authentication middleware.
 */
function requireCustomer(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({
      success: false,
      error: {
        code: 'UNAUTHORIZED',
        message: 'Phiên Telegram chưa sẵn sàng. Vui lòng mở lại Mini App từ Telegram rồi thử lại.',
      },
    });
  }

  authService.verifyCustomerToken(token).then(payload => {
    if (!payload) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Phiên Telegram đã hết hạn. Vui lòng mở lại Mini App từ Telegram rồi thử lại.',
        },
      });
    }
    if (userModerationService.isBanned(payload.telegramId)) {
      return bannedResponse(res);
    }
    req.customer = payload;
    next();
  }).catch(() => {
    res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Phiên Telegram không hợp lệ. Vui lòng mở lại Mini App từ Telegram rồi thử lại.',
      },
    });
  });
}

/**
 * Optional customer auth — sets req.customer if token present, but doesn't block.
 */
function optionalCustomer(req, res, next) {
  const token = extractToken(req);
  if (!token) return next();

  authService.verifyCustomerToken(token).then(payload => {
    if (payload && !userModerationService.isBanned(payload.telegramId)) req.customer = payload;
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
