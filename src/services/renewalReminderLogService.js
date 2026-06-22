const db = require('../database');

const MAX_FAILED_ATTEMPTS = 3;

function countFailedAttempts(stockId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM renewal_reminder_logs
    WHERE stock_id = ?
      AND status = 'failed'
  `).get(stockId);
  return row.count;
}

function hasExhausted(stockId) {
  const row = db.prepare(`
    SELECT 1
    FROM renewal_reminder_logs
    WHERE stock_id = ?
      AND status = 'exhausted'
    LIMIT 1
  `).get(stockId);
  return !!row;
}

function insertLog({
  stockId,
  orderId = null,
  userId,
  productId,
  productName,
  expiryDate = null,
  daysBeforeExpiry = null,
  telegramSent = 0,
  webNotificationId = null,
  status,
  errorMessage = null,
  messageBody = null,
  createdAt = null,
}) {
  const columns = [
    'stock_id',
    'order_id',
    'user_id',
    'product_id',
    'product_name',
    'expiry_date',
    'days_before_expiry',
    'telegram_sent',
    'web_notification_id',
    'status',
    'error_message',
    'message_body',
  ];
  const values = [
    stockId,
    orderId,
    userId,
    productId,
    productName,
    expiryDate,
    daysBeforeExpiry,
    telegramSent ? 1 : 0,
    webNotificationId,
    status,
    errorMessage,
    messageBody,
  ];

  if (createdAt) {
    columns.push('created_at');
    values.push(createdAt);
  }

  const placeholders = columns.map(() => '?').join(', ');
  return db.prepare(`
    INSERT INTO renewal_reminder_logs (${columns.join(', ')})
    VALUES (${placeholders})
  `).run(...values);
}

function findMissingLegacyLogs({ limit = 500 } = {}) {
  return db.prepare(`
    SELECT
      s.id AS stock_id,
      u.telegram_id AS user_id,
      p.id AS product_id,
      p.name AS product_name,
      s.sold_at,
      s.duration_days,
      s.reminder_sent_at
    FROM stock s
    JOIN products p ON p.id = s.product_id
    JOIN users u ON u.telegram_id = s.sold_to
    WHERE s.reminder_sent_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM renewal_reminder_logs r
        WHERE r.stock_id = s.id
      )
    ORDER BY s.reminder_sent_at ASC, s.id ASC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  countFailedAttempts,
  hasExhausted,
  insertLog,
  findMissingLegacyLogs,
};
