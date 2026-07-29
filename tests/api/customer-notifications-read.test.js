const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'customer-notification-read-test-secret-32';

const db = require('../../src/database');
const authService = require('../../src/services/authService');

async function requestJson(app, method, path, { token } = {}) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    req.headers = {};
    if (token) req.headers.authorization = `Bearer ${token}`;
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
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({
      success: false,
      error: { code: err.body?.error?.code || 'TEST_ERROR', message: err.message },
    });
  });
  return app;
}

function seedNotifications() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userA = 879_100_000 + Math.floor(Math.random() * 100000);
  const userB = userA + 1_000_000;

  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)')
    .run(userA, `notify_read_${suffix}_a`, `Notify Read ${suffix} A`);
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)')
    .run(userB, `notify_read_${suffix}_b`, `Notify Read ${suffix} B`);

  const notificationA = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, is_read)
    VALUES (?, 'renewal_reminder', 'Gia hạn tài khoản', 'Sắp hết hạn', 0)
  `).run(userA);
  const notificationB = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, is_read)
    VALUES (?, 'renewal_reminder', 'Gia hạn tài khoản', 'Sắp hết hạn', 0)
  `).run(userB);

  return {
    userA,
    userB,
    notificationA: notificationA.lastInsertRowid,
    notificationB: notificationB.lastInsertRowid,
  };
}

function cleanup(seed) {
  db.prepare('DELETE FROM notifications WHERE id IN (?, ?)').run(seed.notificationA, seed.notificationB);
  db.prepare('DELETE FROM users WHERE telegram_id IN (?, ?)').run(seed.userA, seed.userB);
}

test('PATCH /notifications/:id/read đánh dấu notification của chính user đã đọc', async (t) => {
  const seed = seedNotifications();
  t.after(() => cleanup(seed));
  const token = await authService.issueCustomerToken(seed.userA);

  const res = await requestJson(makeApp(), 'PATCH', `/customer/notifications/${seed.notificationA}/read`, { token });

  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual(res.json, {
    success: true,
    data: { id: seed.notificationA, isRead: true },
  });
  const row = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get(seed.notificationA);
  assert.strictEqual(row.is_read, 1);
});

test('PATCH /notifications/:id/read không đánh dấu notification của user khác', async (t) => {
  const seed = seedNotifications();
  t.after(() => cleanup(seed));
  const token = await authService.issueCustomerToken(seed.userA);

  const res = await requestJson(makeApp(), 'PATCH', `/customer/notifications/${seed.notificationB}/read`, { token });

  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual(res.json, {
    success: true,
    data: { id: seed.notificationB, isRead: true },
  });
  const row = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get(seed.notificationB);
  assert.strictEqual(row.is_read, 0);
});

test('PATCH /notifications/:id/read trả lỗi khi notification id không hợp lệ', async (t) => {
  const seed = seedNotifications();
  t.after(() => cleanup(seed));
  const token = await authService.issueCustomerToken(seed.userA);

  const res = await requestJson(makeApp(), 'PATCH', '/customer/notifications/not-a-number/read', { token });

  assert.strictEqual(res.status, 400, JSON.stringify(res.json));
  assert.strictEqual(res.json.success, false);
  assert.strictEqual(res.json.error.code, 'INVALID_NOTIFICATION_ID');
});

test('PATCH /notifications/:id/read từ chối id có ký tự hậu tố', async (t) => {
  const seed = seedNotifications();
  t.after(() => cleanup(seed));
  const token = await authService.issueCustomerToken(seed.userA);

  const res = await requestJson(makeApp(), 'PATCH', `/customer/notifications/${seed.notificationA}abc/read`, { token });

  assert.strictEqual(res.status, 400, JSON.stringify(res.json));
  assert.strictEqual(res.json.success, false);
  assert.strictEqual(res.json.error.code, 'INVALID_NOTIFICATION_ID');
  const row = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get(seed.notificationA);
  assert.strictEqual(row.is_read, 0);
});
