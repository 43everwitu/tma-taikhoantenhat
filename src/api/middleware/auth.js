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

module.exports = { requireAdmin, requireCustomer, optionalCustomer };
