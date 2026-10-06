const db = require('../database');

const STATUS_LABELS = {
  active: 'Đang hoạt động',
  expiring_soon: 'Sắp hết hạn',
  expired: 'Đã hết hạn',
};

function getReminderDays() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'key_expiry_reminder_days'").get();
  const n = parseInt(row?.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function shapeLifecycle({ orderId, productId, productSlug, startDate, expiryDate, durationDays, remainingDays }) {
  const reminderDays = getReminderDays();
  const status = remainingDays < 0
    ? 'expired'
    : remainingDays <= reminderDays
      ? 'expiring_soon'
      : 'active';
  const elapsedDays = Math.max(0, durationDays - Math.max(0, remainingDays));
  const progressPercent = durationDays > 0
    ? clamp(Math.round((elapsedDays / durationDays) * 100), 0, 100)
    : 0;

  return {
    status,
    statusLabel: STATUS_LABELS[status],
    startDate,
    expiryDate,
    remainingDays,
    durationDays,
    reminderDays,
    progressPercent: status === 'expired' ? 100 : progressPercent,
    productId,
    productSlug,
    renewalReminderSent: hasSentRenewalReminder(orderId),
    renewUrl: productSlug ? `/san-pham/${productSlug}?renewFromOrderId=${orderId}` : null,
    orderUrl: `/don-hang/${orderId}`,
  };
}

function hasSentRenewalReminder(orderId) {
  if (!orderId) return false;
  const hasTable = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'renewal_reminder_logs'").get();
  if (!hasTable) return false;
  const row = db.prepare(`
    SELECT 1
    FROM renewal_reminder_logs
    WHERE order_id = ?
      AND status = 'sent'
    LIMIT 1
  `).get(orderId);
  return !!row;
}

function parseDeliveredKeys(order) {
  try {
    const keys = JSON.parse(order?.delivered_keys_json || '[]');
    return Array.isArray(keys) ? keys.filter((key) => typeof key === 'string' && key.length > 0) : [];
  } catch {
    return [];
  }
}

function selectLifecycleRow(order, extraWhere = '', extraParams = []) {
  const variantWhere = order.variant_id == null
    ? 'AND s.variant_id IS NULL'
    : 'AND s.variant_id = ?';
  const variantParams = order.variant_id == null ? [] : [order.variant_id];
  // A repeat purchase of the same instructional-text product can leave two
  // stock rows with byte-identical `data` (the text has no per-sale unique
  // value), so filtering by data alone can match more than one row. Order by
  // closeness of sold_at to this order's own delivery time and take exactly
  // one row instead of aggregating MIN() across every match, which used to
  // silently pick an unrelated older (possibly already-expired) sale.
  const anchor = order.delivered_at || order.paid_at || order.created_at;
  return db.prepare(`
    SELECT
      p.slug AS product_slug,
      DATE(s.sold_at) AS start_date,
      DATE(s.sold_at, '+' || s.duration_days || ' days') AS expiry_date,
      s.duration_days AS duration_days,
      CAST(julianday(DATE(s.sold_at, '+' || s.duration_days || ' days')) - julianday(DATE('now')) AS INTEGER) AS remaining_days
    FROM stock s
    JOIN products p ON p.id = s.product_id
    WHERE s.sold_to = ?
      AND s.product_id = ?
      AND s.is_sold = 1
      AND s.duration_days IS NOT NULL
      AND s.duration_days > 0
      ${variantWhere}
      ${extraWhere}
    ORDER BY ABS(strftime('%s', s.sold_at) - strftime('%s', ?))
    LIMIT 1
  `).get(order.user_id, order.product_id, ...variantParams, ...extraParams, anchor);
}

function getKeyLifecycleForOrder(order) {
  if (!order || order.status !== 'delivered') return null;
  const deliveredKeys = parseDeliveredKeys(order);
  let row = null;

  if (deliveredKeys.length > 0) {
    const placeholders = deliveredKeys.map(() => '?').join(', ');
    row = selectLifecycleRow(order, `AND s.data IN (${placeholders})`, deliveredKeys);
  }

  if ((!row || !row.expiry_date) && order.delivered_at) {
    row = selectLifecycleRow(
      order,
      "AND ABS(strftime('%s', s.sold_at) - strftime('%s', ?)) <= 300",
      [order.delivered_at],
    );
  }

  if (!row || !row.expiry_date) {
    row = selectLifecycleRow(order);
  }

  if (!row || !row.expiry_date || !row.start_date || !row.duration_days) return null;
  return shapeLifecycle({
    orderId: order.id,
    productId: order.product_id,
    productSlug: row.product_slug,
    startDate: row.start_date,
    expiryDate: row.expiry_date,
    durationDays: row.duration_days,
    remainingDays: row.remaining_days,
  });
}

function decorateOrdersWithLifecycle(orders) {
  return orders.map((order) => ({
    ...order,
    keyLifecycle: getKeyLifecycleForOrder(order),
  }));
}

function findDeliveredOrderForStock(stockRow) {
  if (!stockRow) return null;
  const baseSelect = `
    SELECT o.*, p.name AS product_name, p.slug AS product_slug
    FROM orders o
    JOIN products p ON p.id = o.product_id
    WHERE o.user_id = ?
      AND o.product_id = ?
      AND o.status = 'delivered'
      AND (
        (o.variant_id IS NULL AND ? IS NULL)
        OR o.variant_id = ?
      )
  `;
  const baseParams = [stockRow.sold_to, stockRow.product_id, stockRow.variant_id ?? null, stockRow.variant_id ?? null];

  const snapshotMatch = db.prepare(`
    ${baseSelect}
      AND json_valid(o.delivered_keys_json) = 1
      AND EXISTS (
        SELECT 1
        FROM json_each(o.delivered_keys_json) delivered_key
        WHERE CAST(delivered_key.value AS TEXT) = ?
      )
    ORDER BY o.delivered_at DESC, o.id DESC
    LIMIT 1
  `).get(...baseParams, stockRow.data);
  if (snapshotMatch) return snapshotMatch;

  if (stockRow.sold_at) {
    const timeMatch = db.prepare(`
      ${baseSelect}
        AND o.delivered_at IS NOT NULL
        AND ABS(strftime('%s', o.delivered_at) - strftime('%s', ?)) <= 300
      ORDER BY ABS(strftime('%s', o.delivered_at) - strftime('%s', ?)), o.id DESC
      LIMIT 1
    `).get(...baseParams, stockRow.sold_at, stockRow.sold_at);
    if (timeMatch) return timeMatch;
  }

  return db.prepare(`
    ${baseSelect}
    ORDER BY o.delivered_at DESC, o.id DESC
    LIMIT 1
  `).get(...baseParams) || null;
}

function getKeyLifecycleForStock(stockRow, order) {
  if (!stockRow || !order || !stockRow.duration_days) return null;
  const row = db.prepare(`
    SELECT
      DATE(?) AS start_date,
      DATE(?, '+' || ? || ' days') AS expiry_date,
      CAST(julianday(DATE(?, '+' || ? || ' days')) - julianday(DATE('now')) AS INTEGER) AS remaining_days
  `).get(stockRow.sold_at, stockRow.sold_at, stockRow.duration_days, stockRow.sold_at, stockRow.duration_days);

  return shapeLifecycle({
    orderId: order.id,
    productId: stockRow.product_id,
    productSlug: order.product_slug,
    startDate: row.start_date,
    expiryDate: row.expiry_date,
    durationDays: stockRow.duration_days,
    remainingDays: row.remaining_days,
  });
}

module.exports = {
  getReminderDays,
  getKeyLifecycleForOrder,
  decorateOrdersWithLifecycle,
  findDeliveredOrderForStock,
  getKeyLifecycleForStock,
};
