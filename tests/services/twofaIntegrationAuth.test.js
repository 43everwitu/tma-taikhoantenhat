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

test('verifySignedPayload từ chối signature sai và timestamp hết hạn', () => {
  const body = Buffer.from('{"eventId":"evt-1","bindingId":"bind-1"}');
  const signature = signPayload('shared-secret', '1785348000', body);

  assert.strictEqual(verifySignedPayload({
    secret: 'shared-secret',
    timestamp: '1785348000',
    signature,
    rawBody: body,
    nowSeconds: 1785348060,
    maxAgeSeconds: 120,
  }), true);
  assert.strictEqual(verifySignedPayload({
    secret: 'shared-secret',
    timestamp: '1785348000',
    signature: 'v1=invalid',
    rawBody: body,
    nowSeconds: 1785348060,
    maxAgeSeconds: 120,
  }), false);
  assert.strictEqual(verifySignedPayload({
    secret: 'shared-secret',
    timestamp: '1785348000',
    signature,
    rawBody: body,
    nowSeconds: 1785348201,
    maxAgeSeconds: 120,
  }), false);
});
