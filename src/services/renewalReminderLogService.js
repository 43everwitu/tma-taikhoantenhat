const MAX_FAILED_ATTEMPTS = 3;

function getDefaultDb() {
  return require('../database');
}

function countFailedAttempts(stockId) {
  const db = getDefaultDb();
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM renewal_reminder_logs
    WHERE stock_id = ?
      AND status = 'failed'
  `).get(stockId);
  return row.count;
}

function hasExhausted(stockId) {
  const db = getDefaultDb();
  const row = db.prepare(`
    SELECT 1
    FROM renewal_reminder_logs
    WHERE stock_id = ?
      AND status = 'exhausted'
    LIMIT 1
  `).get(stockId);
  return !!row;
}

function insertLogWithDatabase(db, {
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

function insertLog(input) {
  return insertLogWithDatabase(getDefaultDb(), input);
}

function findMissingLegacyLogs({ limit = 500, database } = {}) {
  const db = database || getDefaultDb();
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

function backfillMissingLegacyLogs({ apply = false, limit = 1000, database } = {}) {
  const db = database || getDefaultDb();
  const rows = findMissingLegacyLogs({ limit, database: db });
  if (!apply) {
    return { scanned: rows.length, created: 0, rows };
  }

  const hasLog = db.prepare(`
    SELECT 1
    FROM renewal_reminder_logs
    WHERE stock_id = ?
    LIMIT 1
  `);
  const getExpiryDate = db.prepare(`
    SELECT DATE(?, '+' || ? || ' days') AS expiry_date
  `);
  const insertAll = db.transaction(() => {
    let created = 0;

    for (const row of rows) {
      if (hasLog.get(row.stock_id)) continue;

      const expiryDate = row.sold_at && row.duration_days != null
        ? getExpiryDate.get(row.sold_at, row.duration_days).expiry_date
        : null;
      insertLogWithDatabase(db, {
        stockId: row.stock_id,
        userId: row.user_id,
        productId: row.product_id,
        productName: row.product_name,
        expiryDate,
        telegramSent: 1,
        status: 'sent_legacy',
        createdAt: row.reminder_sent_at,
      });
      created += 1;
    }

    return created;
  });

  return { scanned: rows.length, created: insertAll(), rows };
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  countFailedAttempts,
  hasExhausted,
  insertLog,
  findMissingLegacyLogs,
  backfillMissingLegacyLogs,
};
