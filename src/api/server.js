const { Router } = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { requireAdmin, loadAdminPermissions } = require('./middleware/auth');

const KNOWN_API_ERRORS = {
  DUPLICATE_PENDING: {
    status: 409,
    message: 'Bạn đã có đơn chờ thanh toán cho sản phẩm này',
  },
  INSUFFICIENT_STOCK: {
    status: 400,
    message: 'Sản phẩm vừa hết hàng, vui lòng thử lại',
  },
  INSUFFICIENT_BALANCE: {
    status: 400,
    message: 'Số dư không đủ để thanh toán',
  },
};

function normalizeApiError(err) {
  if (err && typeof err === 'object' && err.body) {
    return {
      status: Number.isInteger(err.status) ? err.status : 500,
      body: err.body,
    };
  }

  const code = err instanceof Error ? err.message : 'INTERNAL';
  const known = KNOWN_API_ERRORS[code];
  if (known) {
    return {
      status: known.status,
      body: { success: false, error: { code, message: known.message } },
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      error: { code: 'INTERNAL', message: 'Có lỗi xảy ra, vui lòng thử lại' },
    },
  };
}

function createApiRouter() {
  const router = Router();

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

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
  const integrationLimiter = rateLimit({ windowMs: 60000, max: 120, standardHeaders: true });
  const customerLimiter = rateLimit({ windowMs: 60000, max: 60, standardHeaders: true, skip: () => isDev });
  const adminLimiter = rateLimit({ windowMs: 60000, max: 600, standardHeaders: true, skip: () => isDev });

  // Integration routes tự xác thực bằng HMAC, không dùng customer/admin auth.
  router.use('/integrations', integrationLimiter, require('./routes/integrations'));

  // Auth routes
  router.use('/auth', authLimiter, require('./routes/auth'));

  // Public routes
  router.use('/', publicLimiter, require('./routes/public'));

  // SSE stream — no rate limit (single long-lived connection per client)
  router.use('/', require('./routes/events'));

  // Customer routes
  router.use('/', customerLimiter, require('./routes/customer'));

  // Admin routes
  router.use('/admin', adminLimiter, requireAdmin, loadAdminPermissions, require('./routes/admin'));

  router.use((req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'API không tồn tại' },
    });
  });

  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_JSON', message: 'JSON không hợp lệ' },
      });
    }
    const { status, body } = normalizeApiError(err);
    if (status >= 500) console.error('[api]', err);
    return res.status(status).json(body);
  });

  return router;
}

module.exports = { createApiRouter, normalizeApiError };
