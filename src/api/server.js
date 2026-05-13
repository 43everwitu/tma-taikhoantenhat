const { Router } = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { requireAdmin, loadAdminPermissions } = require('./middleware/auth');
const { auditLog } = require('./middleware/audit');

function createApiRouter() {
  const router = Router();

  // CORS. Build the allow-list: explicit localhost, the configured WEB_URL
  // (trailing slash stripped — browsers send Origin without one), and any
  // *.taikhoantenhat.me subdomain so the public tunnel works even when
  // WEB_URL is misconfigured.
  const webOrigin = (config.WEB_URL || '').replace(/\/$/, '');
  router.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const allowed = [
        webOrigin,
        'http://localhost:3001',
        'http://localhost:3000',
      ];
      if (allowed.includes(origin)) return cb(null, true);
      if (/\.taikhoantenhat\.me$/.test(new URL(origin).hostname)) return cb(null, true);
      if (/\.trycloudflare\.com$/.test(new URL(origin).hostname)) return cb(null, true);
      if (/\.ngrok(-free)?\.(app|io)$/.test(new URL(origin).hostname)) return cb(null, true);
      return cb(new Error(`CORS: origin ${origin} not allowed`));
    },
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
