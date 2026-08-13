// tests/api/rag-integration.test.js
const assert = require('node:assert');
const test = require('node:test');
const http = require('node:http');
const crypto = require('node:crypto');

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
