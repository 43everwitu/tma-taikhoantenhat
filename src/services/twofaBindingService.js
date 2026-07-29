const crypto = require('node:crypto');
const db = require('../database');
const config = require('../config');
const { signPayload } = require('./twofaIntegrationAuth');

const ALLOWED_ORDER_HOSTS = new Set([
  'order.taikhoantenhat.com',
  'order.godstudy.me',
]);

function extractTwofaOrderLinks(values) {
  const links = [];
  const seenUurls = new Set();

  for (const value of values || []) {
    if (typeof value !== 'string') continue;

    for (const match of value.matchAll(/https:\/\/[^\s<>"']+/g)) {
      let parsed;
      try {
        parsed = new URL(match[0]);
      } catch {
        continue;
      }

      if (parsed.protocol !== 'https:' || parsed.port || !ALLOWED_ORDER_HOSTS.has(parsed.hostname)) {
        continue;
      }
      if (!/^\/[^/]+$/.test(parsed.pathname)) continue;

      let uurl;
      try {
        uurl = decodeURIComponent(parsed.pathname.slice(1));
      } catch {
        continue;
      }
      if (uurl.includes('/')) continue;
      if (!uurl || seenUurls.has(uurl)) continue;

      seenUurls.add(uurl);
      links.push({
        uurl,
        host: parsed.hostname,
        orderUrl: `${parsed.origin}${parsed.pathname}`,
      });
    }
  }

  return links;
}

function maskTelegramRecipient({ username, telegramId }) {
  const normalizedUsername = String(username || '').replace(/^@/, '').trim();
  if (normalizedUsername) {
    const prefix = normalizedUsername.slice(0, 4);
    const suffix = normalizedUsername.length > 4 ? normalizedUsername.slice(-2) : '';
    return `@${prefix}***${suffix}`;
  }

  const suffix = String(telegramId ?? '').replace(/\D/g, '').slice(-4);
  return `Telegram ID ••••${suffix}`;
}

function redactIntegrationError(error) {
  const message = error instanceof Error ? error.message : String(error || 'Lỗi tích hợp không xác định');
  return message
    .replace(/https?:\/\/[^\s]+/gi, '[URL đã ẩn]')
    .replace(/\b(authorization|bearer|token|secret|signature)\b(?:\s*[:=]\s*|\s+)\S+/gi, '$1=[đã ẩn]')
    .slice(0, 500);
}

function createBindingId(orderId, uurl) {
  const digest = crypto.createHash('sha256').update(`${orderId}:${uurl}`).digest('hex');
  return `tma-${orderId}-${digest.slice(0, 24)}`;
}

function getDeliveredOrder(orderId) {
  return db.prepare(`
    SELECT o.id, o.user_id, o.delivered_keys_json, u.username
    FROM orders o
    JOIN users u ON u.telegram_id = o.user_id
    WHERE o.id = ? AND o.status = 'delivered'
  `).get(orderId);
}

function parseDeliveredKeys(deliveredKeysJson) {
  try {
    const values = JSON.parse(deliveredKeysJson || '[]');
    return Array.isArray(values) ? values.filter(value => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function upsertCandidates(order, links) {
  const existing = db.prepare(`
    SELECT uurl FROM twofa_order_bindings WHERE shop_order_id = ?
  `).all(order.id);
  const existingUurls = new Set(existing.map(row => row.uurl));
  const recipientLabel = maskTelegramRecipient({
    username: order.username,
    telegramId: order.user_id,
  });
  const upsert = db.prepare(`
    INSERT INTO twofa_order_bindings (
      binding_id, shop_order_id, telegram_user_id, uurl, order_host, order_url, recipient_label
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(shop_order_id, uurl) DO UPDATE SET
      order_host = excluded.order_host,
      order_url = excluded.order_url,
      recipient_label = excluded.recipient_label,
      status = CASE
        WHEN twofa_order_bindings.status IN ('inactive', 'conflict', 'sync_failed') THEN 'pending'
        ELSE twofa_order_bindings.status
      END,
      last_error = CASE
        WHEN twofa_order_bindings.status IN ('inactive', 'conflict', 'sync_failed') THEN NULL
        ELSE twofa_order_bindings.last_error
      END,
      updated_at = CURRENT_TIMESTAMP
  `);

  for (const link of links) {
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

  const currentUurls = new Set(links.map(link => link.uurl));
  const activeToDeactivate = db.prepare(`
    SELECT * FROM twofa_order_bindings
    WHERE shop_order_id = ? AND status = 'active'
  `).all(order.id).filter(row => !currentUurls.has(row.uurl));
  const markInactive = db.prepare(`
    UPDATE twofa_order_bindings
    SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
    WHERE shop_order_id = ? AND status != 'inactive'
  `);
  if (currentUurls.size === 0) {
    markInactive.run(order.id);
  } else {
    const placeholders = Array.from(currentUurls, () => '?').join(', ');
    db.prepare(`
      UPDATE twofa_order_bindings
      SET status = 'inactive', updated_at = CURRENT_TIMESTAMP
      WHERE shop_order_id = ? AND uurl NOT IN (${placeholders}) AND status != 'inactive'
    `).run(order.id, ...currentUurls);
  }

  return {
    created: links.filter(link => !existingUurls.has(link.uurl)).length,
    activeToDeactivate,
  };
}

function markConflicts(uurls) {
  const conflicts = [];
  for (const uurl of uurls) {
    const bindings = db.prepare(`
      SELECT * FROM twofa_order_bindings
      WHERE uurl = ? AND status != 'inactive'
      ORDER BY id
    `).all(uurl);
    if (new Set(bindings.map(binding => binding.shop_order_id)).size < 2) continue;

    const active = bindings.filter(binding => binding.status === 'active');
    db.prepare(`
      UPDATE twofa_order_bindings
      SET status = 'conflict', updated_at = CURRENT_TIMESTAMP
      WHERE uurl = ? AND status != 'inactive'
    `).run(uurl);
    conflicts.push(...active);
  }
  return conflicts;
}

async function sendSignedRequest(method, pathname, payload) {
  if (!config.TWOFA_INTERNAL_URL || !config.TWOFA_TMA_SHARED_SECRET) {
    throw new Error('Thiếu cấu hình đồng bộ 2FA');
  }

  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetch(new URL(pathname, config.TWOFA_INTERNAL_URL).toString(), {
    method,
    headers: {
      'content-type': 'application/json',
      'x-tma-timestamp': timestamp,
      'x-tma-signature': signPayload(config.TWOFA_TMA_SHARED_SECRET, timestamp, rawBody),
    },
    body: rawBody,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`2FA trả về HTTP ${response.status}`);

  let payloadResponse;
  try {
    payloadResponse = await response.json();
  } catch {
    throw new Error('2FA trả về JSON không hợp lệ');
  }
  if (!['active', 'conflict', 'not_found', 'invalid'].includes(payloadResponse?.status)) {
    throw new Error('2FA trả về trạng thái không hợp lệ');
  }
  return payloadResponse.status;
}

async function deactivateBinding(binding) {
  return sendSignedRequest('DELETE', '/api/internal/tma/twofa-bindings', {
    bindingId: binding.binding_id,
  });
}

async function registerBinding(binding) {
  return sendSignedRequest('POST', '/api/internal/tma/twofa-bindings', {
    bindingId: binding.binding_id,
    shopOrderId: binding.shop_order_id,
    telegramUserId: binding.telegram_user_id,
    uurl: binding.uurl,
    orderUrl: binding.order_url,
    recipientLabel: binding.recipient_label,
  });
}

function setBindingStatus(bindingId, status, error = null) {
  db.prepare(`
    UPDATE twofa_order_bindings
    SET status = ?, last_error = ?, synced_at = CASE WHEN ? = 'active' THEN CURRENT_TIMESTAMP ELSE synced_at END,
      updated_at = CURRENT_TIMESTAMP
    WHERE binding_id = ?
  `).run(status, error, status, bindingId);
}

async function reconcileDeliveredOrder(orderId, options = {}) {
  const result = { created: 0, active: 0, conflicts: 0, failed: 0 };
  const order = getDeliveredOrder(orderId);
  if (!order) return result;

  const links = extractTwofaOrderLinks(parseDeliveredKeys(order.delivered_keys_json));
  const { created, activeToDeactivate } = db.transaction(() => {
    const upserted = upsertCandidates(order, links);
    const conflicts = markConflicts(links.map(link => link.uurl));
    return { created: upserted.created, activeToDeactivate: [...upserted.activeToDeactivate, ...conflicts] };
  })();
  result.created = created;

  if (options.register === false) {
    result.conflicts = db.prepare(`
      SELECT COUNT(*) AS count FROM twofa_order_bindings
      WHERE shop_order_id = ? AND status = 'conflict'
    `).get(order.id).count;
    return result;
  }

  for (const binding of activeToDeactivate) {
    try {
      await deactivateBinding(binding);
    } catch (error) {
      result.failed += 1;
    }
  }

  const bindings = db.prepare(`
    SELECT * FROM twofa_order_bindings
    WHERE shop_order_id = ? AND status = 'pending'
    ORDER BY id
  `).all(order.id);
  for (const binding of bindings) {
    try {
      const status = await registerBinding(binding);
      if (status === 'active') {
        setBindingStatus(binding.binding_id, 'active');
        result.active += 1;
      } else if (status === 'conflict') {
        setBindingStatus(binding.binding_id, 'conflict');
        result.conflicts += 1;
      } else {
        const error = `2FA trả về trạng thái ${status}`;
        setBindingStatus(binding.binding_id, 'sync_failed', error);
        result.failed += 1;
      }
    } catch (error) {
      setBindingStatus(binding.binding_id, 'sync_failed', redactIntegrationError(error));
      result.failed += 1;
    }
  }

  return result;
}

let reconcileForTest;

function setReconcileForTest(fn) {
  reconcileForTest = fn;
}

async function retryPendingBindings(limit = 50) {
  const rows = db.prepare(`
    SELECT DISTINCT shop_order_id
    FROM twofa_order_bindings
    WHERE status IN ('pending', 'sync_failed')
    ORDER BY id
    LIMIT ?
  `).all(Math.max(1, Number(limit) || 50));
  const result = { attempted: 0, active: 0, failed: 0 };
  const reconcile = reconcileForTest || reconcileDeliveredOrder;

  for (const row of rows) {
    result.attempted += 1;
    try {
      const reconciled = await reconcile(row.shop_order_id);
      result.active += reconciled.active || 0;
      result.failed += reconciled.failed || 0;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

function startRetryWorker({ intervalMs } = {}) {
  const timer = setInterval(() => {
    retryPendingBindings().catch(() => {});
  }, intervalMs || config.TWOFA_SYNC_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  extractTwofaOrderLinks,
  maskTelegramRecipient,
  reconcileDeliveredOrder,
  retryPendingBindings,
  startRetryWorker,
  setReconcileForTest,
  redactIntegrationError,
};
