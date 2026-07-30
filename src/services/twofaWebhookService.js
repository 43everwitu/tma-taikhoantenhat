const crypto = require('node:crypto');
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

function createClaimToken() {
  return crypto.randomUUID();
}

function claimEvent({ eventId, bindingId }) {
  const claimToken = createClaimToken();
  const inserted = db.prepare(`
    INSERT OR IGNORE INTO twofa_notification_events (
      event_id, binding_id, status, attempt_count, claim_token, updated_at
    ) VALUES (?, ?, 'processing', 0, ?, CURRENT_TIMESTAMP)
  `).run(eventId, bindingId, claimToken);
  if (inserted.changes === 1) return { duplicate: false, claimed: true, claimToken };

  const row = db.prepare(`
    SELECT event_id, binding_id, status, updated_at
    FROM twofa_notification_events
    WHERE event_id = ?
  `).get(eventId);
  if (!row) {
    throw createHttpError('EVENT_CLAIM_FAILED', 503, 'Không thể nhận event');
  }
  if (row.status === 'sent') return { duplicate: true, sent: true };
  if (row.status === 'delivery_uncertain') {
    return { duplicate: true, sent: false, uncertain: true };
  }
  if (row.status === 'failed') {
    const retried = db.prepare(`
      UPDATE twofa_notification_events
      SET binding_id = ?, status = 'processing', claim_token = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE event_id = ? AND status = 'failed'
    `).run(bindingId, claimToken, eventId);
    if (retried.changes === 1) return { duplicate: true, claimed: true, claimToken };
    throw createHttpError('EVENT_PROCESSING', 409, 'Event đang được xử lý');
  }

  const uncertain = db.prepare(`
    UPDATE twofa_notification_events
    SET status = 'delivery_uncertain', last_error = ?, claim_token = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE event_id = ?
      AND status IN ('processing', 'delivery_reserved')
      AND updated_at <= datetime('now', ?)
  `).run(SAFE_ERROR, eventId, `-${STALE_PROCESSING_MINUTES} minutes`);
  if (uncertain.changes === 1) return { duplicate: true, sent: false, uncertain: true };

  throw createHttpError('EVENT_PROCESSING', 409, 'Event đang được xử lý');
}

function getEvent(eventId) {
  return db.prepare(`
    SELECT status FROM twofa_notification_events WHERE event_id = ?
  `).get(eventId);
}

function getActiveBinding(bindingId) {
  return db.prepare(`
    SELECT
      b.binding_id,
      o.user_id AS telegram_user_id,
      b.order_url,
      o.id AS order_id,
      p.name AS product_name
    FROM twofa_order_bindings b
    JOIN orders o ON o.id = b.shop_order_id
    JOIN products p ON p.id = o.product_id
    JOIN users u ON u.telegram_id = o.user_id
    WHERE b.binding_id = ? AND b.status = 'active' AND b.telegram_user_id = o.user_id
  `).get(bindingId);
}

function reserveDelivery(eventId, claimToken) {
  const result = db.prepare(`
    UPDATE twofa_notification_events
    SET status = 'delivery_reserved', updated_at = CURRENT_TIMESTAMP
    WHERE event_id = ? AND status = 'processing' AND claim_token = ?
  `).run(eventId, claimToken);
  return result.changes === 1;
}

function markSent(eventId, claimToken) {
  const result = db.prepare(`
    UPDATE twofa_notification_events
    SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE event_id = ? AND status = 'delivery_reserved' AND claim_token = ?
  `).run(eventId, claimToken);
  return result.changes === 1;
}

function markFailed(eventId, claimToken, expectedStatus) {
  const result = db.prepare(`
    UPDATE twofa_notification_events
    SET
      status = 'failed',
      attempt_count = attempt_count + 1,
      last_error = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE event_id = ? AND status = ? AND claim_token = ?
  `).run(SAFE_ERROR, eventId, expectedStatus, claimToken);
  return result.changes === 1;
}

function markUncertain(eventId, claimToken) {
  const result = db.prepare(`
    UPDATE twofa_notification_events
    SET status = 'delivery_uncertain', last_error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE event_id = ? AND status = 'delivery_reserved' AND claim_token = ?
  `).run(SAFE_ERROR, eventId, claimToken);
  return result.changes === 1;
}

function uncertainResult(duplicate) {
  return { duplicate: Boolean(duplicate), sent: false, uncertain: true };
}

function resultBeforeDeliveryClaimLoss(eventId, duplicate = true) {
  const current = getEvent(eventId);
  if (current?.status === 'sent') return { duplicate: true, sent: true };
  if (['delivery_reserved', 'delivery_uncertain'].includes(current?.status)) {
    return uncertainResult(duplicate);
  }
  throw createHttpError('EVENT_CLAIM_LOST', 409, 'Event đã được worker khác xử lý');
}

function settleUncertain(eventId, claimToken, duplicate) {
  try {
    markUncertain(eventId, claimToken);
  } catch {
    // Không trả lỗi retryable khi Telegram có thể đã nhận message.
  }
  try {
    if (getEvent(eventId)?.status === 'sent') {
      return { duplicate: true, sent: true };
    }
  } catch {
    // DB không đọc được cũng là kết quả delivery không chắc chắn.
  }
  return uncertainResult(duplicate);
}

async function processAccountUpdatedEvent(payload) {
  const event = validatePayload(payload);
  const claim = claimEvent(event);
  if (claim.sent) return { duplicate: true, sent: true };
  if (claim.uncertain) return uncertainResult(true);

  let binding;
  let text;
  try {
    binding = getActiveBinding(event.bindingId);
    if (!binding) {
      throw createHttpError('BINDING_NOT_ACTIVE', 404, 'Binding không hoạt động');
    }

    text = messageTemplateService.render('bot.2fa_order_updated', {
      productName: binding.product_name,
      orderCode: String(binding.order_id),
      changedAt: formatVietnamTime(event.changedAt),
      orderUrl: binding.order_url,
    });
  } catch (err) {
    try {
      if (!markFailed(event.eventId, claim.claimToken, 'processing')) {
        return resultBeforeDeliveryClaimLoss(event.eventId, claim.duplicate);
      }
    } catch {
      if (err?.status) throw err;
      throw createHttpError('DELIVERY_FAILED', 503, SAFE_ERROR);
    }
    if (err?.status) throw err;
    throw createHttpError('DELIVERY_FAILED', 503, SAFE_ERROR);
  }

  try {
    if (!reserveDelivery(event.eventId, claim.claimToken)) {
      return resultBeforeDeliveryClaimLoss(event.eventId, claim.duplicate);
    }
  } catch {
    return uncertainResult(claim.duplicate);
  }

  try {
    await telegramApiClient.sendMessage(binding.telegram_user_id, text, {
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
  } catch (err) {
    if (err?.isTelegramApiError === true) {
      try {
        if (markFailed(event.eventId, claim.claimToken, 'delivery_reserved')) {
          throw createHttpError('DELIVERY_FAILED', 503, SAFE_ERROR);
        }
      } catch (markError) {
        if (markError?.code === 'DELIVERY_FAILED') throw markError;
        return settleUncertain(event.eventId, claim.claimToken, claim.duplicate);
      }
    }
    return settleUncertain(event.eventId, claim.claimToken, claim.duplicate);
  }

  try {
    if (markSent(event.eventId, claim.claimToken)) {
      return { duplicate: claim.duplicate, sent: true };
    }
  } catch {
    return settleUncertain(event.eventId, claim.claimToken, claim.duplicate);
  }
  return settleUncertain(event.eventId, claim.claimToken, claim.duplicate);
}

module.exports = {
  processAccountUpdatedEvent,
  formatVietnamTime,
  SAFE_ERROR,
};
