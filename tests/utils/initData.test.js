const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { verifyInitData } = require('../../src/utils/initData');

const BOT_TOKEN = '123456:fake-bot-token-for-tests';

function signInitData(params) {
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const dataCheck = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('\n');
  const hash = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  const url = new URLSearchParams({ ...params, hash });
  return url.toString();
}

test('verifies a freshly signed initData', () => {
  const params = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 555, first_name: 'Khoa', username: 'khoa', language_code: 'vi' }),
    query_id: 'abc',
  };
  const initData = signInitData(params);
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.user.id, 555);
  assert.strictEqual(result.user.username, 'khoa');
});

test('rejects when hash is wrong', () => {
  const initData = 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=deadbeef';
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'BAD_HASH');
});

test('rejects when older than 24h', () => {
  const params = {
    auth_date: String(Math.floor(Date.now() / 1000) - 25 * 3600),
    user: JSON.stringify({ id: 1 }),
  };
  const initData = signInitData(params);
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'EXPIRED');
});

test('rejects when user field is missing', () => {
  const params = { auth_date: String(Math.floor(Date.now() / 1000)) };
  const initData = signInitData(params);
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'NO_USER');
});
