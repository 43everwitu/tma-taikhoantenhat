const assert = require('node:assert');
const test = require('node:test');
const { PaymentPoller } = require('../../src/services/paymentPoller');
const telegramApiClient = require('../../src/services/telegramApiClient');

// Minimal stub matching the pattern used in paymentPollerLifecycle.test.js —
// the constructor only needs .prepare() to return get/all/run stubs.
function makeDb() {
  return {
    prepare() {
      return { get: () => undefined, all: () => [], run: () => ({ changes: 0 }) };
    },
  };
}

// notificationService.sendDelivery calls telegramApiClient.sendMessage
// directly — it does NOT go through the `bot` instance passed into
// PaymentPoller for this path. The repo's own designed test seam for this
// is setTelegramRequestForTest(); a fake `bot` object alone is NOT enough
// to stop a real send here (confirmed the hard way — see incident note
// below). CLAUDE.md forbids any test triggering a real Telegram send.
function withFakeTelegramRequest(fn) {
  return async () => {
    const calls = [];
    telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
      calls.push({ method, payload });
      return { message_id: 1 };
    });
    try {
      await fn(calls);
    } finally {
      telegramApiClient.setTelegramRequestForTest(null);
    }
  };
}

test(
  '_notifyCustomerDelivered routes telegram_rag orders to notifyRagDelivery, not any Telegram send',
  withFakeTelegramRequest(async (calls) => {
    const poller = new PaymentPoller(makeDb(), {});
    const ragModule = require('../../src/services/ragDeliveryNotifier');
    let notifyRagDeliveryCalled = null;
    const original = ragModule.notifyRagDelivery;
    ragModule.notifyRagDelivery = async (order, accounts) => { notifyRagDeliveryCalled = { order, accounts }; return true; };

    try {
      const order = { id: 999, product_id: 1, product_name: 'Test', source: 'telegram_rag' };
      await poller._notifyCustomerDelivered(order, ['key1']);
    } finally {
      ragModule.notifyRagDelivery = original;
    }

    assert.ok(notifyRagDeliveryCalled, 'notifyRagDelivery should have been called');
    assert.strictEqual(notifyRagDeliveryCalled.order.id, 999);
    assert.deepStrictEqual(notifyRagDeliveryCalled.accounts, ['key1']);
    assert.strictEqual(calls.length, 0, 'a telegram_rag order must never reach a real/fake Telegram API call');
  })
);

test(
  '_notifyCustomerDelivered still uses the bot DM (telegramApiClient) for non-RAG orders',
  withFakeTelegramRequest(async (calls) => {
    const poller = new PaymentPoller(makeDb(), {});
    const ragModule = require('../../src/services/ragDeliveryNotifier');
    let notifyRagDeliveryCalled = false;
    const original = ragModule.notifyRagDelivery;
    ragModule.notifyRagDelivery = async () => { notifyRagDeliveryCalled = true; };

    try {
      const order = { id: 1000, product_id: 1, product_name: 'Test', user_id: 1016209784, quantity: 1, source: 'telegram' };
      await poller._notifyCustomerDelivered(order, ['short-key']);
    } finally {
      ragModule.notifyRagDelivery = original;
    }

    assert.strictEqual(notifyRagDeliveryCalled, false, 'a regular order must not go through the RAG webhook path');
    assert.strictEqual(calls.length, 1, 'the bot DM path should have gone through the intercepted (fake) Telegram request');
    assert.strictEqual(calls[0].method, 'sendMessage');
    assert.strictEqual(calls[0].payload.chat_id, 1016209784);
  })
);
