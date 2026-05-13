const { Router } = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { requireAdmin, loadAdminPermissions } = require('./middleware/auth');
const { auditLog } = require('./middleware/audit');

function createApiRouter() {
  const router = Router();

  // CORS
  router.use(cors({
    origin: [config.WEB_URL, 'http://localhost:3001', 'http://localhost:3000'],
    credentials: true,
  }));

  // Rate limiters. Admin is a single trusted operator on a polling dashboard
  // (stats every 30s + sidebar metadata + ad-hoc fetches); 60/min was too low
  // and produced 429s. Bumped to 600/min and disabled entirely in dev.
  const isDev = process.env.NODE_ENV !== 'production';
  const publicLimiter = rateLimit({ windowMs: 60000, max: 200, standardHeaders: true, skip: () => isDev });
  const authLimiter = rateLimit({ windowMs: 60000, max: 20, standardHeaders: true });
  const customerLimiter = rateLimit({ windowMs: 60000, max: 60, standardHeaders: true, skip: () => isDev });
  const adminLimiter = rateLimit({ windowMs: 60000, max: 600, standardHeaders: true, skip: () => isDev });

  // Auth routes
  router.use('/auth', authLimiter, require('./routes/auth'));

  // Public routes
  router.use('/', publicLimiter, require('./routes/public'));

  // SSE stream — no rate limit (single long-lived connection per client)
  router.use('/', require('./routes/events'));

  // Customer routes
  router.use('/', customerLimiter, require('./routes/customer'));

  // Admin routes
  router.use('/admin', adminLimiter, requireAdmin, loadAdminPermissions, auditLog, require('./routes/admin'));

  return router;
}

module.exports = { createApiRouter };
