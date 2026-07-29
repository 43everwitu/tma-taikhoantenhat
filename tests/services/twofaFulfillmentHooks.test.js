const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');

const db = require('../../src/database');
const telegramApiClient = require('../../src/services/telegramApiClient');
const twofaBindingService = require('../../src/services/twofaBindingService');
const { deliverOrder } = require('../../src/services/orderFulfillmentService');

function flushPromises() {
  return new Promise(resolve => setImmediate(resolve));
}

async function requestJson(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = new Readable({
      read() {
        if (payload) this.push(payload);
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    req.headers = {};
    req.socket = new PassThrough();
    req.socket.remoteAddress = '127.0.0.1';
    if (payload) {
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = String(payload.length);
    }

    const chunks = [];
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
    res.getHeader = key => res.headers[key.toLowerCase()];
    res.removeHeader = key => { delete res.headers[key.toLowerCase()]; };
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      for (const [key, value] of Object.entries(headers || {})) res.setHeader(key, value);
      return res;
    };
    const end = res.end.bind(res);
    res.end = (chunk, encoding, callback) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
      }
      end(callback);
      try {
        resolve({
          status: res.statusCode,
          json: JSON.parse(Buffer.concat(chunks).toString() || '{}'),
        });
      } catch (error) {
        reject(error);
      }
    };
    app.handle(req, res, reject);
  });
}

function makeAdminApp() {
  const app = express();
  app.use(express.json());
  app.set('bot', {
    botInfo: { username: 'test_bot' },
    telegram: {
      sendDocument: async () => ({ message_id: 1 }),
      sendMessage: async () => ({ message_id: 1 }),
    },
  });
  app.use((req, _res, next) => {
    req.admin = { adminId: 1, role: 'super_admin', username: 'admin' };
    next();
  });
  app.use('/admin/orders', require('../../src/api/routes/admin/orders'));
  app.use((error, _req, res, _next) => {
    res.status(500).json({ success: false, error: { code: 'TEST_ERROR', message: error.message } });
  });
  return app;
}

function seedOrder({ withStock = false } = {}) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const stockData = `https://order.subhub.vn/auto-${suffix}`;
  const userId = 8_610_000_000 + Math.floor(Math.random() * 1_000_000);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `2FA fulfillment category ${suffix}`,
    `twofa-fulfillment-category-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, usage_instructions, is_active)
    VALUES (?, ?, ?, 1000, '', 1)
  `).run(
    category.lastInsertRowid,
    `2FA fulfillment product ${suffix}`,
    `twofa-fulfillment-product-${suffix}`,
  );
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(
    userId,
    `fixture${suffix.slice(-8)}`,
    `2FA fulfillment user ${suffix}`,
  );
  const order = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, quantity, total_price, payment_code, status, source
    ) VALUES (?, ?, 1, 1000, ?, 'pending', 'web')
  `).run(userId, product.lastInsertRowid, `PNS_TWOFA_HOOK_${suffix}`);
  if (withStock) {
    db.prepare(`
      INSERT INTO stock (product_id, data, is_sold)
      VALUES (?, ?, 0)
    `).run(product.lastInsertRowid, stockData);
  }

  return {
    userId,
    categoryId: Number(category.lastInsertRowid),
    productId: Number(product.lastInsertRowid),
    orderId: Number(order.lastInsertRowid),
    stockData,
  };
}

function cleanupFixture(fixture) {
  db.prepare('DELETE FROM twofa_order_bindings WHERE shop_order_id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?').run('order', fixture.orderId);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(fixture.userId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(fixture.productId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
}

test.before(() => {
  telegramApiClient.setTelegramRequestForTest(async () => ({ message_id: 1 }));
});

test.after(() => {
  telegramApiClient.setTelegramRequestForTest();
  twofaBindingService.setReconcileForTest(null);
});

test('automatic fulfillment schedules binding sync after delivery commit', async (t) => {
  const fixture = seedOrder({ withStock: true });
  const calls = [];
  twofaBindingService.setReconcileForTest(async (orderId) => {
    const order = db.prepare('SELECT status, delivered_keys_json FROM orders WHERE id = ?').get(orderId);
    calls.push({ orderId, order });
  });
  t.after(() => {
    twofaBindingService.setReconcileForTest(null);
    cleanupFixture(fixture);
  });

  const result = await deliverOrder({ telegram: {} }, fixture.orderId);
  await flushPromises();

  assert.strictEqual(result.success, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].orderId, fixture.orderId);
  assert.strictEqual(calls[0].order.status, 'delivered');
  assert.deepStrictEqual(JSON.parse(calls[0].order.delivered_keys_json), [fixture.stockData]);
});

test('automatic fulfillment schedules binding sync before delivery notification throws', async (t) => {
  const fixture = seedOrder({ withStock: true });
  const notificationService = require('../../src/services/notificationService');
  const fulfillmentPath = require.resolve('../../src/services/orderFulfillmentService');
  const originalSendDelivery = notificationService.sendDelivery;
  const calls = [];
  notificationService.sendDelivery = async () => {
    throw new Error('notification write failed');
  };
  delete require.cache[fulfillmentPath];
  const freshFulfillmentService = require('../../src/services/orderFulfillmentService');
  twofaBindingService.setReconcileForTest(async orderId => calls.push(orderId));
  t.after(() => {
    notificationService.sendDelivery = originalSendDelivery;
    delete require.cache[fulfillmentPath];
    require('../../src/services/orderFulfillmentService');
    twofaBindingService.setReconcileForTest(null);
    cleanupFixture(fixture);
  });

  await assert.rejects(
    freshFulfillmentService.deliverOrder({ telegram: {} }, fixture.orderId),
    /notification write failed/,
  );
  await flushPromises();

  assert.deepStrictEqual(calls, [fixture.orderId]);
});

test('manual delivery and delivered-key update schedule binding sync', async (t) => {
  const fixture = seedOrder();
  const calls = [];
  twofaBindingService.setReconcileForTest(async orderId => calls.push(orderId));
  t.after(() => {
    twofaBindingService.setReconcileForTest(null);
    cleanupFixture(fixture);
  });
  const app = makeAdminApp();

  const delivered = await requestJson(
    app,
    'POST',
    `/admin/orders/${fixture.orderId}/manual-deliver`,
    { accounts: ['https://order.subhub.vn/manual-hook'] },
  );
  const updated = await requestJson(
    app,
    'PATCH',
    `/admin/orders/${fixture.orderId}/keys`,
    { accounts: ['https://order.subhub.vn/updated-hook'] },
  );
  await flushPromises();

  assert.strictEqual(delivered.status, 200, JSON.stringify(delivered.json));
  assert.strictEqual(updated.status, 200, JSON.stringify(updated.json));
  assert.deepStrictEqual(calls, [fixture.orderId, fixture.orderId]);
});

test('binding sync failure is redacted and does not reject the caller', async (t) => {
  const originalError = console.error;
  const logs = [];
  console.error = (...args) => logs.push(args);
  twofaBindingService.setReconcileForTest(async () => {
    throw new Error('https://order.subhub.vn/private-uurl user@example.com password=secret');
  });
  t.after(() => {
    console.error = originalError;
    twofaBindingService.setReconcileForTest(null);
  });

  assert.doesNotThrow(() => twofaBindingService.scheduleTwofaBindingSync(123));
  await flushPromises();

  assert.strictEqual(logs.length, 1);
  const serialized = JSON.stringify(logs);
  assert.match(serialized, /Lỗi đồng bộ 2FA/);
  assert.doesNotMatch(serialized, /private-uurl|user@example\.com|password=secret/);
});
