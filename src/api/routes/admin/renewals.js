const { Router } = require('express');
const db = require('../../../database');
const { requirePermission } = require('../../middleware/auth');
const keyExpiryReminderService = require('../../../services/keyExpiryReminderService');

const router = Router();
const VALID_STATUS = new Set(['sent', 'sent_legacy', 'skipped', 'failed', 'exhausted']);

function variantLabel(name) {
  return name?.trim() || 'mặc định/legacy';
}

function shape(row) {
  return {
    id: String(row.id),
    stockId: row.stock_id ? String(row.stock_id) : null,
    stockValue: row.stock_value || null,
    orderId: row.order_id ? String(row.order_id) : null,
    userId: String(row.user_id),
    userName: row.user_name || null,
    username: row.username || null,
    productId: String(row.product_id),
    productName: row.product_name,
    variantId: row.variant_id ? String(row.variant_id) : null,
    variantName: row.variant_name || null,
    variantLabel: variantLabel(row.variant_name),
    expiryDate: row.expiry_date,
    daysBeforeExpiry: row.days_before_expiry,
    telegramSent: !!row.telegram_sent,
    webNotificationId: row.web_notification_id ? String(row.web_notification_id) : null,
    status: row.status,
    errorMessage: row.error_message || null,
    messageBody: row.message_body || '',
    createdAt: row.created_at,
  };
}

router.get('/', requirePermission('orders.read'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
  const offset = (page - 1) * limit;
  const params = [];
  let where = '1=1';
  const from = `
    FROM renewal_reminder_logs l
    LEFT JOIN stock s ON s.id = l.stock_id
    LEFT JOIN product_variants v ON v.id = s.variant_id
    LEFT JOIN users u ON u.telegram_id = l.user_id
  `;

  if (req.query.status && VALID_STATUS.has(String(req.query.status))) {
    where += ' AND l.status = ?';
    params.push(String(req.query.status));
  }

  const q = String(req.query.q || '').trim();
  if (q) {
    where += ` AND (
      l.product_name LIKE ?
      OR CAST(l.order_id AS TEXT) LIKE ?
      OR CAST(l.user_id AS TEXT) LIKE ?
      OR l.message_body LIKE ?
      OR s.data LIKE ?
      OR v.name LIKE ?
      OR u.full_name LIKE ?
      OR u.username LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like, like, like, like, like);
  }

  const total = db.prepare(`SELECT COUNT(*) AS c ${from} WHERE ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT
      l.*,
      s.data AS stock_value,
      v.id AS variant_id,
      v.name AS variant_name,
      u.full_name AS user_name,
      u.username
    ${from}
    WHERE ${where}
    ORDER BY l.created_at DESC, l.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  res.json({
    success: true,
    data: {
      items: rows.map(shape),
      total,
      page,
      limit,
    },
  });
});

router.post('/sweep', requirePermission('orders.write'), async (req, res, next) => {
  const bot = req.app.get('bot');
  if (!bot) {
    return res.status(500).json({
      success: false,
      error: { code: 'BOT_UNAVAILABLE', message: 'Bot chưa sẵn sàng để quét gia hạn.' },
    });
  }

  try {
    keyExpiryReminderService.init(bot);
    const summary = await keyExpiryReminderService.sweep();
    res.json({ success: true, data: summary });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
