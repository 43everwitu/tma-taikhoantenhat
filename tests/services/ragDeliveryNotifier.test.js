const assert = require('node:assert');
const test = require('node:test');

function freshRagDeliveryNotifier() {
  for (const mod of ['../../src/services/ragDeliveryNotifier', '../../src/services/adminNotifyService']) {
    delete require.cache[require.resolve(mod)];
  }
  return require('../../src/services/ragDeliveryNotifier');
}

test('notifyRagDelivery calls the webhook once and succeeds without retry', async () => {
  const { notifyRagDelivery } = freshRagDeliveryNotifier();
  let callCount = 0;
  let capturedBody = null;
  const originalFetch = global.fetch;
  global.fetch = async (url, opts) => {
    callCount++;
    capturedBody = JSON.parse(opts.body.toString());
    return { ok: true, status: 200 };
  };

  try {
    const order = { id: 104936, product_id: 14, product_name: 'Netflix' };
    const result = await notifyRagDelivery(order, ['key1', 'key2']);
    assert.strictEqual(result, true);
    assert.strictEqual(callCount, 1);
    assert.strictEqual(capturedBody.orderId, '104936');
    assert.strictEqual(capturedBody.productId, 14);
    assert.strictEqual(capturedBody.accountsText, 'key1\n\nkey2');
  } finally {
    global.fetch = originalFetch;
  }
});

test('notifyRagDelivery retries up to 3 times, then alerts admin and returns false', async () => {
  const { notifyRagDelivery } = freshRagDeliveryNotifier();
  const adminNotifyService = require('../../src/services/adminNotifyService');
  let notifyCalls = 0;
  let fetchCalls = 0;
  const originalNotify = adminNotifyService.notify;
  const originalFetch = global.fetch;

  adminNotifyService.notify = async (eventType, message) => { notifyCalls++; return true; };
  global.fetch = async () => { fetchCalls++; return { ok: false, status: 500 }; };

  try {
    const order = { id: 'PNS_FAIL_TEST', product_id: 1, product_name: 'X' };
    const result = await notifyRagDelivery(order, ['x']);
    assert.strictEqual(result, false);
    assert.strictEqual(fetchCalls, 3, 'should retry up to MAX_ATTEMPTS times');
    assert.strictEqual(notifyCalls, 1, 'should alert admin exactly once after exhausting retries');
  } finally {
    global.fetch = originalFetch;
    adminNotifyService.notify = originalNotify;
  }
});

test('notifyRagDelivery succeeds on the second attempt without alerting admin', async () => {
  const { notifyRagDelivery } = freshRagDeliveryNotifier();
  const adminNotifyService = require('../../src/services/adminNotifyService');
  let notifyCalls = 0;
  let fetchCalls = 0;
  const originalNotify = adminNotifyService.notify;
  const originalFetch = global.fetch;

  adminNotifyService.notify = async () => { notifyCalls++; return true; };
  global.fetch = async () => {
    fetchCalls++;
    if (fetchCalls === 1) return { ok: false, status: 503 };
    return { ok: true, status: 200 };
  };

  try {
    const order = { id: 'PNS_RETRY_OK', product_id: 1, product_name: 'X' };
    const result = await notifyRagDelivery(order, ['x']);
    assert.strictEqual(result, true);
    assert.strictEqual(fetchCalls, 2);
    assert.strictEqual(notifyCalls, 0);
  } finally {
    global.fetch = originalFetch;
    adminNotifyService.notify = originalNotify;
  }
});
