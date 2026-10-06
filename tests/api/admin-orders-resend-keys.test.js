const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

async function postJson(app, path) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = 'POST';
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
  app.set('bot', {
    telegram: {
      async sendMessage() {
        throw new Error('legacy telegraf timeout');
      },
    },
  });
  app.use((req, _res, next) => {
    req.admin = { adminId: 1, role: 'super_admin', username: 'admin' };
    next();
  });
  app.use('/admin/orders', require('../../src/api/routes/admin/orders'));
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

function createDeliveredOrder() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 839_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Resend Keys ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `resend-keys-cat-${suffix}`,
    `resend-keys-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Resend keys product ${suffix}`, `resend-keys-product-${suffix}`);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, delivered_keys_json, source)
    VALUES (?, ?, 1, 1000, ?, 'delivered', ?, 'web')
  `).run(userId, product.lastInsertRowid, `PNS_RESEND_${suffix}`, JSON.stringify([`key-${suffix}`]));

  return { userId, categoryId: category.lastInsertRowid, productId: product.lastInsertRowid, orderId: order.lastInsertRowid };
}

function cleanup(fixture) {
  db.prepare('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?').run('order', fixture.orderId);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(fixture.userId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
}

test('POST /admin/orders/:id/resend-keys uses JSON Telegram client instead of legacy Telegraf sendMessage', async (t) => {
  const fixture = createDeliveredOrder();
  const telegramApiClient = require('../../src/services/telegramApiClient');
  const calls = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    calls.push({ method, payload });
    return { message_id: 1 };
  });

  t.after(() => {
    telegramApiClient.setTelegramRequestForTest(null);
    cleanup(fixture);
  });

  const { status, json } = await postJson(makeApp(), `/admin/orders/${fixture.orderId}/resend-keys`);

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'sendMessage');
  assert.strictEqual(calls[0].payload.chat_id, fixture.userId);
  assert.match(calls[0].payload.text, /GỬI LẠI KEY/);
});
