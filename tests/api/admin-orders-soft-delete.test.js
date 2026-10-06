const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

async function requestJson(app, method, path, body = undefined) {
  return await new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = new Readable({
      read() {
        if (payload) this.push(payload);
        this.push(null);
      },
    });
    req.method = method;
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
  app.use((req, _res, next) => {
    req.admin = { adminId: 1, role: 'super_admin', username: 'admin' };
    next();
  });
  app.use('/admin/orders', require('../../src/api/routes/admin/orders'));
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  });
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

function createOrderFixture(status = 'delivered') {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 890_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `API Order Trash ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `api-order-trash-cat-${suffix}`,
    `api-order-trash-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `API order trash product ${suffix}`, `api-order-trash-product-${suffix}`);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source)
    VALUES (?, ?, 1, 1000, ?, ?, 'web')
  `).run(userId, product.lastInsertRowid, `PNS_API_TRASH_${suffix}`, status);

  return { suffix, userId, categoryId: category.lastInsertRowid, productId: product.lastInsertRowid, orderId: order.lastInsertRowid };
}

function cleanupFixture(fixture) {
  db.prepare('DELETE FROM audit_log WHERE details LIKE ?').run(`%${fixture.orderId}%`);
  db.prepare('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?').run('order', fixture.orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
}

test('GET /admin/orders hides soft-deleted orders by default and shows them in deleted view', async (t) => {
  const fixture = createOrderFixture();
  t.after(() => cleanupFixture(fixture));
  db.prepare('UPDATE orders SET deleted_at = CURRENT_TIMESTAMP, deleted_by = 1 WHERE id = ?').run(fixture.orderId);

  const active = await requestJson(makeApp(), 'GET', `/admin/orders?q=${encodeURIComponent(`PNS_API_TRASH_${fixture.suffix}`)}`);
  assert.strictEqual(active.status, 200, `unexpected active body: ${JSON.stringify(active.json)}`);
  assert.strictEqual(active.json.success, true);
  assert.strictEqual(active.json.data.total, 0);

  const deleted = await requestJson(makeApp(), 'GET', `/admin/orders?view=deleted&q=${encodeURIComponent(`PNS_API_TRASH_${fixture.suffix}`)}`);
  assert.strictEqual(deleted.status, 200, `unexpected deleted body: ${JSON.stringify(deleted.json)}`);
  assert.strictEqual(deleted.json.success, true);
  assert.strictEqual(deleted.json.data.total, 1);
  assert.strictEqual(deleted.json.data.orders[0].id, String(fixture.orderId));
  assert.ok(deleted.json.data.orders[0].deletedAt);
});

test('POST /admin/orders/bulk-delete soft-deletes selected orders', async (t) => {
  const fixture = createOrderFixture('cancelled');
  t.after(() => cleanupFixture(fixture));

  const res = await requestJson(makeApp(), 'POST', '/admin/orders/bulk-delete', {
    ids: [String(fixture.orderId)],
  });

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.deepStrictEqual(res.json.data, { requested: 1, affected: 1 });
  const row = db.prepare('SELECT status, deleted_at, deleted_by FROM orders WHERE id = ?').get(fixture.orderId);
  assert.strictEqual(row.status, 'cancelled');
  assert.ok(row.deleted_at);
  assert.strictEqual(row.deleted_by, 1);
  const audit = db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'order.bulk_delete' AND details LIKE ?")
    .get(`%${fixture.orderId}%`);
  assert.strictEqual(audit.c, 1);
});

test('POST /admin/orders/bulk-restore restores selected deleted orders', async (t) => {
  const fixture = createOrderFixture('expired');
  t.after(() => cleanupFixture(fixture));
  db.prepare('UPDATE orders SET deleted_at = CURRENT_TIMESTAMP, deleted_by = 1 WHERE id = ?').run(fixture.orderId);

  const res = await requestJson(makeApp(), 'POST', '/admin/orders/bulk-restore', {
    ids: [String(fixture.orderId)],
  });

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.deepStrictEqual(res.json.data, { requested: 1, affected: 1 });
  const row = db.prepare('SELECT deleted_at, deleted_by FROM orders WHERE id = ?').get(fixture.orderId);
  assert.strictEqual(row.deleted_at, null);
  assert.strictEqual(row.deleted_by, null);
  const audit = db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'order.bulk_restore' AND details LIKE ?")
    .get(`%${fixture.orderId}%`);
  assert.strictEqual(audit.c, 1);
});

test('GET /admin/orders uses only the delivered key snapshot for expiry', async (t) => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 891_000_000 + Math.floor(Math.random() * 100000);
  const paymentCode = `PNS_EXPIRY_API_${suffix}`;
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Expiry API User ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `expiry-api-cat-${suffix}`,
    `expiry-api-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Expiry API product ${suffix}`, `expiry-api-product-${suffix}`);
  const oldVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, default_duration_days)
    VALUES (?, '7 ngày', 1000, 7)
  `).run(product.lastInsertRowid);
  const newVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, default_duration_days)
    VALUES (?, '3 tháng', 1000, 90)
  `).run(product.lastInsertRowid);
  const newKey = `new-key-${suffix}`;
  const order = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, variant_id, quantity, total_price, payment_code,
      status, source, delivered_at, delivered_keys_json
    ) VALUES (?, ?, ?, 1, 1000, ?, 'delivered', 'web', datetime('now'), ?)
  `).run(userId, product.lastInsertRowid, newVariant.lastInsertRowid, paymentCode, JSON.stringify([newKey]));
  const oldStock = db.prepare(`
    INSERT INTO stock (product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at)
    VALUES (?, ?, ?, 7, 1, ?, datetime('now', '-11 days'))
  `).run(product.lastInsertRowid, oldVariant.lastInsertRowid, `old-key-${suffix}`, userId);
  const newStock = db.prepare(`
    INSERT INTO stock (product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at)
    VALUES (?, ?, ?, 90, 1, ?, datetime('now'))
  `).run(product.lastInsertRowid, newVariant.lastInsertRowid, newKey, userId);

  t.after(() => {
    db.prepare('DELETE FROM stock WHERE id IN (?, ?)').run(oldStock.lastInsertRowid, newStock.lastInsertRowid);
    db.prepare('DELETE FROM orders WHERE id = ?').run(order.lastInsertRowid);
    db.prepare('DELETE FROM product_variants WHERE id IN (?, ?)').run(oldVariant.lastInsertRowid, newVariant.lastInsertRowid);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(category.lastInsertRowid);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId);
  });

  const expectedExpiry = db.prepare("SELECT DATE('now', '+90 days') AS d").get().d;
  const listed = await requestJson(makeApp(), 'GET', `/admin/orders?q=${encodeURIComponent(paymentCode)}`);
  assert.strictEqual(listed.status, 200, `unexpected list body: ${JSON.stringify(listed.json)}`);
  assert.strictEqual(listed.json.data.orders[0].keyExpiresAt, expectedExpiry);
  assert.strictEqual(listed.json.data.orders[0].keyExpired, false);

  const expired = await requestJson(makeApp(), 'GET', `/admin/orders?status=expired_key&q=${encodeURIComponent(paymentCode)}`);
  assert.strictEqual(expired.status, 200, `unexpected expired body: ${JSON.stringify(expired.json)}`);
  assert.strictEqual(expired.json.data.total, 0);
});
