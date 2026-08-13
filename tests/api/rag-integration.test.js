// tests/api/rag-integration.test.js
const assert = require('node:assert');
const test = require('node:test');
const http = require('node:http');
const crypto = require('node:crypto');
const db = require('../../src/database');
const orderService = require('../../src/services/orderService');

function sign(secret, timestamp, rawBody) {
  const payload = Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
  return `v1=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
}

function freshApp() {
  for (const mod of ['../../src/config', '../../src/api/server', '../../src/api/routes/ragIntegration']) {
    delete require.cache[require.resolve(mod)];
  }
  process.env.RAG_INTEGRATION_SECRET = 'test-secret';
  const express = require('express');
  const { createApiRouter } = require('../../src/api/server');
  const app = express();
  const jsonParser = express.json({ verify(req, _res, buf) { req.rawBody = Buffer.from(buf); } });
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/v1/internal/rag/') || req.path.startsWith('/api/v1/integrations/')) return next();
    return jsonParser(req, res, next);
  });
  app.use('/api/v1', createApiRouter());
  return app;
}

async function post(app, path, body, { secret = 'test-secret', timestamp = String(Math.floor(Date.now() / 1000)) } = {}) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const rawBody = Buffer.from(JSON.stringify(body));
  try {
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tktn-timestamp': timestamp,
        'x-tktn-signature': sign(secret, timestamp, rawBody),
      },
      body: rawBody,
    });
  } finally {
    server.close();
  }
}

function createRagTestFixture() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 891_500_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Rag Test ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)')
    .run(`rag-test-cat-${suffix}`, `rag-test-cat-${suffix}`);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 50000, 1)
  `).run(category.lastInsertRowid, `Rag test product ${suffix}`, `rag-test-product-${suffix}`);
  db.prepare(`
    INSERT INTO stock (product_id, variant_id, data, duration_days, added_at)
    VALUES (?, NULL, ?, NULL, CURRENT_TIMESTAMP)
  `).run(product.lastInsertRowid, `test-account-${suffix}`);

  return {
    userId,
    productId: product.lastInsertRowid,
    cleanup() {
      db.prepare('DELETE FROM orders WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM stock WHERE product_id = ?').run(product.lastInsertRowid);
      db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
      db.prepare('DELETE FROM categories WHERE id = ?').run(category.lastInsertRowid);
      db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId);
    },
  };
}

test('rejects a request with an invalid signature', async () => {
  const app = freshApp();
  const res = await post(app, '/api/v1/internal/rag/twofa-uurl', { orderId: 'PNS1' }, { secret: 'wrong-secret' });
  assert.strictEqual(res.status, 401);
  const body = await res.json();
  assert.strictEqual(body.error.code, 'INVALID_SIGNATURE');
});

test('rejects an expired timestamp', async () => {
  const app = freshApp();
  const staleTimestamp = String(Math.floor(Date.now() / 1000) - 3600);
  const res = await post(app, '/api/v1/internal/rag/twofa-uurl', { orderId: 'PNS1' }, { timestamp: staleTimestamp });
  assert.strictEqual(res.status, 401);
});

test('twofa-uurl returns NOT_FOUND when the order has no active 2FA binding', async () => {
  const app = freshApp();
  const res = await post(app, '/api/v1/internal/rag/twofa-uurl', { orderId: 'no-such-order' });
  assert.strictEqual(res.status, 404);
  const body = await res.json();
  assert.strictEqual(body.error.code, 'NOT_FOUND');
});

test('orders/get returns 404 for an unknown order', async () => {
  const app = freshApp();
  const res = await post(app, '/api/v1/internal/rag/orders/get', { orderId: '999999999' });
  assert.strictEqual(res.status, 404);
});

test('orders/get returns a shaped order for a real order id', async (t) => {
  const fixture = createRagTestFixture();
  t.after(fixture.cleanup);
  const order = orderService.create(fixture.userId, fixture.productId, 1, 50000);

  const app = freshApp();
  const res = await post(app, '/api/v1/internal/rag/orders/get', { orderId: String(order.id) });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.data.id, String(order.id));
  assert.strictEqual(body.data.productId, fixture.productId);
  assert.strictEqual(body.data.status, 'pending');
});

test('orders/list-by-customer returns recent orders for that customer', async (t) => {
  const fixture = createRagTestFixture();
  t.after(fixture.cleanup);
  orderService.create(fixture.userId, fixture.productId, 1, 50000);

  const app = freshApp();
  const res = await post(app, '/api/v1/internal/rag/orders/list-by-customer', { customerId: fixture.userId });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data));
  assert.ok(body.data.some((o) => o.productId === fixture.productId));
});
