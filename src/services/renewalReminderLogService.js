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
    WITH matched_logs AS (
      SELECT
        s.id AS stock_id,
        u.telegram_id AS user_id,
        p.id AS product_id,
        p.name AS product_name,
        s.sold_at,
        s.duration_days,
        s.reminder_sent_at,
        DATE(s.sold_at, '+' || s.duration_days || ' days') AS expiry_date,
        CAST(
          julianday(DATE(s.sold_at, '+' || s.duration_days || ' days'))
          - julianday(DATE(s.reminder_sent_at))
          AS INTEGER
        ) AS days_before_expiry,
        (
          SELECT o.id
          FROM orders o
          WHERE o.user_id = s.sold_to
            AND o.product_id = s.product_id
            AND o.status = 'delivered'
            AND (
              (o.variant_id IS NULL AND s.variant_id IS NULL)
              OR o.variant_id = s.variant_id
            )
            AND json_valid(o.delivered_keys_json) = 1
            AND EXISTS (
              SELECT 1
              FROM json_each(o.delivered_keys_json) delivered_key
              WHERE CAST(delivered_key.value AS TEXT) = s.data
            )
          ORDER BY o.delivered_at DESC, o.id DESC
          LIMIT 1
        ) AS order_id
      FROM stock s
      JOIN products p ON p.id = s.product_id
      JOIN users u ON u.telegram_id = s.sold_to
      WHERE s.reminder_sent_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM renewal_reminder_logs r
          WHERE r.stock_id = s.id
        )
    )
    SELECT
      matched_logs.*,
      (
        SELECT n.id
        FROM notifications n
        WHERE matched_logs.order_id IS NOT NULL
          AND n.user_id = matched_logs.user_id
          AND n.type = 'renewal_reminder'
          AND json_valid(n.data) = 1
          AND CAST(json_extract(n.data, '$.orderId') AS TEXT)
            = CAST(matched_logs.order_id AS TEXT)
          AND ABS(
            strftime('%s', n.created_at)
            - strftime('%s', matched_logs.reminder_sent_at)
          ) <= 300
        ORDER BY n.id DESC
        LIMIT 1
      ) AS web_notification_id
    FROM matched_logs
    ORDER BY matched_logs.reminder_sent_at ASC, matched_logs.stock_id ASC
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
  const insertAll = db.transaction(() => {
    let created = 0;

    for (const row of rows) {
      if (hasLog.get(row.stock_id)) continue;

      insertLogWithDatabase(db, {
        stockId: row.stock_id,
        orderId: row.order_id,
        userId: row.user_id,
        productId: row.product_id,
        productName: row.product_name,
        expiryDate: row.expiry_date,
        daysBeforeExpiry: row.days_before_expiry,
        telegramSent: 1,
        webNotificationId: row.web_notification_id,
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
