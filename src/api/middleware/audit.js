const auditService = require('../../services/auditService');

/**
 * Audit log middleware for admin routes.
 * Logs POST/PUT/PATCH/DELETE requests.
 */
function auditLog(req, res, next) {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const originalJson = res.json.bind(res);
    res.json = function(data) {
      // Only log successful mutations
      if (data && data.success && req.admin) {
        const path = req.originalUrl.replace('/api/v1/admin/', '');
        const action = `${req.method.toLowerCase()}.${path.split('/')[0]}`;
        auditService.log(
          req.admin.adminId,
          action,
          null, null,
          { path: req.originalUrl, method: req.method },
          req.ip
        );
      }
      return originalJson(data);
    };
  }
  next();
}

module.exports = { auditLog };
