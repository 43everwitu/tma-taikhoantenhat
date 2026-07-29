const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');
const telegramApiClient = require('../../src/services/telegramApiClient');

test.before(() => {
  telegramApiClient.setTelegramRequestForTest(async () => ({ message_id: 1 }));
});

test.after(() => {
  telegramApiClient.setTelegramRequestForTest();
});

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
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      }
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
    botInfo: { username: 'test_bot' },
    telegram: {
      sendMessage: async () => ({ message_id: 1 }),
      editMessageText: async () => ({ message_id: 1 }),
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

function createExpiredOrder() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 870_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Expired Confirm ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `expired-confirm-cat-${suffix}`,
    `expired-confirm-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, usage_instructions, is_active)
    VALUES (?, ?, ?, 1000, '', 1)
  `).run(category.lastInsertRowid, `Expired confirm product ${suffix}`, `expired-confirm-product-${suffix}`);
  const stock = db.prepare(`
    INSERT INTO stock (product_id, data, is_sold)
    VALUES (?, ?, 0)
  `).run(product.lastInsertRowid, `expired-key-${suffix}`);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source, expires_at)
    VALUES (?, ?, 1, 1000, ?, 'expired', 'web', datetime('now', '-1 minute'))
  `).run(userId, product.lastInsertRowid, `PNS_EXPIRED_${suffix}`);

  return { suffix, userId, category, product, stock, order };
}

function cleanupExpiredOrderFixture(fixture) {
  db.prepare('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?').run('order', fixture.order.lastInsertRowid);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(fixture.userId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(fixture.product.lastInsertRowid);
  db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.order.lastInsertRowid);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.product.lastInsertRowid);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.category.lastInsertRowid);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
}

test('POST /admin/orders/:id/confirm recovers and delivers an expired paid-by-bank order manually', async (t) => {
  const fixture = createExpiredOrder();
  t.after(() => {
    cleanupExpiredOrderFixture(fixture);
  });

  const { status, json } = await postJson(makeApp(), `/admin/orders/${fixture.order.lastInsertRowid}/confirm`);

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  const updated = db.prepare('SELECT status, paid_at, delivered_at, delivered_keys_json FROM orders WHERE id = ?')
    .get(fixture.order.lastInsertRowid);
  assert.strictEqual(updated.status, 'delivered');
  assert.ok(updated.paid_at);
  assert.ok(updated.delivered_at);
  assert.deepStrictEqual(JSON.parse(updated.delivered_keys_json), [`expired-key-${fixture.suffix}`]);
  const sold = db.prepare('SELECT is_sold, sold_to FROM stock WHERE id = ?').get(fixture.stock.lastInsertRowid);
  assert.strictEqual(sold.is_sold, 1);
  assert.strictEqual(sold.sold_to, fixture.userId);
});

test('POST /admin/orders/:id/manual-deliver accepts expired orders', async (t) => {
  const fixture = createExpiredOrder();
  t.after(() => {
    cleanupExpiredOrderFixture(fixture);
  });

  const { status, json } = await postJson(makeApp(), `/admin/orders/${fixture.order.lastInsertRowid}/manual-deliver`, {
    accounts: ['manual-expired-key'],
  });

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  const updated = db.prepare('SELECT status, paid_at, delivered_at, delivered_keys_json FROM orders WHERE id = ?')
    .get(fixture.order.lastInsertRowid);
  assert.strictEqual(updated.status, 'delivered');
  assert.ok(updated.paid_at);
  assert.ok(updated.delivered_at);
  assert.deepStrictEqual(JSON.parse(updated.delivered_keys_json), ['manual-expired-key']);
});
