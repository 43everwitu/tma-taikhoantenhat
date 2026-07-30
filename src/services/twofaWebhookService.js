const db = require('../database');
const messageTemplateService = require('./messageTemplateService');
const telegramApiClient = require('./telegramApiClient');

const STALE_PROCESSING_MINUTES = 10;
const SAFE_ERROR = 'Lỗi gửi thông báo cập nhật 2FA';

function createHttpError(code, status, message) {
  const err = new Error(message || code);
  err.code = code;
  err.status = status;
  return err;
}

function validatePayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw createHttpError('INVALID_PAYLOAD', 400, 'Payload không hợp lệ');
  }
  for (const field of ['eventId', 'bindingId', 'changedAt']) {
    if (typeof payload[field] !== 'string' || payload[field].trim() === '') {
      throw createHttpError('INVALID_PAYLOAD', 400, 'Payload không hợp lệ');
    }
  }
  const changedAt = new Date(payload.changedAt);
  if (Number.isNaN(changedAt.getTime())) {
    throw createHttpError('INVALID_PAYLOAD', 400, 'Payload không hợp lệ');
  }
  return {
    eventId: payload.eventId.trim(),
    bindingId: payload.bindingId.trim(),
    changedAt,
  };
}

function formatVietnamTime(date) {
  const parts = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.day}/${byType.month}/${byType.year} ${byType.hour}:${byType.minute}`;
}

function claimEvent({ eventId, bindingId }) {
  const inserted = db.prepare(`
    INSERT OR IGNORE INTO twofa_notification_events (
      event_id, binding_id, status, attempt_count, updated_at
    ) VALUES (?, ?, 'processing', 0, CURRENT_TIMESTAMP)
  `).run(eventId, bindingId);
  if (inserted.changes === 1) return { duplicate: false, claimed: true };

  const row = db.prepare(`
    SELECT event_id, binding_id, status, updated_at
    FROM twofa_notification_events
    WHERE event_id = ?
  `).get(eventId);
  if (!row) {
    throw createHttpError('EVENT_CLAIM_FAILED', 503, 'Không thể nhận event');
  }
  if (row.status === 'sent') return { duplicate: true, sent: true };
  if (row.status === 'failed') {
    db.prepare(`
      UPDATE twofa_notification_events
      SET binding_id = ?, status = 'processing', updated_at = CURRENT_TIMESTAMP
      WHERE event_id = ?
    `).run(bindingId, eventId);
    return { duplicate: true, claimed: true };
  }

  const reclaimed = db.prepare(`
    UPDATE twofa_notification_events
    SET binding_id = ?, status = 'processing', updated_at = CURRENT_TIMESTAMP
    WHERE event_id = ?
      AND status = 'processing'
      AND updated_at <= datetime('now', ?)
  `).run(bindingId, eventId, `-${STALE_PROCESSING_MINUTES} minutes`);
  if (reclaimed.changes === 1) return { duplicate: true, claimed: true };

  throw createHttpError('EVENT_PROCESSING', 409, 'Event đang được xử lý');
}

function getActiveBinding(bindingId) {
  return db.prepare(`
    SELECT
      b.binding_id,
      b.telegram_user_id,
      b.order_url,
      o.id AS order_id,
      p.name AS product_name
    FROM twofa_order_bindings b
    JOIN orders o ON o.id = b.shop_order_id
    JOIN products p ON p.id = o.product_id
    JOIN users u ON u.telegram_id = o.user_id
    WHERE b.binding_id = ? AND b.status = 'active'
  `).get(bindingId);
}

function markSent(eventId) {
  db.prepare(`
    UPDATE twofa_notification_events
    SET status = 'sent', sent_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE event_id = ?
  `).run(eventId);
}

function markFailed(eventId) {
  db.prepare(`
    UPDATE twofa_notification_events
    SET
      status = 'failed',
      attempt_count = attempt_count + 1,
      last_error = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE event_id = ?
  `).run(SAFE_ERROR, eventId);
}

async function processAccountUpdatedEvent(payload) {
  const event = validatePayload(payload);
  const claim = claimEvent(event);
  if (claim.sent) return { duplicate: true, sent: true };

  try {
    const binding = getActiveBinding(event.bindingId);
    if (!binding) {
      throw createHttpError('BINDING_NOT_ACTIVE', 404, 'Binding không hoạt động');
    }

    const text = messageTemplateService.render('bot.2fa_order_updated', {
      productName: binding.product_name,
      orderCode: String(binding.order_id),
      changedAt: formatVietnamTime(event.changedAt),
      orderUrl: binding.order_url,
    });

    await telegramApiClient.sendMessage(binding.telegram_user_id, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });

    markSent(event.eventId);
    return { duplicate: claim.duplicate, sent: true };
  } catch (err) {
    markFailed(event.eventId);
    if (err && err.status) throw err;
    throw createHttpError('DELIVERY_FAILED', 503, SAFE_ERROR);
  }
}

module.exports = {
  processAccountUpdatedEvent,
  formatVietnamTime,
  SAFE_ERROR,
};
