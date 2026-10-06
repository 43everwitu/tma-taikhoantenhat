// tests/bot/business-rag-forward.test.js
const assert = require('node:assert');
const test = require('node:test');
const http = require('node:http');
const config = require('../../src/config');
const { verifySignedPayload } = require('../../src/services/twofaIntegrationAuth');

const TEST_SECRET = 'test-secret';

function fakeBusinessCtx(text, updateId = 42) {
  const sentMessages = [];
  const sentPhotos = [];
  return {
    telegram: {
      sendMessage: async (chatId, msg, opts) => { sentMessages.push({ chatId, msg, opts }); },
      sendPhoto: async (chatId, photo, opts) => { sentPhotos.push({ chatId, photo, opts }); },
    },
    _sentMessages: sentMessages,
    _sentPhotos: sentPhotos,
    update: {
      update_id: updateId,
      business_message: {
        business_connection_id: 'conn-abc123',
        message_id: 1,
        chat: { id: 555, type: 'private' },
        from: { id: 555, is_bot: false, first_name: 'Khach' },
        date: 1700000000,
        text,
      },
    },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('forwards a business_message to RAG-chat-bot when RAG_BUSINESS_FORWARD_ENABLED=true', async () => {
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
      res.end(JSON.stringify({ ok: true, reply: 'Giá 50.000đ', qrUrl: null }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  config.RAG_BUSINESS_FORWARD_ENABLED = true;
  config.RAG_BOT_INBOUND_URL = `http://127.0.0.1:${port}/telegram/inbound`;
  config.RAG_INTEGRATION_SECRET = TEST_SECRET;
  config.RAG_BUSINESS_DEBOUNCE_MS = 10;
  delete require.cache[require.resolve('../../src/bot/businessForward')];
  const { handleBusinessMessage } = require('../../src/bot/businessForward');

  const ctx = fakeBusinessCtx('giá bao nhiêu');
  await handleBusinessMessage(ctx);
  await sleep(300);
  server.close();

  assert.ok(received);
  assert.strictEqual(received.message.text, 'giá bao nhiêu');
  assert.strictEqual(received.message.chat.id, 555);
  assert.strictEqual(received.message.is_staff_reply, false);

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

  assert.strictEqual(ctx._sentMessages.length, 1);
  assert.strictEqual(ctx._sentMessages[0].chatId, 555);
  assert.strictEqual(ctx._sentMessages[0].msg, 'Giá 50.000đ');
  assert.strictEqual(ctx._sentMessages[0].opts.business_connection_id, 'conn-abc123');
  assert.strictEqual(ctx._sentPhotos.length, 0);
});

test('coalesces messages sent within the debounce window into a single RAG turn', async () => {
  const receivedRequests = [];
  const server = http.createServer((req, res) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      receivedRequests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, reply: 'Đã nhận đủ thông tin ạ', qrUrl: null }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  config.RAG_BUSINESS_FORWARD_ENABLED = true;
  config.RAG_BOT_INBOUND_URL = `http://127.0.0.1:${port}/telegram/inbound`;
  config.RAG_INTEGRATION_SECRET = TEST_SECRET;
  config.RAG_BUSINESS_DEBOUNCE_MS = 50;
  delete require.cache[require.resolve('../../src/bot/businessForward')];
  const { handleBusinessMessage } = require('../../src/bot/businessForward');

  // Same customer splitting one thought across 3 rapid messages — each
  // arrives well inside the debounce window (unlike the real timing, but
  // handleBusinessMessage no longer blocks on the RAG round trip, so back
  // to back calls here stand in for it).
  await handleBusinessMessage(fakeBusinessCtx('Netflix', 1));
  await handleBusinessMessage(fakeBusinessCtx('còn hàng không', 2));
  const lastCtx = fakeBusinessCtx('3 tháng ấy', 3);
  await handleBusinessMessage(lastCtx);
  await sleep(150);
  server.close();

  assert.strictEqual(receivedRequests.length, 1, 'RAG must receive exactly one combined turn, not three fragments');
  assert.strictEqual(receivedRequests[0].message.text, 'Netflix\ncòn hàng không\n3 tháng ấy');
  assert.strictEqual(receivedRequests[0].update_id, 3);
  assert.strictEqual(lastCtx._sentMessages.length, 1);
  assert.strictEqual(lastCtx._sentMessages[0].msg, 'Đã nhận đủ thông tin ạ');
});

test('sends the QR as a photo (with business_connection_id) when the reply includes qrUrl', async () => {
  const server = http.createServer((req, res) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, reply: 'Quét mã để thanh toán', qrUrl: 'https://img.vietqr.io/x.png' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  config.RAG_BUSINESS_FORWARD_ENABLED = true;
  config.RAG_BOT_INBOUND_URL = `http://127.0.0.1:${port}/telegram/inbound`;
  config.RAG_INTEGRATION_SECRET = TEST_SECRET;
  config.RAG_BUSINESS_DEBOUNCE_MS = 10;
  delete require.cache[require.resolve('../../src/bot/businessForward')];
  const { handleBusinessMessage } = require('../../src/bot/businessForward');

  const ctx = fakeBusinessCtx('mua 1 unlock coursehero');
  await handleBusinessMessage(ctx);
  await sleep(150);
  server.close();

  assert.strictEqual(ctx._sentPhotos.length, 1);
  assert.strictEqual(ctx._sentPhotos[0].chatId, 555);
  assert.strictEqual(ctx._sentPhotos[0].photo, 'https://img.vietqr.io/x.png');
  assert.strictEqual(ctx._sentPhotos[0].opts.caption, 'Quét mã để thanh toán');
  assert.strictEqual(ctx._sentPhotos[0].opts.business_connection_id, 'conn-abc123');
  assert.strictEqual(ctx._sentMessages.length, 0);
});

test('sends nothing when RAG-chat-bot deliberately stays silent (skipped)', async () => {
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, skipped: 'gated' }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  config.RAG_BUSINESS_FORWARD_ENABLED = true;
  config.RAG_BOT_INBOUND_URL = `http://127.0.0.1:${port}/telegram/inbound`;
  config.RAG_INTEGRATION_SECRET = TEST_SECRET;
  config.RAG_BUSINESS_DEBOUNCE_MS = 10;
  delete require.cache[require.resolve('../../src/bot/businessForward')];
  const { handleBusinessMessage } = require('../../src/bot/businessForward');

  const ctx = fakeBusinessCtx('bất kỳ');
  await handleBusinessMessage(ctx);
  await sleep(150);
  server.close();

  assert.strictEqual(ctx._sentMessages.length, 0);
  assert.strictEqual(ctx._sentPhotos.length, 0);
});

test('does nothing when RAG_BUSINESS_FORWARD_ENABLED is false (default)', async () => {
  config.RAG_BUSINESS_FORWARD_ENABLED = false;
  delete require.cache[require.resolve('../../src/bot/businessForward')];
  const { handleBusinessMessage } = require('../../src/bot/businessForward');

  const ctx = fakeBusinessCtx('bất kỳ tin nhắn nào');
  await handleBusinessMessage(ctx);

  assert.strictEqual(ctx._sentMessages.length, 0);
  assert.strictEqual(ctx._sentPhotos.length, 0);
});

test('a RAG-chat-bot that never responds times out without throwing', async () => {
  const server = http.createServer(() => { /* never respond */ });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  config.RAG_BUSINESS_FORWARD_ENABLED = true;
  config.RAG_BOT_INBOUND_URL = `http://127.0.0.1:${port}/telegram/inbound`;
  config.RAG_BOT_FORWARD_TIMEOUT_SECONDS = 1;
  config.RAG_INTEGRATION_SECRET = TEST_SECRET;
  config.RAG_BUSINESS_DEBOUNCE_MS = 10;
  delete require.cache[require.resolve('../../src/bot/businessForward')];
  const { handleBusinessMessage } = require('../../src/bot/businessForward');

  const ctx = fakeBusinessCtx('timeout test');
  await handleBusinessMessage(ctx);
  await sleep(1200);
  server.close();

  assert.strictEqual(ctx._sentMessages.length, 0);
  assert.strictEqual(ctx._sentPhotos.length, 0);
});

test.after(() => {
  config.RAG_BUSINESS_FORWARD_ENABLED = false;
});
