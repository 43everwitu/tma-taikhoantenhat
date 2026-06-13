const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

async function requestJson(app, method, path) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    req.headers = {};
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

function createPaidOrderFixture(isBackorder) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 891_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Status Backorder ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `status-backorder-cat-${suffix}`,
    `status-backorder-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Status backorder product ${suffix}`, `status-backorder-product-${suffix}`);
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
    VALUES (?, ?, 1000, 1, ?)
  `).run(product.lastInsertRowid, `Status backorder variant ${suffix}`, isBackorder ? 1 : 0);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, variant_id, quantity, total_price, payment_code, status, source, bank_name)
    VALUES (?, ?, ?, 1, 1000, ?, 'paid', 'web', ?)
  `).run(userId, product.lastInsertRowid, variant.lastInsertRowid, `PNS_STATUS_BACKORDER_${suffix}`, null);

  return {
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    variantId: variant.lastInsertRowid,
    orderId: order.lastInsertRowid,
    userId,
  };
}

function cleanupFixture(fixture) {
  db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM product_variants WHERE id = ?').run(fixture.variantId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
}

test('GET /customer/orders/:id/status marks paid backorder variant orders', async (t) => {
  const fixture = createPaidOrderFixture(true);
  t.after(() => cleanupFixture(fixture));

  const res = await requestJson(makeApp(), 'GET', `/customer/orders/${fixture.orderId}/status`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.status, 'paid');
  assert.strictEqual(res.json.data.isBackorder, true);
  assert.match(res.json.data.backorderWaitMode, /^(business_hours|after_hours)$/);
});

test('GET /customer/orders/:id/status marks paid non-backorder variant orders', async (t) => {
  const fixture = createPaidOrderFixture(false);
  t.after(() => cleanupFixture(fixture));

  const res = await requestJson(makeApp(), 'GET', `/customer/orders/${fixture.orderId}/status`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.status, 'paid');
  assert.strictEqual(res.json.data.isBackorder, false);
  assert.strictEqual(Object.hasOwn(res.json.data, 'backorderWaitMode'), false);
});

test('GET /customer/orders/:id/status omits wait mode for delivered backorder variant orders', async (t) => {
  const fixture = createPaidOrderFixture(true);
  t.after(() => cleanupFixture(fixture));
  db.prepare("UPDATE orders SET status = 'delivered' WHERE id = ?").run(fixture.orderId);

  const res = await requestJson(makeApp(), 'GET', `/customer/orders/${fixture.orderId}/status`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.status, 'delivered');
  assert.strictEqual(res.json.data.isBackorder, true);
  assert.strictEqual(Object.hasOwn(res.json.data, 'backorderWaitMode'), false);
});
