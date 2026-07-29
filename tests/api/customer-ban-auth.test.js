const assert = require('node:assert');
const test = require('node:test');
const crypto = require('node:crypto');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

const BOT_TOKEN = '123456:fake-bot-token-for-ban-tests';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.JWT_SECRET = 'test-secret-for-customer-ban-tests-32-chars';

function signInitData(params) {
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const dataCheck = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('\n');
  const hash = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  return new URLSearchParams({ ...params, hash }).toString();
}

async function requestJson(app, method, path, { body, token } = {}) {
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
    if (payload) {
      req.headers['content-type'] = 'application/json';
      req.headers['content-length'] = String(payload.length);
    }
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
  app.use('/auth', require('../../src/api/routes/auth'));
  app.use('/customer', require('../../src/api/routes/customer'));
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

function resetUser(userId) {
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId);
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(userId, `ban${userId}`, `Ban ${userId}`);
}

test('requireCustomer rejects an existing token for a banned user', async (t) => {
  const userId = 998877662;
  resetUser(userId);
  t.after(() => db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId));

  const authService = require('../../src/services/authService');
  const moderation = require('../../src/services/userModerationService');
  const token = await authService.issueCustomerToken(userId);
  moderation.setStatus(userId, 'banned', { reason: 'abuse', adminId: 1 });

  const res = await requestJson(makeApp(), 'GET', '/customer/me', { token });

  assert.strictEqual(res.status, 403, JSON.stringify(res.json));
  assert.strictEqual(res.json.success, false);
  assert.strictEqual(res.json.error.code, 'USER_BANNED');
});

test('POST /auth/miniapp rejects banned users instead of issuing a new token', async (t) => {
  const userId = 998877663;
  resetUser(userId);
  t.after(() => db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId));

  require('../../src/services/userModerationService').setStatus(userId, 'banned', { reason: 'abuse', adminId: 1 });
  const initData = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId, first_name: 'Banned', username: 'banned_user' }),
  });

  const res = await requestJson(makeApp(), 'POST', '/auth/miniapp', { body: { initData } });

  assert.strictEqual(res.status, 403, JSON.stringify(res.json));
  assert.strictEqual(res.json.error.code, 'USER_BANNED');
});

test('POST /auth/customer/login rejects banned users', async (t) => {
  const userId = 998877664;
  resetUser(userId);
  t.after(() => db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId));

  const authService = require('../../src/services/authService');
  const email = `ban-${userId}@example.com`;
  const password = 'password-12345';
  const setResult = await authService.setCustomerPassword(userId, email, password);
  assert.strictEqual(setResult.ok, true);
  require('../../src/services/userModerationService').setStatus(userId, 'banned', { reason: 'abuse', adminId: 1 });

  const res = await requestJson(makeApp(), 'POST', '/auth/customer/login', {
    body: { email, password },
  });

  assert.strictEqual(res.status, 403, JSON.stringify(res.json));
  assert.strictEqual(res.json.error.code, 'USER_BANNED');
});
