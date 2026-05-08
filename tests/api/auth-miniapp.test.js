const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// We import the route handler directly to avoid spinning up the full server.
// The auth router exports its Express router; we mount it on a fresh app.
const express = require('express');

const BOT_TOKEN = '123456:fake-bot-token-for-tests';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.JWT_SECRET = 'test-secret-for-miniapp-auth-tests-must-be-32-chars-long';

function signInitData(params) {
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const dataCheck = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('\n');
  const hash = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  return new URLSearchParams({ ...params, hash }).toString();
}

async function postJson(app, path, body) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        server.close();
        resolve({ status: res.status, json });
      } catch (err) { server.close(); reject(err); }
    });
  });
}

test('POST /auth/miniapp returns a customer JWT for valid initData', async () => {
  // Reset DB to a clean state by deleting any test user
  const db = require('../../src/database');
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(987654321);

  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', require('../../src/api/routes/auth'));

  const initData = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 987654321, first_name: 'Mini', username: 'miniuser' }),
  });
  const { status, json } = await postJson(app, '/api/v1/auth/miniapp', { initData });

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  assert.match(json.data.token, /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
  assert.strictEqual(json.data.user.telegramId, 987654321);
  assert.strictEqual(json.data.user.username, 'miniuser');

  const created = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(987654321);
  assert.ok(created, 'user row should be created on first contact');
});

test('POST /auth/miniapp rejects bad hash with 401', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', require('../../src/api/routes/auth'));

  const { status, json } = await postJson(app, '/api/v1/auth/miniapp', {
    initData: 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=deadbeef',
  });
  assert.strictEqual(status, 401);
  assert.strictEqual(json.success, false);
  assert.strictEqual(json.error.code, 'INVALID_INIT_DATA');
});
