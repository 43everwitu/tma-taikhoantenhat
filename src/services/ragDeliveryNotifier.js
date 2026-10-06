const config = require('../config');
const { signPayload } = require('./twofaIntegrationAuth');

// A RAG-created order (source ending "_rag") reached the customer via
// RAG-chat-bot, not this service's own bot — so RAG (not us) knows which
// channel/conversation to deliver the confirmation through. This webhook
// replaces this service's own DM for those orders entirely (no dual-send).
// See docs/superpowers/specs/2026-08-19-order-delivery-webhook-design.md
// in the RAG-chat-bot repo for the full design.

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;
const REQUEST_TIMEOUT_MS = 10_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWebhook(payload) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(config.RAG_ORDERS_DELIVERED_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tktn-timestamp': timestamp,
      'x-tktn-signature': signPayload(config.RAG_INTEGRATION_SECRET, timestamp, rawBody),
    },
    body: rawBody,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`RAG /orders/delivered responded ${res.status}`);
}

// order: DB row (id, product_id, product_name, ...). accounts: string[] —
// same shape sendDelivery() already sends as its own DM, joined into one
// plain-text block so RAG never needs to learn this service's internal
// account-object shape.
async function notifyRagDelivery(order, accounts) {
  const payload = {
    orderId: String(order.id),
    productId: order.product_id,
    productName: order.product_name,
    accountsText: Array.isArray(accounts) ? accounts.join('\n\n') : String(accounts || ''),
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await callWebhook(payload);
      return true;
    } catch (err) {
      console.error(`❌ notifyRagDelivery attempt ${attempt}/${MAX_ATTEMPTS} for order ${order.id}:`, err.message);
      if (attempt < MAX_ATTEMPTS) await sleep(RETRY_DELAY_MS);
    }
  }

  const adminNotifyService = require('./adminNotifyService');
  await adminNotifyService.notify(
    'delivered',
    `⚠️ Đơn #${order.id} đã giao nhưng KHÔNG báo được cho khách qua RAG bot (đã thử ${MAX_ATTEMPTS} lần). Vui lòng liên hệ khách thủ công.`,
    { parse_mode: 'HTML' }
  );
  return false;
}

module.exports = { notifyRagDelivery };
