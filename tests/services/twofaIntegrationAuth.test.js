const assert = require('node:assert/strict');
const test = require('node:test');

const {
  signPayload,
  verifySignedPayload,
} = require('../../src/services/twofaIntegrationAuth');

test('Node HMAC khớp shared Python contract vector', () => {
  const body = Buffer.from('{"eventId":"evt-1","bindingId":"bind-1"}');

  assert.strictEqual(
    signPayload('shared-secret', '1785348000', body),
    'v1=327c90fa7df2f7b3a6fb41c467e69e7f2196cdc4f111944f7b39c2ecf25c9c5a',
  );
});

test('verifySignedPayload dùng cửa sổ mặc định 300 giây và chấp nhận future skew', () => {
  const body = Buffer.from('{"eventId":"evt-1","bindingId":"bind-1"}');
  const signature = signPayload('shared-secret', '1300', body);

  assert.strictEqual(verifySignedPayload({
    secret: 'shared-secret',
    timestamp: '1300',
    signature,
    rawBody: body,
    nowSeconds: 1000,
  }), true);
  assert.strictEqual(verifySignedPayload({
    secret: 'shared-secret',
    timestamp: '1301',
    signature: signPayload('shared-secret', '1301', body),
    rawBody: body,
    nowSeconds: 1000,
  }), false);
});

test('verifySignedPayload dùng thời gian hiện tại khi không truyền nowSeconds', () => {
  const body = Buffer.from('{"eventId":"evt-now","bindingId":"bind-now"}');
  const timestamp = String(Math.floor(Date.now() / 1000));

  assert.strictEqual(verifySignedPayload({
    secret: 'shared-secret',
    timestamp,
    signature: signPayload('shared-secret', timestamp, body),
    rawBody: body,
  }), true);
});

test('verifySignedPayload từ chối signature sai, timestamp malformed và timestamp hết hạn', () => {
  const body = Buffer.from('{"eventId":"evt-1","bindingId":"bind-1"}');
  const signature = signPayload('shared-secret', '1000', body);

  assert.strictEqual(verifySignedPayload({
    secret: 'shared-secret',
    timestamp: '1000',
    signature: 'v1=invalid',
    rawBody: body,
    nowSeconds: 1000,
  }), false);
  assert.strictEqual(verifySignedPayload({
    secret: 'shared-secret',
    timestamp: '1000.5',
    signature,
    rawBody: body,
    nowSeconds: 1000,
  }), false);
  assert.strictEqual(verifySignedPayload({
    secret: 'shared-secret',
    timestamp: '699',
    signature: signPayload('shared-secret', '699', body),
    rawBody: body,
    nowSeconds: 1000,
  }), false);
});
