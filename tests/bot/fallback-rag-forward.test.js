// tests/bot/fallback-rag-forward.test.js
const assert = require('node:assert');
const test = require('node:test');
const http = require('node:http');
const config = require('../../src/config');

function fakeCtx(text) {
  const replies = [];
  return {
    botInfo: { username: 'test_bot' },
    reply: async (t) => { replies.push(t); },
    _replies: replies,
    update: { update_id: 42, message: { text, chat: { id: 555 } } },
  };
}

test('forwards to RAG-chat-bot when RAG_BOT_FORWARD_ENABLED=true', async () => {
  let received = null;
  const server = http.createServer((req, res) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, reply: 'ignored in this test' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  config.RAG_BOT_FORWARD_ENABLED = true;
  config.RAG_BOT_INBOUND_URL = `http://127.0.0.1:${port}/telegram/inbound`;
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
