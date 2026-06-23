const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

const DEFAULT_ADMIN = {
  adminId: 1,
  role: 'viewer',
  username: 'admin',
  permissions: JSON.stringify(['orders.read', 'orders.write']),
};

async function requestJson(app, method, path) {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Request timed out: ${method} ${path}`));
    }, 500);
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
      clearTimeout(timeout);
      try {
        resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || '{}') });
      } catch (err) {
        reject(err);
      }
    };
    app.handle(req, res, reject);
  });
}

function makeApp({ bot, admin } = {}) {
  const app = express();
  app.use(express.json());
  if (bot) app.set('bot', bot);
  app.use((req, _res, next) => {
    req.admin = admin || DEFAULT_ADMIN;
    next();
  });
  app.use('/admin', require('../../src/api/routes/admin'));
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  });
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

function seedRenewalLog() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 896_000_000 + Math.floor(Math.random() * 100000);
  return db.transaction(() => {
    db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Renewal Admin ${suffix}`);
    const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
      `renewal-admin-cat-${suffix}`,
      `renewal-admin-cat-${suffix}`,
    );
    const product = db.prepare(`
      INSERT INTO products (category_id, name, slug, price, is_active)
      VALUES (?, ?, ?, 1000, 1)
    `).run(category.lastInsertRowid, `Renewal admin product ${suffix}`, `renewal-admin-product-${suffix}`);
    const order = db.prepare(`
      INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source)
      VALUES (?, ?, 1, 1000, ?, 'delivered', 'telegram')
    `).run(userId, product.lastInsertRowid, `PNS_RENEWAL_ADMIN_${suffix}`);
    const stock = db.prepare(`
      INSERT INTO stock (product_id, data, duration_days, is_sold, sold_to, sold_at)
      VALUES (?, ?, 30, 1, ?, datetime('now', '-27 days'))
    `).run(product.lastInsertRowid, `key-${suffix}`, userId);
    const log = db.prepare(`
      INSERT INTO renewal_reminder_logs (
        stock_id, order_id, user_id, product_id, product_name, expiry_date,
        days_before_expiry, telegram_sent, web_notification_id, status, message_body
      ) VALUES (?, ?, ?, ?, ?, DATE('now', '+3 days'), 3, 1, NULL, 'sent', ?)
    `).run(stock.lastInsertRowid, order.lastInsertRowid, userId, product.lastInsertRowid, `Renewal admin product ${suffix}`, 'body');

    return {
      userId,
      categoryId: category.lastInsertRowid,
      productId: product.lastInsertRowid,
      orderId: order.lastInsertRowid,
      stockId: stock.lastInsertRowid,
      logId: log.lastInsertRowid,
      productName: `Renewal admin product ${suffix}`,
    };
  })();
}

function cleanup(seed) {
  db.transaction(() => {
    db.prepare(`
      DELETE FROM renewal_reminder_logs
      WHERE id = ? OR stock_id = ? OR order_id = ?
    `).run(seed.logId, seed.stockId, seed.orderId);
    db.prepare("DELETE FROM notifications WHERE user_id = ? AND type = 'renewal_reminder'").run(seed.userId);
    db.prepare('DELETE FROM stock WHERE id = ?').run(seed.stockId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(seed.orderId);
    db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(seed.userId);
  })();
}

test('GET /admin/renewals returns paginated renewal reminder logs', async (t) => {
  const seed = seedRenewalLog();
  t.after(() => cleanup(seed));

  const res = await requestJson(makeApp(), 'GET', `/admin/renewals?q=${encodeURIComponent(seed.productName)}`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.total, 1);
  assert.strictEqual(res.json.data.items[0].id, String(seed.logId));
  assert.strictEqual(res.json.data.items[0].orderId, String(seed.orderId));
  assert.strictEqual(res.json.data.items[0].status, 'sent');
  assert.strictEqual(res.json.data.items[0].telegramSent, true);
});

test('GET /admin/renewals supports sent_legacy status filter', async (t) => {
  const seed = seedRenewalLog();
  t.after(() => cleanup(seed));
  db.prepare("UPDATE renewal_reminder_logs SET status = 'sent_legacy' WHERE id = ?").run(seed.logId);

  const res = await requestJson(
    makeApp(),
    'GET',
    `/admin/renewals?status=sent_legacy&q=${encodeURIComponent(seed.productName)}`,
  );

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.total, 1);
  assert.strictEqual(res.json.data.items[0].status, 'sent_legacy');
});

test('GET /admin/renewals supports exhausted status filter', async (t) => {
  const seed = seedRenewalLog();
  t.after(() => cleanup(seed));
  db.prepare("UPDATE renewal_reminder_logs SET status = 'exhausted' WHERE id = ?").run(seed.logId);

  const res = await requestJson(
    makeApp(),
    'GET',
    `/admin/renewals?status=exhausted&q=${encodeURIComponent(seed.productName)}`,
  );

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.total, 1);
  assert.strictEqual(res.json.data.items[0].status, 'exhausted');
});

test('GET /admin/renewals ignores invalid status filters', async (t) => {
  const seed = seedRenewalLog();
  t.after(() => cleanup(seed));

  const res = await requestJson(
    makeApp(),
    'GET',
    `/admin/renewals?status=unknown&q=${encodeURIComponent(seed.productName)}`,
  );

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.total, 1);
  assert.strictEqual(res.json.data.items[0].id, String(seed.logId));
});

test('GET /admin/renewals requires orders.read permission', async () => {
  const res = await requestJson(
    makeApp({
      admin: {
        adminId: 2,
        role: 'viewer',
        username: 'viewer',
        permissions: JSON.stringify(['orders.write']),
      },
    }),
    'GET',
    '/admin/renewals',
  );

  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.json.error.code, 'FORBIDDEN');
});

test('POST /admin/renewals/sweep requires orders.write permission', async () => {
  const res = await requestJson(
    makeApp({
      bot: { telegram: {} },
      admin: {
        adminId: 2,
        role: 'viewer',
        username: 'viewer',
        permissions: JSON.stringify(['orders.read']),
      },
    }),
    'POST',
    '/admin/renewals/sweep',
  );

  assert.strictEqual(res.status, 403);
  assert.strictEqual(res.json.error.code, 'FORBIDDEN');
});

test('POST /admin/renewals/sweep returns BOT_UNAVAILABLE without bot', async () => {
  const res = await requestJson(makeApp(), 'POST', '/admin/renewals/sweep');

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.json.error.code, 'BOT_UNAVAILABLE');
});

test('POST /admin/renewals/sweep initializes service and returns sweep summary', async (t) => {
  const service = require('../../src/services/keyExpiryReminderService');
  const originalInit = service.init;
  const originalSweep = service.sweep;
  const bot = { telegram: { sendMessage() {} } };
  const summary = { scanned: 4, sent: 2, skipped: 1, failed: 1, exhausted: 0 };
  let initializedBot = null;
  let sweepCalls = 0;

  service.init = (value) => {
    initializedBot = value;
  };
  service.sweep = async () => {
    sweepCalls++;
    return summary;
  };
  t.after(() => {
    service.init = originalInit;
    service.sweep = originalSweep;
  });

  const res = await requestJson(makeApp({ bot }), 'POST', '/admin/renewals/sweep');

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.json.success, true);
  assert.deepStrictEqual(res.json.data, summary);
  assert.strictEqual(initializedBot, bot);
  assert.strictEqual(sweepCalls, 1);
});

test('POST /admin/renewals/sweep forwards service rejection to error middleware', async (t) => {
  const service = require('../../src/services/keyExpiryReminderService');
  const originalInit = service.init;
  const originalSweep = service.sweep;
  const bot = { telegram: { sendMessage() {} } };

  service.init = () => {};
  service.sweep = async () => {
    throw new Error('sweep failed');
  };
  t.after(() => {
    service.init = originalInit;
    service.sweep = originalSweep;
  });

  const res = await requestJson(makeApp({ bot }), 'POST', '/admin/renewals/sweep');

  assert.strictEqual(res.status, 500);
  assert.strictEqual(res.json.error.code, 'TEST_ERROR');
  assert.strictEqual(res.json.error.message, 'sweep failed');
});
