const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

async function requestJson(app, method, path, headers = {}) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    req.headers = headers;
    const socket = new PassThrough();
    socket.remoteAddress = '127.0.0.1';
    req.socket = socket;

    const chunks = [];
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
    res.getHeader = (key) => res.headers[key.toLowerCase()];
    res.removeHeader = (key) => { delete res.headers[key.toLowerCase()]; };
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      if (headers) {
        for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
      }
      return res;
    };
    const end = res.end.bind(res);
    res.end = (chunk, enc, cb) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : undefined));
      end(cb);
      try {
        resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || '{}') });
      } catch (err) {
        reject(err);
      }
    };
    app.handle(req, res, reject);
  });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/customer', require('../../src/api/routes/customer'));
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  });
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

function seedDeliveredLifecycleOrder() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 894_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('key_expiry_reminder_days', '3');
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Lifecycle API ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `lifecycle-cat-${suffix}`,
    `lifecycle-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Lifecycle product ${suffix}`, `lifecycle-product-${suffix}`);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source, delivered_at, delivered_keys_json)
    VALUES (?, ?, 1, 1000, ?, 'delivered', 'telegram', datetime('now'), ?)
  `).run(userId, product.lastInsertRowid, `PNS_LIFECYCLE_${suffix}`, JSON.stringify([`key-${suffix}`]));
  const stock = db.prepare(`
    INSERT INTO stock (product_id, data, duration_days, is_sold, sold_to, sold_at)
    VALUES (?, ?, 30, 1, ?, datetime('now', '-27 days'))
  `).run(product.lastInsertRowid, `key-${suffix}`, userId);

  return {
    userId,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    orderId: order.lastInsertRowid,
    stockId: stock.lastInsertRowid,
    productSlug: `lifecycle-product-${suffix}`,
  };
}

function cleanup(seed) {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(seed.userId);
  db.prepare('DELETE FROM stock WHERE id = ?').run(seed.stockId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(seed.orderId);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(seed.userId);
}

test('customer order status includes key lifecycle for delivered orders', async (t) => {
  const seed = seedDeliveredLifecycleOrder();
  t.after(() => cleanup(seed));

  const res = await requestJson(makeApp(), 'GET', `/customer/orders/${seed.orderId}/status`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.keyLifecycle.status, 'expiring_soon');
  assert.strictEqual(res.json.data.keyLifecycle.statusLabel, 'Sắp hết hạn');
  assert.strictEqual(res.json.data.keyLifecycle.renewUrl, `/san-pham/${seed.productSlug}?renewFromOrderId=${seed.orderId}`);
  assert.strictEqual(res.json.data.keyLifecycle.orderUrl, `/don-hang/${seed.orderId}`);
});

test('customer order status includes variant name for delivered variant orders', async (t) => {
  const seed = seedDeliveredLifecycleOrder();
  t.after(() => cleanup(seed));
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, 'Dùng chung 01 tháng', 1000, 1)
  `).run(seed.productId);
  db.prepare('UPDATE orders SET variant_id = ? WHERE id = ?').run(variant.lastInsertRowid, seed.orderId);

  const res = await requestJson(makeApp(), 'GET', `/customer/orders/${seed.orderId}/status`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.variantName, 'Dùng chung 01 tháng');
});

test('customer order list includes key lifecycle for delivered orders', async (t) => {
  const seed = seedDeliveredLifecycleOrder();
  const originalSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'customer-lifecycle-test-secret-long-enough';
  t.after(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
    cleanup(seed);
  });
  const authService = require('../../src/services/authService');
  const token = await authService.issueCustomerToken(seed.userId);

  const res = await requestJson(makeApp(), 'GET', '/customer/orders/my', {
    authorization: `Bearer ${token}`,
  });

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.success, true);
  const order = res.json.data.find((row) => row.id === seed.orderId);
  assert.ok(order, 'expected seeded order in list');
  assert.strictEqual(order.keyLifecycle.status, 'expiring_soon');
  assert.strictEqual(order.keyLifecycle.statusLabel, 'Sắp hết hạn');
});
