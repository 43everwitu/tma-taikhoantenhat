const crypto = require('node:crypto');
const db = require('../database');
const config = require('../config');
const { signPayload } = require('./twofaIntegrationAuth');
const {
  extractTwofaOrderLinks,
  parseDeliveredKeys,
} = require('./twofaOrderLinkParser');

function maskTelegramRecipient({ username, telegramId }) {
  const normalizedUsername = String(username || '').replace(/^@/, '').trim();
  if (normalizedUsername.length >= 7) {
    return `@${normalizedUsername.slice(0, 4)}***${normalizedUsername.slice(-2)}`;
  }
  return `Telegram ID ••••${String(telegramId ?? '').replace(/\D/g, '').slice(-4)}`;
}

function redactIntegrationError() {
  return 'Lỗi đồng bộ 2FA';
}

function createBindingId(orderId, uurl) {
  const digest = crypto.createHash('sha256').update(`${orderId}:${uurl}`).digest('hex');
  return `tma-${orderId}-${digest.slice(0, 24)}`;
}

function getDeliveredOrder(orderId) {
  return db.prepare(`
    SELECT o.id, o.user_id, o.delivered_keys_json, u.username
    FROM orders o JOIN users u ON u.telegram_id = o.user_id
    WHERE o.id = ? AND o.status = 'delivered'
  `).get(orderId);
}

function getBindingsForOrder(orderId, statuses) {
  const placeholders = statuses.map(() => '?').join(', ');
  return db.prepare(`
    SELECT * FROM twofa_order_bindings
    WHERE shop_order_id = ? AND status IN (${placeholders})
    ORDER BY id
  `).all(orderId, ...statuses);
}

function getBindingsForUurls(uurls, statuses) {
  if (uurls.size === 0) return [];
  const uurlPlaceholders = Array.from(uurls, () => '?').join(', ');
  const statusPlaceholders = statuses.map(() => '?').join(', ');
  return db.prepare(`
    SELECT * FROM twofa_order_bindings
    WHERE uurl IN (${uurlPlaceholders}) AND status IN (${statusPlaceholders})
    ORDER BY id
  `).all(...uurls, ...statuses);
}

function upsertCandidates(order, links) {
  const existing = db.prepare(`
    SELECT uurl FROM twofa_order_bindings WHERE shop_order_id = ?
  `).all(order.id);
  const affectedUurls = new Set(existing.map(row => row.uurl));
  const recipientLabel = maskTelegramRecipient({ username: order.username, telegramId: order.user_id });
  const upsert = db.prepare(`
    INSERT INTO twofa_order_bindings (
      binding_id, shop_order_id, telegram_user_id, uurl, order_host, order_url, recipient_label
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_order_id, uurl) DO UPDATE SET
      order_host = excluded.order_host,
      order_url = excluded.order_url,
      recipient_label = excluded.recipient_label,
      status = CASE
        WHEN twofa_order_bindings.status IN ('inactive', 'sync_failed') THEN 'pending'
        ELSE twofa_order_bindings.status
      END,
      last_error = CASE
        WHEN twofa_order_bindings.status IN ('inactive', 'sync_failed') THEN NULL
        ELSE twofa_order_bindings.last_error
      END,
      updated_at = CURRENT_TIMESTAMP
  `);
  const existingUurls = new Set(existing.map(row => row.uurl));

  for (const link of links) {
    affectedUurls.add(link.uurl);
    upsert.run(
      createBindingId(order.id, link.uurl),
      order.id,
      order.user_id,
      link.uurl,
      link.host,
      link.orderUrl,
      recipientLabel,
    );
  }

  const uurls = links.map(link => link.uurl);
  if (uurls.length === 0) {
    db.prepare(`
      UPDATE twofa_order_bindings
      SET status = 'inactive', last_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE shop_order_id = ? AND status != 'inactive'
    `).run(order.id);
  } else {
    const placeholders = uurls.map(() => '?').join(', ');
    db.prepare(`
      UPDATE twofa_order_bindings
      SET status = 'inactive', last_error = NULL, updated_at = CURRENT_TIMESTAMP
      WHERE shop_order_id = ? AND uurl NOT IN (${placeholders}) AND status != 'inactive'
    `).run(order.id, ...uurls);
  }

  return {
    created: links.filter(link => !existingUurls.has(link.uurl)).length,
    affectedUurls,
  };
}

function reconcileConflictStates(uurls) {
  for (const uurl of uurls) {
    const bindings = db.prepare(`
      SELECT shop_order_id FROM twofa_order_bindings
      WHERE uurl = ? AND status != 'inactive'
    `).all(uurl);
    const hasConflict = new Set(bindings.map(binding => binding.shop_order_id)).size > 1;
    if (hasConflict) {
      db.prepare(`
        UPDATE twofa_order_bindings
        SET status = 'conflict', last_error = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE uurl = ? AND status != 'inactive'
      `).run(uurl);
    } else {
      db.prepare(`
        UPDATE twofa_order_bindings
        SET status = 'pending', last_error = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE uurl = ? AND status = 'conflict'
      `).run(uurl);
    }
  }
}

async function sendSignedRequest(method, pathname, rawBody = Buffer.alloc(0)) {
  if (!config.TWOFA_INTERNAL_URL || !config.TWOFA_TMA_SHARED_SECRET) {
    throw new Error('Thiếu cấu hình đồng bộ 2FA');
  }
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(new URL(pathname, config.TWOFA_INTERNAL_URL).toString(), {
    method,
    headers: {
      'content-type': 'application/json',
      'X-TKTN-Timestamp': timestamp,
      'X-TKTN-Signature': signPayload(config.TWOFA_TMA_SHARED_SECRET, timestamp, body),
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  let envelope;
  try {
    envelope = await response.json();
  } catch {
    throw new Error('2FA trả về JSON không hợp lệ');
  }
  const status = envelope?.data?.status;
  if (typeof envelope?.success !== 'boolean' || !['active', 'conflict', 'inactive', 'not_found', 'invalid'].includes(status)) {
    throw new Error('2FA trả về trạng thái không hợp lệ');
  }
  return status;
}

async function registerBinding(binding) {
  const rawBody = Buffer.from(JSON.stringify({
    bindingId: binding.binding_id,
    uurl: binding.uurl,
    recipientLabel: binding.recipient_label,
  }));
  return sendSignedRequest('POST', '/api/internal/tma/twofa-bindings', rawBody);
}

async function deactivateBinding(binding) {
  return sendSignedRequest(
    'DELETE',
    `/api/internal/tma/twofa-bindings/${encodeURIComponent(binding.binding_id)}`,
  );
}

function markActiveIfDesired(bindingId) {
  const result = db.prepare(`
    UPDATE twofa_order_bindings
    SET status = 'active', last_error = NULL, synced_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE binding_id = ? AND status IN ('pending', 'sync_failed')
  `).run(bindingId);
  return result.changes === 1;
}

function markRemoteActive(bindingId) {
  db.prepare(`
    UPDATE twofa_order_bindings
    SET synced_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE binding_id = ?
  `).run(bindingId);
}

function getBindingStatus(bindingId) {
  return db.prepare(`
    SELECT status FROM twofa_order_bindings WHERE binding_id = ?
  `).get(bindingId)?.status;
}

function markConflict(bindingId) {
  db.prepare(`
    UPDATE twofa_order_bindings
    SET status = 'conflict', last_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE binding_id = ?
  `).run(bindingId);
}

function markRegisterFailure(bindingId) {
  db.prepare(`
    UPDATE twofa_order_bindings
    SET status = 'sync_failed', last_error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE binding_id = ?
  `).run(redactIntegrationError(), bindingId);
}

function markDeactivateFailure(bindingId) {
  db.prepare(`
    UPDATE twofa_order_bindings
    SET last_error = ?, updated_at = CURRENT_TIMESTAMP
    WHERE binding_id = ?
  `).run(redactIntegrationError(), bindingId);
}

function clearRemoteMarker(bindingId) {
  db.prepare(`
    UPDATE twofa_order_bindings
    SET synced_at = NULL, last_error = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE binding_id = ?
  `).run(bindingId);
}

async function deactivateRemoteBinding(binding) {
  try {
    const status = await deactivateBinding(binding);
    if (status === 'invalid') throw new Error('2FA từ chối deactivate binding');
    clearRemoteMarker(binding.binding_id);
    return { active: 0, failed: 0 };
  } catch {
    markDeactivateFailure(binding.binding_id);
    return { active: 0, failed: 1 };
  }
}

async function syncBinding(binding) {
  if (['inactive', 'conflict'].includes(binding.status) && binding.synced_at) {
    return deactivateRemoteBinding(binding);
  }

  if (!['pending', 'sync_failed'].includes(binding.status)) return { active: 0, failed: 0 };
  try {
    const status = await registerBinding(binding);
    if (status === 'active') {
      if (markActiveIfDesired(binding.binding_id)) {
        return { active: 1, failed: 0 };
      }
      if (getBindingStatus(binding.binding_id) === 'active') {
        return { active: 0, failed: 0 };
      }
      markRemoteActive(binding.binding_id);
      return deactivateRemoteBinding(binding);
    }
    if (status === 'conflict') {
      markConflict(binding.binding_id);
      return { active: 0, failed: 0, conflicts: 1 };
    }
    markRegisterFailure(binding.binding_id);
    return { active: 0, failed: 1 };
  } catch {
    markRegisterFailure(binding.binding_id);
    return { active: 0, failed: 1 };
  }
}

async function reconcileDeliveredOrder(orderId, options = {}) {
  const result = { created: 0, active: 0, conflicts: 0, failed: 0 };
  const order = getDeliveredOrder(orderId);
  if (!order) return result;

  const links = extractTwofaOrderLinks(parseDeliveredKeys(order.delivered_keys_json));
  const { created, affectedUurls } = db.transaction(() => {
    const upserted = upsertCandidates(order, links);
    reconcileConflictStates(upserted.affectedUurls);
    return upserted;
  })();
  result.created = created;
  result.conflicts = db.prepare(`
    SELECT COUNT(*) AS count FROM twofa_order_bindings
    WHERE shop_order_id = ? AND status = 'conflict'
  `).get(order.id).count;
  if (options.register === false) return result;

  const deactivate = getBindingsForUurls(affectedUurls, ['inactive', 'conflict'])
    .filter(binding => binding.synced_at);
  for (const binding of deactivate) {
    const synced = await syncBinding(binding);
    result.failed += synced.failed;
  }
  const register = getBindingsForOrder(order.id, ['pending', 'sync_failed']);
  for (const binding of register) {
    const synced = await syncBinding(binding);
    result.active += synced.active;
    result.failed += synced.failed;
    result.conflicts += synced.conflicts || 0;
  }
  return result;
}

let reconcileForTest;

function setReconcileForTest(fn) {
  reconcileForTest = fn;
}

function scheduleTwofaBindingSync(orderId) {
  Promise.resolve()
    .then(() => (
      reconcileForTest
        ? reconcileForTest(orderId)
        : reconcileDeliveredOrder(orderId)
    ))
    .catch((error) => {
      console.error('[twofa-binding] sync failed', {
        orderId: Number(orderId),
        error: redactIntegrationError(error),
      });
    });
}

async function retryPendingBindings(limit = 50) {
  const cappedLimit = Math.min(50, Math.max(1, Number(limit) || 50));
  const bindings = db.prepare(`
    SELECT * FROM twofa_order_bindings
    WHERE status IN ('pending', 'sync_failed')
       OR (status IN ('inactive', 'conflict') AND synced_at IS NOT NULL)
    ORDER BY id
    LIMIT ?
  `).all(cappedLimit);
  const result = { attempted: 0, active: 0, failed: 0 };

  for (const binding of bindings) {
    result.attempted += 1;
    try {
      const synced = reconcileForTest
        ? await reconcileForTest(binding.shop_order_id)
        : await syncBinding(binding);
      result.active += synced.active || 0;
      result.failed += synced.failed || 0;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

function startRetryWorker({ intervalMs } = {}) {
  if (!config.TWOFA_INTERNAL_URL || !config.TWOFA_TMA_SHARED_SECRET) return () => {};
  let stopped = false;
  let inFlight = false;
  const runTick = () => {
    if (stopped || inFlight) return;
    inFlight = true;
    Promise.resolve()
      .then(() => retryPendingBindings())
      .catch(() => {})
      .finally(() => {
        inFlight = false;
      });
  };
  const timer = setInterval(runTick, intervalMs || config.TWOFA_SYNC_INTERVAL_MS);
  timer.unref?.();
  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
}

module.exports = {
  extractTwofaOrderLinks,
  maskTelegramRecipient,
  reconcileDeliveredOrder,
  retryPendingBindings,
  startRetryWorker,
  setReconcileForTest,
  scheduleTwofaBindingSync,
  redactIntegrationError,
};
