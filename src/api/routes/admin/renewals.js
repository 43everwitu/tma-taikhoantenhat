const { Router } = require('express');
const db = require('../../../database');
const { requirePermission } = require('../../middleware/auth');
const keyExpiryReminderService = require('../../../services/keyExpiryReminderService');

const router = Router();
const VALID_STATUS = new Set(['sent', 'sent_legacy', 'skipped', 'failed', 'exhausted']);

function shape(row) {
  return {
    id: String(row.id),
    stockId: row.stock_id ? String(row.stock_id) : null,
    orderId: row.order_id ? String(row.order_id) : null,
    userId: String(row.user_id),
    productId: String(row.product_id),
    productName: row.product_name,
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

  if (req.query.status && VALID_STATUS.has(String(req.query.status))) {
    where += ' AND status = ?';
    params.push(String(req.query.status));
  }

  const q = String(req.query.q || '').trim();
  if (q) {
    where += ` AND (
      product_name LIKE ?
      OR CAST(order_id AS TEXT) LIKE ?
      OR CAST(user_id AS TEXT) LIKE ?
      OR message_body LIKE ?
    )`;
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }

  const total = db.prepare(`SELECT COUNT(*) AS c FROM renewal_reminder_logs WHERE ${where}`).get(...params).c;
  const rows = db.prepare(`
    SELECT *
    FROM renewal_reminder_logs
    WHERE ${where}
    ORDER BY created_at DESC, id DESC
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
