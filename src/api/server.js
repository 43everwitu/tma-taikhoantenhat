const { Router } = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { requireAdmin } = require('./middleware/auth');
const { auditLog } = require('./middleware/audit');

function createApiRouter() {
  const router = Router();

  // CORS
  router.use(cors({
    origin: [config.WEB_URL, 'http://localhost:3001', 'http://localhost:3000'],
    credentials: true,
  }));

  // Rate limiters
  const publicLimiter = rateLimit({ windowMs: 60000, max: 100, standardHeaders: true });
  const authLimiter = rateLimit({ windowMs: 60000, max: 10, standardHeaders: true });
  const customerLimiter = rateLimit({ windowMs: 60000, max: 30, standardHeaders: true });
  const adminLimiter = rateLimit({ windowMs: 60000, max: 60, standardHeaders: true });

  // Auth routes
  router.use('/auth', authLimiter, require('./routes/auth'));

  // Public routes
  router.use('/', publicLimiter, require('./routes/public'));

  // SSE stream — no rate limit (single long-lived connection per client)
  router.use('/', require('./routes/events'));

  // Customer routes
  router.use('/', customerLimiter, require('./routes/customer'));

  // Admin routes
  router.use('/admin', adminLimiter, requireAdmin, auditLog, require('./routes/admin'));

  return router;
}

module.exports = { createApiRouter };
