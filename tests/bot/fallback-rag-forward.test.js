// tests/bot/fallback-rag-forward.test.js
const assert = require('node:assert');
const test = require('node:test');
const http = require('node:http');
const config = require('../../src/config');
const { verifySignedPayload } = require('../../src/services/twofaIntegrationAuth');

const TEST_SECRET = 'test-secret';

function fakeCtx(text) {
  const replies = [];
  return {
    botInfo: { username: 'test_bot' },
    reply: async (t) => { replies.push(t); },
    _replies: replies,
    update: { update_id: 42, message: { text, chat: { id: 555 } } },
  };
}

test('forwards to RAG-chat-bot when RAG_BOT_FORWARD_ENABLED=true, signed with RAG_INTEGRATION_SECRET', async () => {
  let received = null;
  let receivedHeaders = null;
  let receivedRawBody = null;
  const server = http.createServer((req, res) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      receivedRawBody = Buffer.concat(chunks);
      received = JSON.parse(receivedRawBody.toString('utf8'));
      receivedHeaders = req.headers;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, reply: 'ignored in this test' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  config.RAG_BOT_FORWARD_ENABLED = true;
  config.RAG_BOT_INBOUND_URL = `http://127.0.0.1:${port}/telegram/inbound`;
  config.RAG_INTEGRATION_SECRET = TEST_SECRET;
  delete require.cache[require.resolve('../../src/bot/fallback')];
  const { handleFallback } = require('../../src/bot/fallback');

  const ctx = fakeCtx('Xin chào, tôi muốn hỏi giá');
  await handleFallback(ctx);
  server.close();

  assert.ok(received);
  assert.strictEqual(received.message.text, 'Xin chào, tôi muốn hỏi giá');
  assert.strictEqual(received.message.chat.id, 555);
  assert.strictEqual(received.message.is_staff_reply, false);
  assert.strictEqual(ctx._replies.length, 0);

  assert.ok(receivedHeaders['x-tktn-timestamp']);
  assert.ok(receivedHeaders['x-tktn-signature']);
  assert.strictEqual(
    verifySignedPayload({
      secret: TEST_SECRET,
      timestamp: receivedHeaders['x-tktn-timestamp'],
      signature: receivedHeaders['x-tktn-signature'],
      rawBody: receivedRawBody,
    }),
    true
  );
});

test('falls back to the Mini App nudge when RAG_BOT_FORWARD_ENABLED is false (default)', async () => {
  config.RAG_BOT_FORWARD_ENABLED = false;
  delete require.cache[require.resolve('../../src/bot/fallback')];
  const { handleFallback } = require('../../src/bot/fallback');

  const ctx = fakeCtx('bất kỳ tin nhắn nào');
  await handleFallback(ctx);

  assert.strictEqual(ctx._replies.length, 1);
  assert.match(ctx._replies[0], /Mini App/);
});

test('a RAG-chat-bot that never responds times out and falls back to the nudge', async () => {
  const server = http.createServer(() => { /* never respond */ });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  config.RAG_BOT_FORWARD_ENABLED = true;
  config.RAG_BOT_INBOUND_URL = `http://127.0.0.1:${port}/telegram/inbound`;
  config.RAG_BOT_FORWARD_TIMEOUT_SECONDS = 1;
  config.RAG_INTEGRATION_SECRET = TEST_SECRET;
  delete require.cache[require.resolve('../../src/bot/fallback')];
  const { handleFallback } = require('../../src/bot/fallback');

  const ctx = fakeCtx('timeout test');
  await handleFallback(ctx);
  server.close();

  assert.strictEqual(ctx._replies.length, 1);
  assert.match(ctx._replies[0], /Mini App/);
});

test.after(() => {
  config.RAG_BOT_FORWARD_ENABLED = false;
});
