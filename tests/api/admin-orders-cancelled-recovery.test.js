const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

async function postJson(app, path, body = undefined) {
  return await new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = new Readable({
      read() {
        if (payload) this.push(payload);
        this.push(null);
      },
    });
    req.method = 'POST';
    req.url = path;
    req.headers = {};
    const socket = new PassThrough();
    socket.remoteAddress = '127.0.0.1';
    req.socket = socket;
    if (payload) {
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = String(payload.length);
    }

    const chunks = [];
    const res = new Writable({
      write(chunk, _enc, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
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
    res.end = (chunk, encoding, callback) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
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

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { adminId: 1, role: 'super_admin', username: 'admin' };
    next();
  });
  app.use('/admin/orders', require('../../src/api/routes/admin/orders'));
  app.use((error, _req, res, _next) => {
    res.status(500).json({
      success: false,
      error: { code: 'TEST_ERROR', message: error.message },
    });
  });
  return app;
}

function createFixture(status = 'cancelled') {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const userId = 8_710_000_000 + Math.floor(Math.random() * 1_000_000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(
    userId,
    `Cancelled API recovery user ${suffix}`,
  );
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `Cancelled API recovery category ${suffix}`,
    `cancelled-api-recovery-category-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(
    category.lastInsertRowid,
    `Cancelled API recovery product ${suffix}`,
    `cancelled-api-recovery-product-${suffix}`,
  );
  const order = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, quantity, total_price, payment_code, status, paid_at
    )
    VALUES (?, ?, 1, 1000, ?, ?, CURRENT_TIMESTAMP)
  `).run(
    userId,
    product.lastInsertRowid,
    `PNS_CANCELLED_API_RECOVERY_${suffix}`,
    status,
  );

  return {
    userId,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    orderId: order.lastInsertRowid,
  };
}

function cleanupFixture(fixture) {
  db.prepare('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?')
    .run('order', fixture.orderId);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(fixture.userId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(fixture.productId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
}

test('POST /admin/orders/:id/restore đưa đơn cancelled về paid và ghi audit', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));

  const response = await postJson(
    makeApp(),
    `/admin/orders/${fixture.orderId}/restore`,
    { status: 'paid' },
  );

  assert.strictEqual(response.status, 200, JSON.stringify(response.json));
  assert.strictEqual(response.json.success, true);
  assert.strictEqual(
    db.prepare('SELECT status FROM orders WHERE id = ?').get(fixture.orderId).status,
    'paid',
  );
  const audit = db.prepare(`
    SELECT action
    FROM audit_log
    WHERE entity_type = 'order' AND entity_id = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(fixture.orderId);
  assert.strictEqual(audit.action, 'order.restore_status');
});

test('POST /admin/orders/:id/restore từ chối đơn không phải cancelled', async (t) => {
  const fixture = createFixture('pending');
  t.after(() => cleanupFixture(fixture));

  const response = await postJson(
    makeApp(),
    `/admin/orders/${fixture.orderId}/restore`,
    { status: 'paid' },
  );

  assert.strictEqual(response.status, 409, JSON.stringify(response.json));
  assert.strictEqual(response.json.error.code, 'INVALID_STATE');
});

test('POST /admin/orders/:id/restore trả 404 khi đơn không tồn tại', async () => {
  const missingOrderId = 9_999_999_999;

  const response = await postJson(
    makeApp(),
    `/admin/orders/${missingOrderId}/restore`,
    { status: 'paid' },
  );

  assert.strictEqual(response.status, 404, JSON.stringify(response.json));
  assert.strictEqual(response.json.error.code, 'NOT_FOUND');
});

test('POST /admin/orders/:id/manual-deliver giao được đơn cancelled sau khi nhập key', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));

  const response = await postJson(
    makeApp(),
    `/admin/orders/${fixture.orderId}/manual-deliver`,
    { accounts: ['manual-cancelled-key'], durationDays: 30 },
  );

  assert.strictEqual(response.status, 200, JSON.stringify(response.json));
  const updated = db.prepare(`
    SELECT status, delivered_at, delivered_keys_json
    FROM orders
    WHERE id = ?
  `).get(fixture.orderId);
  assert.strictEqual(updated.status, 'delivered');
  assert.ok(updated.delivered_at);
  assert.deepStrictEqual(JSON.parse(updated.delivered_keys_json), ['manual-cancelled-key']);
  const sold = db.prepare(`
    SELECT data, is_sold, sold_to, duration_days
    FROM stock
    WHERE product_id = ?
  `).get(fixture.productId);
  assert.deepStrictEqual(sold, {
    data: 'manual-cancelled-key',
    is_sold: 1,
    sold_to: fixture.userId,
    duration_days: 30,
  });
});
