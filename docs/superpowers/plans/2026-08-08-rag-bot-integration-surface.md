# RAG Bot Integration Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the separate `RAG-chat-bot` service (`/home/peanut/RAG-chat-bot`) a real, HMAC-authenticated way to resolve an order's `account_2fa` `uurl` from this project's own `twofa_order_bindings` table, and wire this project's Telegram bot to forward inbound customer text to that service instead of the current "everything moved to the Mini App" nudge.

**Architecture:** Reuse the existing `services/twofaIntegrationAuth.js` HMAC scheme (`HMAC-SHA256(secret, "<timestamp>." + rawBody)`, `x-tktn-timestamp`/`x-tktn-signature` headers) under a **new, independent secret** (`RAG_INTEGRATION_SECRET` — never the same value as `TWOFA_TMA_SHARED_SECRET`, so a leak of one channel's key doesn't compromise the other). New route file mirrors the existing `routes/integrations.js` self-authenticating pattern exactly. The bot-forwarding change is gated behind a new flag, default OFF — this repo's Telegram bot must not start forwarding real customer traffic to an unfinished service without an explicit operator decision.

**Tech Stack:** Node.js, Express, `better-sqlite3`, Node built-in test runner (`node --test`), the existing `crypto`-based HMAC helper.

**Explicitly OUT of scope for this plan (do not build):**
- The **reply path** (RAG-chat-bot → customer). `RAG-chat-bot/src/index.js`'s `deliverToCustomer` callback currently only logs to console — it has no way to actually send a Telegram message today. That needs its own route here (e.g. `POST /internal/rag/send-message`, same HMAC scheme) plus a bot-side sender, and its own plan — sending real messages to real customers on a live shop bot deserves a dedicated review, not a rider on this plan.
- Staff-reply/echo detection (`is_staff_reply` in `RAG-chat-bot`'s adapter). This forwarder only ever sees genuine inbound customer text (`bot.on('text', ...)` never fires for the bot's own outgoing sends), so this plan hardcodes `is_staff_reply: false` — see Task 3, Step 2 for why.
- Catalog/order-creation/discount/admin-action proxy routes that `RAG-chat-bot/src/clients/shopApiClient.js` currently calls with guessed, non-existent paths. Those need their own investigation pass (reading `orderService.js` and the real `customer.js`/`admin/orders.js` handlers) before a plan can be written without placeholders — not attempted here.

---

## File Structure

- Create: `src/api/routes/ragIntegration.js` — new signed route, one endpoint (`POST /twofa-uurl`), mounted at `/api/v1/internal/rag`.
- Modify: `src/config.js` — add `RAG_INTEGRATION_SECRET`.
- Modify: `src/api/server.js` — mount the new router next to `/integrations`.
- Modify: `src/bot/fallback.js` — forward to RAG-chat-bot when the new flag is on; unchanged nudge behavior when it's off (the default).
- Create: `tests/api/rag-integration.test.js` — real HTTP round-trip against the new route (ephemeral port, matches the pattern already proven working in `RAG-chat-bot`'s own test suite; simpler than this repo's hand-rolled req/res mock and exercises the raw-body HMAC path exactly as production receives it).
- Modify (separate repo, `/home/peanut/RAG-chat-bot`): `src/clients/account2faClient.js`, `tests/account2faClient.test.js`, `.env.example`, `src/config.js` — switch `resolveUurl` from the local `order_uurls` table to a signed call against the new endpoint.

---

### Task 1: New signed `twofa-uurl` route on `tma-taikhoantenhat`

**Files:**
- Modify: `src/config.js`
- Create: `src/api/routes/ragIntegration.js`
- Modify: `src/api/server.js:87-88`
- Create: `tests/api/rag-integration.test.js`

- [ ] **Step 1: Add the new secret to config**

Modify `src/config.js`, right after the existing `TWOFA_*` block:

```js
    TWOFA_INTERNAL_URL: process.env.TWOFA_INTERNAL_URL || '',
    TWOFA_TMA_SHARED_SECRET: process.env.TWOFA_TMA_SHARED_SECRET || '',
    TWOFA_SYNC_INTERVAL_MS: parseInt(process.env.TWOFA_SYNC_INTERVAL_MS, 10) || 60000,
    TWOFA_WEBHOOK_TIMEOUT_SECONDS: Math.max(
      1,
      parseInt(process.env.TWOFA_WEBHOOK_TIMEOUT_SECONDS, 10) || 10,
    ),

    // RAG-chat-bot integration (separate secret from TWOFA_TMA_SHARED_SECRET
    // on purpose — a leak of one channel's key must not compromise the other).
    RAG_INTEGRATION_SECRET: process.env.RAG_INTEGRATION_SECRET || '',
};
```

- [ ] **Step 2: Write the failing test**

Create `tests/api/rag-integration.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const crypto = require('node:crypto');
const express = require('express');
const db = require('../../src/database');
const config = require('../../src/config');

function sign(secret, timestamp, rawBody) {
  const payload = Buffer.concat([Buffer.from(`${timestamp}.`), rawBody]);
  return `v1=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
}

async function startTestApp() {
  const { createApiRouter } = require('../../src/api/server');
  const app = express();
  app.use('/api/v1', createApiRouter());
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

async function postSigned(baseUrl, path, secret, body) {
  const rawBody = Buffer.from(JSON.stringify(body));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-tktn-timestamp': timestamp,
      'x-tktn-signature': sign(secret, timestamp, rawBody),
    },
    body: rawBody,
  });
  return { status: res.status, json: await res.json() };
}

test('POST /internal/rag/twofa-uurl returns the active uurl for a known order', async (t) => {
  config.RAG_INTEGRATION_SECRET = 'test-secret';
  const orderId = 'RAGTEST-ORDER-1';
  db.prepare(`
    INSERT INTO twofa_order_bindings
      (binding_id, shop_order_id, telegram_user_id, uurl, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'active', datetime('now'), datetime('now'))
  `).run('ragtest-binding-1', orderId, 111, 'https://order.taikhoantenhat.com/u/ragtest123');

  const { server, baseUrl } = await startTestApp();
  t.after(() => {
    server.close();
    db.prepare('DELETE FROM twofa_order_bindings WHERE binding_id = ?').run('ragtest-binding-1');
  });

  const { status, json } = await postSigned(baseUrl, '/api/v1/internal/rag/twofa-uurl', 'test-secret', { orderId });
  assert.strictEqual(status, 200);
  assert.strictEqual(json.success, true);
  assert.strictEqual(json.data.uurl, 'https://order.taikhoantenhat.com/u/ragtest123');
});

test('POST /internal/rag/twofa-uurl rejects a bad signature', async (t) => {
  config.RAG_INTEGRATION_SECRET = 'test-secret';
  const { server, baseUrl } = await startTestApp();
  t.after(() => server.close());

  const { status, json } = await postSigned(baseUrl, '/api/v1/internal/rag/twofa-uurl', 'wrong-secret', { orderId: 'anything' });
  assert.strictEqual(status, 401);
  assert.strictEqual(json.success, false);
});

test('POST /internal/rag/twofa-uurl returns not_found for an order with no active binding', async (t) => {
  config.RAG_INTEGRATION_SECRET = 'test-secret';
  const { server, baseUrl } = await startTestApp();
  t.after(() => server.close());

  const { status, json } = await postSigned(baseUrl, '/api/v1/internal/rag/twofa-uurl', 'test-secret', { orderId: 'NO-SUCH-ORDER' });
  assert.strictEqual(status, 404);
  assert.strictEqual(json.error.code, 'NOT_FOUND');
});
```

- [ ] **Step 3: Run the test and verify it fails because the route does not exist**

Run:
```
node --test tests/api/rag-integration.test.js
```
Expected: FAIL — 404 from the catch-all handler (route not mounted yet), not the assertions above.

- [ ] **Step 4: Create the route**

Create `src/api/routes/ragIntegration.js`:

```js
const express = require('express');
const { Router } = require('express');
const config = require('../../config');
const db = require('../../database');
const { verifySignedPayload } = require('../../services/twofaIntegrationAuth');

const router = Router();
const rawJson = express.raw({ type: 'application/json', limit: '20kb' });

function fail(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

router.post('/twofa-uurl', rawJson, (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const timestamp = req.get('x-tktn-timestamp');
  const signature = req.get('x-tktn-signature');

  const verified = verifySignedPayload({
    secret: config.RAG_INTEGRATION_SECRET,
    timestamp,
    signature,
    rawBody,
  });
  if (!verified) {
    return fail(res, 401, 'INVALID_SIGNATURE', 'Invalid signature');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return fail(res, 400, 'INVALID_JSON', 'Invalid JSON');
  }

  const orderId = payload && payload.orderId;
  if (!orderId || typeof orderId !== 'string') {
    return fail(res, 400, 'INVALID_ORDER_ID', 'orderId is required');
  }

  const rows = db.prepare(`
    SELECT uurl FROM twofa_order_bindings
    WHERE shop_order_id = ? AND status = 'active'
  `).all(orderId);

  if (rows.length === 0) {
    return fail(res, 404, 'NOT_FOUND', 'No active 2FA binding for this order');
  }
  if (rows.length > 1) {
    // Same order has more than one active binding — treat as ambiguous
    // rather than guessing which uurl is correct.
    return fail(res, 409, 'AMBIGUOUS_BINDING', 'Multiple active 2FA bindings for this order');
  }

  return res.json({ success: true, data: { uurl: rows[0].uurl } });
});

module.exports = router;
```

- [ ] **Step 5: Mount the router**

Modify `src/api/server.js`, right after the existing `/integrations` mount:

```js
  // Integration routes tự xác thực bằng HMAC, không dùng customer/admin auth.
  router.use('/integrations', integrationLimiter, require('./routes/integrations'));

  // RAG-chat-bot integration — same self-authenticating HMAC pattern, own secret.
  router.use('/internal/rag', integrationLimiter, require('./routes/ragIntegration'));
```

- [ ] **Step 6: Run the test and verify it passes**

Run:
```
node --test tests/api/rag-integration.test.js
```
Expected: PASS (3/3).

- [ ] **Step 7: Add `RAG_INTEGRATION_SECRET` to `.env.example`, generate a real secret for `.env`**

Append to `.env.example`:
```
# RAG-chat-bot integration (separate from TWOFA_TMA_SHARED_SECRET)
RAG_INTEGRATION_SECRET=replace_with_openssl_rand_hex_32
```

Do NOT put a real secret in `.env.example`. For the real `.env`, generate one out-of-band:
```
openssl rand -hex 32
```

- [ ] **Step 8: Commit**

```bash
git add src/config.js src/api/routes/ragIntegration.js src/api/server.js tests/api/rag-integration.test.js .env.example
git commit -m "feat: add signed internal endpoint for RAG bot to resolve order 2FA uurl"
```

---

### Task 2: `RAG-chat-bot` resolves `uurl` via the new endpoint instead of a local table

**Files:**
- Modify: `/home/peanut/RAG-chat-bot/src/config.js`
- Modify: `/home/peanut/RAG-chat-bot/.env.example`
- Create: `/home/peanut/RAG-chat-bot/src/lib/hmacSign.js`
- Modify: `/home/peanut/RAG-chat-bot/src/clients/account2faClient.js`
- Modify: `/home/peanut/RAG-chat-bot/tests/account2faClient.test.js`

- [ ] **Step 1: Add shop-integration secret + URL to config**

Modify `/home/peanut/RAG-chat-bot/src/config.js`:

```js
  SHOP_API_URL: requireEnv('SHOP_API_URL', 'http://localhost:3200'),
  SHOP_API_KEY: requireEnv('SHOP_API_KEY', ''),
  RAG_INTEGRATION_SECRET: requireEnv('RAG_INTEGRATION_SECRET', ''),
  ACCOUNT_2FA_URL: requireEnv('ACCOUNT_2FA_URL', 'http://localhost:8080'),
```

Add to `/home/peanut/RAG-chat-bot/.env.example`, right after `SHOP_API_KEY`:
```
SHOP_API_KEY=replace_with_internal_service_key
RAG_INTEGRATION_SECRET=replace_with_same_value_as_tma_taikhoantenhats_RAG_INTEGRATION_SECRET
```

- [ ] **Step 2: Write the failing test for the new resolver**

Modify `/home/peanut/RAG-chat-bot/tests/account2faClient.test.js` — replace the three `resolveUurl`/`order_uurls` tests (the local-table ones no longer apply) with:

```js
const http = require('node:http');

test('resolveUurl calls the signed tma-taikhoantenhat endpoint and returns its uurl', async (t) => {
  const server = http.createServer((req, res) => {
    let chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      assert.strictEqual(body.orderId, 'PNS1');
      assert.ok(req.headers['x-tktn-timestamp']);
      assert.ok(req.headers['x-tktn-signature']);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, data: { uurl: 'https://secret.example/u/abc123' } }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();

  process.env.SHOP_API_URL = `http://127.0.0.1:${port}`;
  process.env.RAG_INTEGRATION_SECRET = 'test-secret';
  for (const mod of ['../src/clients/account2faClient', '../src/config']) {
    delete require.cache[require.resolve(mod)];
  }
  const { resolveUurl } = require('../src/clients/account2faClient');

  const uurl = await resolveUurl('PNS1');
  assert.strictEqual(uurl, 'https://secret.example/u/abc123');
});

test('resolveUurl throws if the order has no active binding (never silently proceeds)', async () => {
  const server = http.createServer((req, res) => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'no binding' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  process.env.SHOP_API_URL = `http://127.0.0.1:${port}`;
  process.env.RAG_INTEGRATION_SECRET = 'test-secret';
  for (const mod of ['../src/clients/account2faClient', '../src/config']) {
    delete require.cache[require.resolve(mod)];
  }
  const { resolveUurl } = require('../src/clients/account2faClient');

  await assert.rejects(() => resolveUurl('unknown-order-id'));
  server.close();
});
```

Delete the now-obsolete tests that seed the old local `order_uurls` table directly (`db.prepare('INSERT OR REPLACE INTO order_uurls ...')`), and the `const db = require('../src/db')` line that only existed for them — `account2faClient.js` no longer owns that table.

- [ ] **Step 3: Run the test and verify it fails**

Run:
```
node --test tests/account2faClient.test.js
```
Expected: FAIL — `resolveUurl` is still the synchronous local-DB version.

- [ ] **Step 4: Add the HMAC signer**

Create `/home/peanut/RAG-chat-bot/src/lib/hmacSign.js`:

```js
const crypto = require('node:crypto');

// Mirrors tma-taikhoantenhat's src/services/twofaIntegrationAuth.js signPayload
// exactly — same wire format, so its verifySignedPayload accepts this as-is.
function signPayload(secret, timestamp, rawBody) {
  const payload = Buffer.concat([
    Buffer.from(`${timestamp}.`),
    Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody),
  ]);
  return `v1=${crypto.createHmac('sha256', secret).update(payload).digest('hex')}`;
}

module.exports = { signPayload };
```

- [ ] **Step 5: Replace the local-table `resolveUurl` with the signed HTTP call**

Modify `/home/peanut/RAG-chat-bot/src/clients/account2faClient.js` — replace the top of the file (the block that creates the local `order_uurls` table, and the old synchronous `resolveUurl`) with:

```js
const config = require('../config');
const { signPayload } = require('../lib/hmacSign');

async function resolveUurl(orderId) {
  const body = { orderId: String(orderId) };
  const rawBody = Buffer.from(JSON.stringify(body));
  const timestamp = String(Math.floor(Date.now() / 1000));
  const res = await fetch(`${config.SHOP_API_URL}/api/v1/internal/rag/twofa-uurl`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tktn-timestamp': timestamp,
      'x-tktn-signature': signPayload(config.RAG_INTEGRATION_SECRET, timestamp, rawBody),
    },
    body: rawBody,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(`No uurl mapping for order ${orderId}`);
  }
  return json.data.uurl;
}
```

Then update `getOtp` and `getEmailCode` — both currently do:

```js
  let uurl;
  try {
    uurl = resolveUurl(orderId);
  } catch (e) {
```

Change to:

```js
  let uurl;
  try {
    uurl = await resolveUurl(orderId);
  } catch (e) {
```

(Two occurrences — one in `getOtp`, one in `getEmailCode`.)

Finally, `module.exports` at the bottom stays `{ getOtp, getEmailCode, resolveUurl }` — unchanged shape, just now async.

- [ ] **Step 6: Run the test and verify it passes**

Run:
```
node --test tests/account2faClient.test.js
```
Expected: PASS.

- [ ] **Step 7: Run the full suite to confirm nothing else broke**

Run:
```
node --test tests/*.test.js
```
Expected: PASS, same or higher total than the 54 currently passing (two tests were replaced, not just added — count may shift slightly; there must be zero failures).

- [ ] **Step 8: Commit**

```bash
git add src/config.js src/lib/hmacSign.js src/clients/account2faClient.js tests/account2faClient.test.js .env.example
git commit -m "feat: resolve 2FA uurl via signed tma-taikhoantenhat endpoint instead of local table"
```

---

### Task 3: Forward inbound Telegram text to RAG-chat-bot (default OFF)

**Files:**
- Modify: `src/config.js`
- Modify: `src/bot/fallback.js`
- Create: `tests/bot/fallback-rag-forward.test.js`

- [ ] **Step 1: Add the forwarding flag + target URL to config**

Modify `src/config.js`, in the same block as `RAG_INTEGRATION_SECRET` from Task 1:

```js
    // RAG-chat-bot integration (separate secret from TWOFA_TMA_SHARED_SECRET
    // on purpose — a leak of one channel's key must not compromise the other).
    RAG_INTEGRATION_SECRET: process.env.RAG_INTEGRATION_SECRET || '',
    // Default OFF on purpose — do not forward real customer traffic to the
    // RAG bot until an operator explicitly opts in for this deployment.
    RAG_BOT_FORWARD_ENABLED: process.env.RAG_BOT_FORWARD_ENABLED === 'true',
    RAG_BOT_INBOUND_URL: process.env.RAG_BOT_INBOUND_URL || 'http://localhost:3100/telegram/inbound',
};
```

- [ ] **Step 2: Write the failing test**

Create `tests/bot/fallback-rag-forward.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const http = require('node:http');
const config = require('../../src/config');

function fakeCtx(text) {
  const replies = [];
  return {
    message: { text, chat: { id: 555 }, message_id: 1, date: 0 },
    updateType: 'message',
    update: { update_id: 42, message: { text, chat: { id: 555 } } },
    botInfo: { username: 'test_bot' },
    reply: async (t) => { replies.push(t); },
    _replies: replies,
  };
}

test('forwards to RAG-chat-bot when RAG_BOT_FORWARD_ENABLED=true, and never sets is_staff_reply (this handler only sees genuine customer text)', async (t) => {
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
  t.after(() => server.close());
  const { port } = server.address();

  config.RAG_BOT_FORWARD_ENABLED = true;
  config.RAG_BOT_INBOUND_URL = `http://127.0.0.1:${port}/telegram/inbound`;
  delete require.cache[require.resolve('../../src/bot/fallback')];
  const { handleFallback } = require('../../src/bot/fallback');

  const ctx = fakeCtx('Xin chào, tôi muốn hỏi giá');
  await handleFallback(ctx);

  assert.ok(received, 'expected the RAG service to receive a forwarded request');
  assert.strictEqual(received.message.text, 'Xin chào, tôi muốn hỏi giá');
  assert.strictEqual(received.message.chat.id, 555);
  assert.strictEqual(received.message.is_staff_reply, false);
  assert.strictEqual(ctx._replies.length, 0, 'should not send the Mini App nudge when forwarding succeeded');
});

test('falls back to the Mini App nudge when RAG_BOT_FORWARD_ENABLED is not set (current default)', async () => {
  config.RAG_BOT_FORWARD_ENABLED = false;
  delete require.cache[require.resolve('../../src/bot/fallback')];
  const { handleFallback } = require('../../src/bot/fallback');

  const ctx = fakeCtx('bất kỳ tin nhắn nào');
  await handleFallback(ctx);

  assert.strictEqual(ctx._replies.length, 1);
  assert.match(ctx._replies[0], /Mini App/);
});
```

- [ ] **Step 3: Run the test and verify it fails**

Run:
```
node --test tests/bot/fallback-rag-forward.test.js
```
Expected: FAIL — current `fallback.js` always nudges, never forwards.

- [ ] **Step 4: Implement the forwarding branch**

Modify `src/bot/fallback.js`:

```js
const config = require('../config');

const NUDGE_TEXT =
  'Mọi tính năng đã chuyển vào Mini App.\nBấm nút bên dưới để mở cửa hàng.';
const { openShopButton } = require('../utils/miniAppButton');

async function nudgeToMiniApp(ctx) {
  await ctx.reply(NUDGE_TEXT, {
    reply_markup: {
      inline_keyboard: [[openShopButton('Mở cửa hàng', { botUsername: ctx.botInfo?.username })]],
    },
  });
}

async function forwardToRagBot(ctx) {
  // This handler (bot.on('text', ...)) only ever fires for genuine inbound
  // customer messages — Telegraf does not deliver the bot's own outgoing
  // sendMessage calls back through this listener — so is_staff_reply is
  // always false here. Staff-reply/echo detection for RAG-chat-bot's Gate
  // is a separate mechanism, not implemented by this forwarder.
  const body = JSON.stringify({
    update_id: ctx.update.update_id,
    message: { ...ctx.update.message, is_staff_reply: false },
  });
  try {
    const res = await fetch(config.RAG_BOT_INBOUND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`RAG bot responded ${res.status}`);
  } catch (err) {
    console.error('[rag-forward] failed, falling back to Mini App nudge:', err.message);
    await nudgeToMiniApp(ctx);
  }
}

async function handleFallback(ctx) {
  if (config.RAG_BOT_FORWARD_ENABLED) {
    return forwardToRagBot(ctx);
  }
  return nudgeToMiniApp(ctx);
}

module.exports = (bot) => {
  // Match any text/command that wasn't already handled by /start.
  bot.on('text', handleFallback);
  // Stale callback queries from old inline buttons — answer + nudge.
  bot.on('callback_query', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch {}
    await handleFallback(ctx);
  });
};

module.exports.handleFallback = handleFallback;
```

- [ ] **Step 5: Run the test and verify it passes**

Run:
```
node --test tests/bot/fallback-rag-forward.test.js
```
Expected: PASS (2/2).

- [ ] **Step 6: Add the two new env vars to `.env.example`**

Append:
```
# Off by default — do not enable until RAG-chat-bot's own TEST_MODE gate
# has been confirmed and a real go-ahead is given (see RAG-chat-bot's
# CLAUDE.md testing-gate rule).
RAG_BOT_FORWARD_ENABLED=false
RAG_BOT_INBOUND_URL=http://localhost:3100/telegram/inbound
```

- [ ] **Step 7: Commit**

```bash
git add src/config.js src/bot/fallback.js tests/bot/fallback-rag-forward.test.js .env.example
git commit -m "feat: forward inbound Telegram text to RAG-chat-bot behind RAG_BOT_FORWARD_ENABLED flag"
```

**Do not set `RAG_BOT_FORWARD_ENABLED=true` in the real `.env` as part of this plan.** That is a separate, explicit go-ahead — same rule as `RAG-chat-bot`'s own `TEST_MODE` gate.

---

## Self-Review

**Spec coverage:** Task 1 closes the `order_uurls`/"out-of-band admin import" gap noted in `RAG-chat-bot`'s design doc Section 6.2. Task 2 makes `RAG-chat-bot`'s `get_2fa_code` tool path actually resolve a real `uurl` end-to-end instead of reading an always-empty local table. Task 3 satisfies design doc Section 2's "Phase 1 prerequisite" note (bot must forward messages) while respecting the explicit testing-gate rule (default OFF, requires an operator env var, independent of `RAG-chat-bot`'s own `TEST_MODE`). The reply-path and the catalog/order/admin proxy routes are named explicitly as out of scope, not silently skipped.

**Placeholder scan:** No TBD/TODO; every step has complete, runnable code including test seed data (`ragtest-binding-1`) and cleanup (`t.after`).

**Type consistency:** `resolveUurl` changes from sync to async consistently across its one export site (`account2faClient.js`) and both call sites (`getOtp`, `getEmailCode`) in the same task/commit — no caller left calling it synchronously. The HMAC wire format (`v1=<hex>`, `x-tktn-timestamp`/`x-tktn-signature`) is identical in the tma-side verifier (Task 1), the tma-side test signer (Task 1), and the RAG-chat-bot-side signer (Task 2) — all three were written against the same `twofaIntegrationAuth.js` source, not re-derived independently.
