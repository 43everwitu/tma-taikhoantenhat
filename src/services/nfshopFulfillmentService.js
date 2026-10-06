const db = require('../database');
const eventBus = require('./eventBus');
const orderService = require('./orderService');
const nfshopClient = require('./nfshopClient');

const MAX_ATTEMPTS = 5;
const RETRY_INTERVAL_MS = 3 * 60 * 1000;

const inFlight = new Set();
let botRef = null;

// A variant counts as nfshop-fulfilled only when its config is complete.
const NFSHOP_READY_SQL = `v.nfshop_package_id IS NOT NULL
  AND v.nfshop_kind IN ('monthly', 'links')
  AND v.nfshop_valid_days IS NOT NULL`;

function getNfshopVariant(order) {
  if (!order.variant_id) return null;
  return db.prepare(`
    SELECT v.nfshop_package_id, v.nfshop_kind, v.nfshop_valid_days
      FROM product_variants v WHERE v.id = ? AND ${NFSHOP_READY_SQL}
  `).get(order.variant_id) || null;
}

function isNfshopOrder(order) {
  return !!(order && getNfshopVariant(order));
}

function latestMonthlyLedger(userId, packageId) {
  return db.prepare(`
    SELECT nfshop_order_id FROM nfshop_orders
     WHERE user_id = ? AND nfshop_package_id = ? AND kind = 'monthly'
     ORDER BY id DESC LIMIT 1
  `).get(userId, packageId) || null;
}

async function findLiveNfshopOrder(client, nfshopOrderId) {
  try {
    const existing = await client.getOrder(nfshopOrderId);
    return existing && !existing.revoked_at ? existing : null;
  } catch (err) {
    if (err instanceof nfshopClient.NfshopError && err.status === 404) return null;
    throw err;
  }
}

async function callNfshop(client, order, variant) {
  const reference = `tma-${order.id}`;
  const packageId = variant.nfshop_package_id;
  const validDays = variant.nfshop_valid_days;
  if (variant.nfshop_kind === 'links') {
    const created = await client.createOrder({ packageId, validDays, linkQuota: order.quantity, reference });
    return { nfshopOrder: created, action: 'create', durationDays: validDays };
  }
  const days = validDays * order.quantity;
  const prior = latestMonthlyLedger(order.user_id, packageId);
  const live = prior ? await findLiveNfshopOrder(client, prior.nfshop_order_id) : null;
  if (live) {
    await client.extendOrder(live.id, { days, reference });
    return { nfshopOrder: live, action: 'extend', durationDays: days };
  }
  const created = await client.createOrder({ packageId, validDays: days, reference });
  return { nfshopOrder: created, action: 'create', durationDays: days };
}

function fireAndLog(label, fn) {
  Promise.resolve().then(fn).catch((e) => console.error(`nfshop ${label} failed:`, e.message));
}

function recordFailure(order, err, deps) {
  const orderId = order.id;
  const message = String(err && err.message ? err.message : err).slice(0, 200);
  const current = db.prepare('SELECT attempts FROM nfshop_fulfillment_attempts WHERE tma_order_id = ?').get(orderId);
  const attempts = (current ? current.attempts : 0) + 1;
  const terminal = (err && err.kind === 'rejected') || attempts >= MAX_ATTEMPTS;
  db.prepare(`
    INSERT INTO nfshop_fulfillment_attempts (tma_order_id, attempts, last_error, gave_up, alerted_at, updated_at)
    VALUES (?, ?, ?, ?, CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP END, CURRENT_TIMESTAMP)
    ON CONFLICT(tma_order_id) DO UPDATE SET
      attempts = excluded.attempts, last_error = excluded.last_error, gave_up = excluded.gave_up,
      alerted_at = COALESCE(nfshop_fulfillment_attempts.alerted_at, excluded.alerted_at),
      updated_at = CURRENT_TIMESTAMP
  `).run(orderId, attempts, message, terminal ? 1 : 0, terminal ? 1 : 0);
  // Customer hears about the delay once; admins only hear when manual work is needed.
  if (attempts === 1) fireAndLog('notifyWait', () => deps.notifyWait(order));
  if (terminal) {
    fireAndLog('alertAdmin', () => deps.alertAdmin(
      `⚠️ nfshop không giao được đơn #${orderId} sau ${attempts} lần: ${message}. Cần giao thủ công.`,
    ));
    fireAndLog('postAdminCard', () => deps.postAdminCard(order));
  }
  return { failed: true, terminal, attempts };
}

async function defaultNotifyCustomer(order, url, ctx) {
  if (!botRef) return;
  const productService = require('./productService');
  const variantService = require('./variantService');
  const orderChannelService = require('./orderChannelService');
  const { sendDelivery } = require('./notificationService');
  const { richifyText } = require('../utils/messages');
  const telegramApiClient = require('./telegramApiClient');
  const product = productService.getById(order.product_id);
  const variant = order.variant_id ? variantService.getById(db, order.variant_id) : null;
  const usageInstructions = product && product.usage_instructions ? richifyText(product.usage_instructions) : '(không có)';
  if (ctx.action === 'extend') {
    await telegramApiClient.sendMessage(order.user_id, 'Gói Netflix Cookies của Bạn đã được gia hạn. Link đơn hàng giữ nguyên bên dưới.');
  }
  await sendDelivery(botRef, { ...order, product_name: product && product.name }, [url], { usageInstructions });
  await orderChannelService.postOrderCard({ order, product, variant, keys: [url] });
}

async function defaultNotifyWait(order) {
  if (!botRef) return;
  const messageTemplateService = require('./messageTemplateService');
  const telegramApiClient = require('./telegramApiClient');
  const html = messageTemplateService.render('bot.backorder_wait', {
    orderCode: order.id,
    waitMsg: 'Hệ thống đang xử lý và sẽ gửi link ngay khi sẵn sàng.',
  });
  await telegramApiClient.sendMessage(order.user_id, html, { parse_mode: 'HTML' });
}

async function defaultPostAdminCard(order) {
  if (!botRef) return;
  const productService = require('./productService');
  const variantService = require('./variantService');
  const orderChannelService = require('./orderChannelService');
  const product = productService.getById(order.product_id);
  const variant = order.variant_id ? variantService.getById(db, order.variant_id) : null;
  await orderChannelService.postOrderCard({ order, product, variant, keys: null });
}

async function defaultAlertAdmin(text) {
  // 'backorder_paid' is enabled by default; 'no_stock' stays muted until an admin turns it on.
  return require('./adminNotifyService').notify('backorder_paid', text);
}

async function fulfillOrder(orderId, deps = {}) {
  const client = deps.client || nfshopClient.getClient();
  const notifyCustomer = deps.notifyCustomer || defaultNotifyCustomer;
  const full = {
    ...deps,
    alertAdmin: deps.alertAdmin || defaultAlertAdmin,
    notifyWait: deps.notifyWait || defaultNotifyWait,
    postAdminCard: deps.postAdminCard || defaultPostAdminCard,
  };

  if (inFlight.has(orderId)) return { skipped: true, reason: 'in_flight' };
  inFlight.add(orderId);
  try {
    const order = orderService.getById(orderId);
    if (!order || order.status !== 'paid') return { skipped: true, reason: 'not_paid' };
    // Shadow-ban / review orders must be delivered by hand, never automatically.
    if (order.requires_manual_review) return { skipped: true, reason: 'manual_review' };
    const variant = getNfshopVariant(order);
    if (!variant) return { skipped: true, reason: 'not_nfshop' };

    let result;
    try {
      result = await callNfshop(client, order, variant);
    } catch (err) {
      return recordFailure(order, err, full);
    }

    const url = client.orderUrl(result.nfshopOrder.public_id);
    db.transaction(() => {
      db.prepare(`
        INSERT INTO nfshop_orders (tma_order_id, user_id, variant_id, nfshop_package_id, nfshop_order_id, public_id, kind, action)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(orderId, order.user_id, order.variant_id, variant.nfshop_package_id, result.nfshopOrder.id,
        result.nfshopOrder.public_id, variant.nfshop_kind, result.action);
      orderService.deliverWithAccounts(orderId, [url], result.durationDays);
    })();
    eventBus.publish({ type: 'order.delivered', orderId, status: 'delivered' });
    try {
      await notifyCustomer(orderService.getById(orderId), url, { action: result.action });
    } catch (err) {
      console.error(`nfshop notify failed for order ${orderId}:`, err.message);
    }
    return { delivered: true, action: result.action };
  } finally {
    inFlight.delete(orderId);
  }
}

function pendingOrderIds() {
  return db.prepare(`
    SELECT o.id FROM orders o
      JOIN product_variants v ON v.id = o.variant_id AND ${NFSHOP_READY_SQL}
      LEFT JOIN nfshop_fulfillment_attempts a ON a.tma_order_id = o.id
     WHERE o.status = 'paid' AND o.requires_manual_review = 0 AND COALESCE(a.gave_up, 0) = 0
     ORDER BY o.id LIMIT 20
  `).all().map((r) => r.id);
}

async function sweep(deps = {}) {
  for (const id of pendingOrderIds()) {
    try { await fulfillOrder(id, deps); } catch (err) { console.error(`nfshop sweep order ${id}:`, err.message); }
  }
}

function start({ bot, client } = {}) {
  botRef = bot || null;
  const deps = client ? { client } : {};
  const unsubscribe = eventBus.subscribe((event) => {
    if (event.type !== 'order.backorder_paid') return;
    fulfillOrder(event.orderId, deps).catch((err) => console.error(`nfshop fulfil order ${event.orderId}:`, err.message));
  });
  const interval = setInterval(() => {
    sweep(deps).catch((err) => console.error('nfshop sweep failed:', err.message));
  }, RETRY_INTERVAL_MS);
  interval.unref();
  return function stop() {
    unsubscribe();
    clearInterval(interval);
  };
}

module.exports = { fulfillOrder, sweep, start, pendingOrderIds, isNfshopOrder, MAX_ATTEMPTS, RETRY_INTERVAL_MS };
