const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough, Readable, Writable } = require('node:stream');
const Database = require('better-sqlite3');

const db = require('../../src/database');
const config = require('../../src/config');
const { runMigrations } = require('../../src/database/migrations/runner');
const messageTemplateService = require('../../src/services/messageTemplateService');
const telegramApiClient = require('../../src/services/telegramApiClient');
const twofaTemplateMigration = require('../../src/database/migrations/063_twofa_update_template');
const { signPayload } = require('../../src/services/twofaIntegrationAuth');

function makeApp() {
  const app = express();
  app.set('trust proxy', 1);
  const jsonParser = express.json({
    verify(req, _res, buf) {
      req.rawBody = Buffer.from(buf);
    },
  });
  app.use((req, res, next) => {
    if (req.path.startsWith('/api/v1/integrations/')) return next();
    return jsonParser(req, res, next);
  });
  app.use('/api/v1', require('../../src/api/server').createApiRouter());
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: { code: err.code || 'TEST_ERROR', message: err.message } });
  });
  return app;
}

async function postRaw(app, body, headers = {}, path = '/api/v1/integrations/twofa/account-updated') {
  return new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(body);
        this.push(null);
      },
    });
    req.method = 'POST';
    req.url = path;
    req.headers = {
      'content-type': 'application/json',
      'content-length': String(body.length),
      ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
    };
    req.socket = new PassThrough();
    req.socket.remoteAddress = '127.0.0.1';

    const chunks = [];
    const res = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
    res.getHeader = key => res.headers[key.toLowerCase()];
    res.removeHeader = key => { delete res.headers[key.toLowerCase()]; };
    res.writeHead = (status, headersForWrite) => {
      res.statusCode = status;
      for (const [key, value] of Object.entries(headersForWrite || {})) res.setHeader(key, value);
      return res;
    };
    const end = res.end.bind(res);
    res.end = (chunk, encoding, callback) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
      }
      end(callback);
      const text = Buffer.concat(chunks).toString();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      resolve({
        status: res.statusCode,
        json,
        text,
      });
    };
    app.handle(req, res, reject);
  });
}

function signedHeaders(body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    'x-tktn-timestamp': timestamp,
    'x-tktn-signature': signPayload(config.TWOFA_TMA_SHARED_SECRET, timestamp, body),
  };
}

function signedHeadersAt(body, timestamp) {
  return {
    'x-tktn-timestamp': String(timestamp),
    'x-tktn-signature': signPayload(config.TWOFA_TMA_SHARED_SECRET, String(timestamp), body),
  };
}

function seedActiveBinding() {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const telegramId = 8_620_000_000 + Math.floor(Math.random() * 1_000_000);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `2FA webhook category ${suffix}`,
    `twofa-webhook-category-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, usage_instructions, is_active)
    VALUES (?, ?, ?, 1000, '', 1)
  `).run(
    category.lastInsertRowid,
    `2FA webhook product ${suffix}`,
    `twofa-webhook-product-${suffix}`,
  );
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(
    telegramId,
    `fixture${suffix.slice(-8)}`,
    `2FA webhook user ${suffix}`,
  );
  const order = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, quantity, total_price, payment_code, status, source
    ) VALUES (?, ?, 1, 1000, ?, 'delivered', 'web')
  `).run(telegramId, product.lastInsertRowid, `PNS_TWOFA_WEBHOOK_${suffix}`);
  const bindingId = `binding-${suffix}`;
  const orderUrl = `https://order.taikhoantenhat.com/${suffix}`;
  db.prepare(`
    INSERT INTO twofa_order_bindings (
      binding_id, shop_order_id, telegram_user_id, uurl, order_host, order_url, recipient_label, status, synced_at
    ) VALUES (?, ?, ?, ?, 'order.taikhoantenhat.com', ?, 'Telegram ID ****0000', 'active', CURRENT_TIMESTAMP)
  `).run(bindingId, order.lastInsertRowid, telegramId, `uurl-${suffix}`, orderUrl);

  return {
    bindingId,
    telegramId,
    categoryId: Number(category.lastInsertRowid),
    productId: Number(product.lastInsertRowid),
    orderId: Number(order.lastInsertRowid),
  };
}

function seedUser(telegramId) {
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(
    telegramId,
    `buyer${telegramId}`,
    `Buyer ${telegramId}`,
  );
  return telegramId;
}

function setBindingStatus(bindingId, status) {
  db.prepare(`
    UPDATE twofa_order_bindings
    SET status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE binding_id = ?
  `).run(status, bindingId);
}

function cleanupFixture(fixture) {
  db.prepare('DELETE FROM twofa_notification_events WHERE binding_id = ?').run(fixture.bindingId);
  db.prepare('DELETE FROM twofa_order_bindings WHERE binding_id = ?').run(fixture.bindingId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.telegramId);
  if (fixture.extraUserId) {
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.extraUserId);
  }
}

function mockTelegram(t) {
  const calls = [];
  telegramApiClient.setTelegramRequestForTest(async (_method, payload) => {
    calls.push({ payload });
    return { message_id: calls.length };
  });
  t.after(() => telegramApiClient.setTelegramRequestForTest());
  return calls;
}

test.before(() => {
  config.TWOFA_TMA_SHARED_SECRET = 'test-shared-secret';
  twofaTemplateMigration.up(db);
  messageTemplateService.invalidate();
});

test('bot.2fa_order_updated is core and renders approved copy', () => {
  const template = messageTemplateService.get('bot.2fa_order_updated');
  assert.ok(template);
  assert.match(
    messageTemplateService.render('bot.2fa_order_updated', {
      productName: 'ChatGPT Plus',
      orderCode: '100226',
      changedAt: '29/07/2026 19:30',
      orderUrl: 'https://order.taikhoantenhat.com/example',
    }),
    /Thông tin tài khoản đã được cập nhật/,
  );
  assert.ok(messageTemplateService.CORE_TEMPLATE_KEYS.has('bot.2fa_order_updated'));
});

test('bot.2fa_order_updated migration preserves admin body and reset restores core default', (t) => {
  const original = db.prepare(`
    SELECT body, default_body, variables, is_enabled
    FROM message_templates
    WHERE key = 'bot.2fa_order_updated'
  `).get();
  t.after(() => {
    if (original) {
      db.prepare(`
        UPDATE message_templates
        SET body = ?, default_body = ?, variables = ?, is_enabled = ?
        WHERE key = 'bot.2fa_order_updated'
      `).run(original.body, original.default_body, original.variables, original.is_enabled);
      messageTemplateService.invalidate();
    }
  });

  messageTemplateService.update('bot.2fa_order_updated', 'ADMIN EDIT {{orderCode}}');
  twofaTemplateMigration.up(db);
  messageTemplateService.invalidate();

  assert.strictEqual(
    messageTemplateService.render('bot.2fa_order_updated', { orderCode: '100226' }),
    'ADMIN EDIT 100226',
  );
  messageTemplateService.reset('bot.2fa_order_updated');
  assert.match(
    messageTemplateService.render('bot.2fa_order_updated', {
      productName: 'ChatGPT Plus',
      orderCode: '100226',
      changedAt: '29/07/2026 19:30',
      orderUrl: 'https://order.taikhoantenhat.com/example',
    }),
    /Thông tin tài khoản đã được cập nhật/,
  );
});

test('migration 064 upgrades a legacy database where 063 was already applied', () => {
  const legacyDb = new Database(':memory:');
  try {
    legacyDb.exec(`
      CREATE TABLE migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE twofa_notification_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        binding_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        sent_at DATETIME,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const migrationsDir = path.resolve(__dirname, '../../src/database/migrations');
    const applied = fs.readdirSync(migrationsDir)
      .filter((file) => /^\d{3}_.+\.js$/.test(file) && file <= '063_twofa_update_template.js')
      .sort();
    const insertApplied = legacyDb.prepare('INSERT INTO migrations (name) VALUES (?)');
    for (const file of applied) insertApplied.run(file);

    runMigrations(legacyDb);

    const columns = legacyDb.prepare('PRAGMA table_info(twofa_notification_events)').all()
      .map((row) => row.name);
    const indexes = legacyDb.prepare("PRAGMA index_list('twofa_notification_events')").all()
      .map((row) => row.name);
    assert.ok(columns.includes('claim_token'));
    assert.ok(indexes.includes('idx_twofa_events_processing_claim'));
  } finally {
    legacyDb.close();
  }
});

test('fresh migration runner reaches the 2FA webhook migrations', () => {
  const freshDb = new Database(':memory:');
  freshDb.pragma('foreign_keys = ON');
  try {
    runMigrations(freshDb);

    const template = freshDb.prepare(`
      SELECT key FROM message_templates WHERE key = 'bot.2fa_order_updated'
    `).get();
    const columns = freshDb.prepare('PRAGMA table_info(twofa_notification_events)').all()
      .map((row) => row.name);
    const indexes = freshDb.prepare("PRAGMA index_list('twofa_notification_events')").all()
      .map((row) => row.name);
    const applied = freshDb.prepare(`
      SELECT name FROM migrations
      WHERE name IN (
        '012_message_templates.js',
        '025_admin_group_templates.js',
        '026_template_prune_tone.js',
        '064_twofa_notification_claim_token.js'
      )
      ORDER BY name
    `).all().map((row) => row.name);
    const pruned = freshDb.prepare(`
      SELECT key FROM message_templates
      WHERE key IN ('bot.order_expired_short', 'bot.order_cancelled_short')
    `).all();
    assert.ok(template);
    assert.ok(columns.includes('claim_token'));
    assert.ok(indexes.includes('idx_twofa_events_processing_claim'));
    assert.deepStrictEqual(applied, [
      '012_message_templates.js',
      '025_admin_group_templates.js',
      '026_template_prune_tone.js',
      '064_twofa_notification_claim_token.js',
    ]);
    assert.deepStrictEqual(pruned, []);
  } finally {
    freshDb.close();
  }
});

test('signed webhook sends exactly one Telegram message to binding owner', async (t) => {
  const fixture = seedActiveBinding();
  const calls = mockTelegram(t);
  t.after(() => cleanupFixture(fixture));
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-one',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));

  const first = await postRaw(makeApp(), body, signedHeaders(body));
  const duplicate = await postRaw(makeApp(), body, signedHeaders(body));

  assert.strictEqual(first.status, 200, JSON.stringify(first.json));
  assert.strictEqual(duplicate.status, 200, JSON.stringify(duplicate.json));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].payload.chat_id, fixture.telegramId);
  assert.match(calls[0].payload.text, new RegExp(String(fixture.orderId)));
});

test('webhook persists delivery reservation before calling Telegram', async (t) => {
  const fixture = seedActiveBinding();
  let stateDuringSend;
  telegramApiClient.setTelegramRequestForTest(async () => {
    stateDuringSend = db.prepare(`
      SELECT status, claim_token
      FROM twofa_notification_events
      WHERE event_id = 'evt-reserved-before-send'
    `).get();
    return { message_id: 1 };
  });
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest();
    cleanupFixture(fixture);
  });
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-reserved-before-send',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));

  const response = await postRaw(makeApp(), body, signedHeaders(body));

  assert.strictEqual(response.status, 200, JSON.stringify(response.json));
  assert.strictEqual(stateDuringSend.status, 'delivery_reserved');
  assert.match(stateDuringSend.claim_token, /^[0-9a-f-]{36}$/);
});

test('reserve failure stays retryable and does not report uncertain success', async (t) => {
  const fixture = seedActiveBinding();
  const calls = mockTelegram(t);
  t.after(() => {
    db.exec('DROP TRIGGER IF EXISTS fail_twofa_reservation');
    cleanupFixture(fixture);
  });
  db.exec(`
    CREATE TEMP TRIGGER fail_twofa_reservation
    BEFORE UPDATE OF status ON twofa_notification_events
    WHEN NEW.event_id = 'evt-reserve-failure' AND NEW.status = 'delivery_reserved'
    BEGIN
      SELECT RAISE(ABORT, 'reserve failed');
    END;
  `);
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-reserve-failure',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));

  const response = await postRaw(makeApp(), body, signedHeaders(body));
  const row = db.prepare(`
    SELECT status, attempt_count FROM twofa_notification_events WHERE event_id = ?
  `).get('evt-reserve-failure');

  assert.strictEqual(response.status, 503, JSON.stringify(response.json));
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(row, { status: 'failed', attempt_count: 1 });
});

test('webhook refuses a binding whose stored Telegram owner no longer matches the order buyer', async (t) => {
  const fixture = seedActiveBinding();
  const nextUserId = fixture.telegramId + 9_000_000;
  seedUser(nextUserId);
  fixture.extraUserId = nextUserId;
  const calls = mockTelegram(t);
  t.after(() => cleanupFixture(fixture));
  db.prepare('UPDATE orders SET user_id = ? WHERE id = ?').run(nextUserId, fixture.orderId);
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-owner-mismatch',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));

  const response = await postRaw(makeApp(), body, signedHeaders(body));

  assert.strictEqual(response.status, 404);
  assert.strictEqual(calls.length, 0);
});

test('webhook rejects invalid signature before binding lookup', async () => {
  const response = await postRaw(makeApp(), Buffer.from('{}'), {
    'x-tktn-timestamp': String(Math.floor(Date.now() / 1000)),
    'x-tktn-signature': 'v1=bad',
  });

  assert.strictEqual(response.status, 401);
});

test('webhook rejects malformed JSON with invalid signature before parsing JSON', async () => {
  const response = await postRaw(makeApp(), Buffer.from('{"eventId":'), {
    'x-tktn-timestamp': String(Math.floor(Date.now() / 1000)),
    'x-tktn-signature': 'v1=bad',
  });

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.json.error.code, 'INVALID_SIGNATURE');
});

test('webhook returns invalid JSON only after a valid raw-body signature', async () => {
  const body = Buffer.from('{"eventId":');
  const response = await postRaw(makeApp(), body, signedHeaders(body));

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.json.error.code, 'INVALID_JSON');
});

test('webhook rejects timestamps outside the signature window', async () => {
  const body = Buffer.from('{}');
  const response = await postRaw(makeApp(), body, signedHeadersAt(body, Math.floor(Date.now() / 1000) - 301));

  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.json.error.code, 'INVALID_SIGNATURE');
});

test('webhook rejects invalid payload before inserting notification event', async () => {
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-invalid-payload',
    bindingId: 'missing-date',
  }));
  const response = await postRaw(makeApp(), body, signedHeaders(body));
  const row = db.prepare('SELECT event_id FROM twofa_notification_events WHERE event_id = ?')
    .get('evt-invalid-payload');

  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.json.error.code, 'INVALID_PAYLOAD');
  assert.strictEqual(row, undefined);
});

test('integration webhook has a dedicated 120 per minute IP rate limit', async () => {
  const app = makeApp();
  const body = Buffer.from('{}');
  const headers = {
    'x-tktn-timestamp': String(Math.floor(Date.now() / 1000)),
    'x-tktn-signature': 'v1=bad',
  };
  let response;

  for (let i = 0; i < 121; i += 1) {
    response = await postRaw(app, body, headers);
  }

  assert.strictEqual(response.status, 429);
});

test('webhook escapes rendered variables in Telegram HTML', async (t) => {
  const fixture = seedActiveBinding();
  const calls = mockTelegram(t);
  t.after(() => cleanupFixture(fixture));
  db.prepare('UPDATE products SET name = ? WHERE id = ?').run('ChatGPT <Admin>&Plus', fixture.productId);
  db.prepare('UPDATE twofa_order_bindings SET order_url = ? WHERE binding_id = ?')
    .run('https://order.taikhoantenhat.com/example?q=<tag>&x=1', fixture.bindingId);
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-escape',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));

  const response = await postRaw(makeApp(), body, signedHeaders(body));

  assert.strictEqual(response.status, 200, JSON.stringify(response.json));
  assert.strictEqual(calls.length, 1);
  assert.match(calls[0].payload.text, /ChatGPT &lt;Admin&gt;&amp;Plus/);
  assert.match(calls[0].payload.text, /q=&lt;tag&gt;&amp;x=1/);
  assert.doesNotMatch(calls[0].payload.text, /<Admin>|<tag>/);
});

test('failed webhook delivery can retry and then mark event sent', async (t) => {
  const fixture = seedActiveBinding();
  const calls = [];
  telegramApiClient.setTelegramRequestForTest(async (_method, payload) => {
    calls.push({ payload });
    if (calls.length === 1) {
      const error = new Error('Telegram sendMessage rejected');
      error.isTelegramApiError = true;
      throw error;
    }
    return { message_id: calls.length };
  });
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest();
    cleanupFixture(fixture);
  });
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-retry',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));

  const first = await postRaw(makeApp(), body, signedHeaders(body));
  const retry = await postRaw(makeApp(), body, signedHeaders(body));
  const row = db.prepare('SELECT status, attempt_count, last_error FROM twofa_notification_events WHERE event_id = ?')
    .get('evt-retry');

  assert.strictEqual(first.status, 503);
  assert.strictEqual(retry.status, 200, JSON.stringify(retry.json));
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(row.status, 'sent');
  assert.strictEqual(row.attempt_count, 1);
  assert.doesNotMatch(row.last_error || '', /user@example\.com|password=secret/);
});

test('unknown Telegram delivery failure becomes uncertain and never retries', async (t) => {
  const fixture = seedActiveBinding();
  let calls = 0;
  telegramApiClient.setTelegramRequestForTest(async () => {
    calls += 1;
    throw new Error('socket reset after request write');
  });
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest();
    cleanupFixture(fixture);
  });
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-network-uncertain',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));

  const first = await postRaw(makeApp(), body, signedHeaders(body));
  const retry = await postRaw(makeApp(), body, signedHeaders(body));
  const row = db.prepare(`
    SELECT status, attempt_count, last_error
    FROM twofa_notification_events
    WHERE event_id = 'evt-network-uncertain'
  `).get();

  assert.strictEqual(first.status, 200, JSON.stringify(first.json));
  assert.deepStrictEqual(first.json.data, { duplicate: false, sent: false, uncertain: true });
  assert.strictEqual(retry.status, 200, JSON.stringify(retry.json));
  assert.deepStrictEqual(retry.json.data, { duplicate: true, sent: false, uncertain: true });
  assert.strictEqual(calls, 1);
  assert.deepStrictEqual(row, {
    status: 'delivery_uncertain',
    attempt_count: 0,
    last_error: 'Lỗi gửi thông báo cập nhật 2FA',
  });
});

test('processing webhook returns 409 until stale event is reclaimed', async (t) => {
  const fixture = seedActiveBinding();
  const calls = mockTelegram(t);
  t.after(() => cleanupFixture(fixture));
  db.prepare(`
    INSERT INTO twofa_notification_events (event_id, binding_id, status, updated_at)
    VALUES ('evt-processing', ?, 'processing', CURRENT_TIMESTAMP)
  `).run(fixture.bindingId);
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-processing',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));

  const locked = await postRaw(makeApp(), body, signedHeaders(body));
  db.prepare(`
    UPDATE twofa_notification_events
    SET updated_at = datetime('now', '-11 minutes')
    WHERE event_id = 'evt-processing'
  `).run();
  const reclaimed = await postRaw(makeApp(), body, signedHeaders(body));

  assert.strictEqual(locked.status, 409);
  assert.strictEqual(reclaimed.status, 200, JSON.stringify(reclaimed.json));
  assert.deepStrictEqual(reclaimed.json.data, { duplicate: true, sent: false, uncertain: true });
  assert.strictEqual(calls.length, 0);
});

test('stale delivery reservation becomes uncertain and is not sent again', async (t) => {
  const fixture = seedActiveBinding();
  const calls = mockTelegram(t);
  t.after(() => cleanupFixture(fixture));
  db.prepare(`
    INSERT INTO twofa_notification_events (event_id, binding_id, status, claim_token, updated_at)
    VALUES ('evt-reserved-stale', ?, 'delivery_reserved', 'old-claim', datetime('now', '-11 minutes'))
  `).run(fixture.bindingId);
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-reserved-stale',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));

  const response = await postRaw(makeApp(), body, signedHeaders(body));
  const row = db.prepare('SELECT status FROM twofa_notification_events WHERE event_id = ?')
    .get('evt-reserved-stale');

  assert.strictEqual(response.status, 200, JSON.stringify(response.json));
  assert.deepStrictEqual(response.json.data, { duplicate: true, sent: false, uncertain: true });
  assert.strictEqual(row.status, 'delivery_uncertain');
  assert.strictEqual(calls.length, 0);
});

test('markSent failure after Telegram send moves event to uncertain and prevents resend', async (t) => {
  const fixture = seedActiveBinding();
  const calls = mockTelegram(t);
  t.after(() => {
    db.exec('DROP TRIGGER IF EXISTS fail_twofa_mark_sent');
    cleanupFixture(fixture);
  });
  db.exec(`
    CREATE TEMP TRIGGER fail_twofa_mark_sent
    BEFORE UPDATE OF status ON twofa_notification_events
    WHEN NEW.event_id = 'evt-mark-sent-failure' AND NEW.status = 'sent'
    BEGIN
      SELECT RAISE(ABORT, 'mark sent failed');
    END;
  `);
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-mark-sent-failure',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));

  const first = await postRaw(makeApp(), body, signedHeaders(body));
  db.prepare(`
    UPDATE twofa_notification_events
    SET updated_at = datetime('now', '-11 minutes')
    WHERE event_id = 'evt-mark-sent-failure'
  `).run();
  const retry = await postRaw(makeApp(), body, signedHeaders(body));
  const row = db.prepare('SELECT status, attempt_count FROM twofa_notification_events WHERE event_id = ?')
    .get('evt-mark-sent-failure');

  assert.strictEqual(first.status, 200, JSON.stringify(first.json));
  assert.deepStrictEqual(first.json.data, { duplicate: false, sent: false, uncertain: true });
  assert.strictEqual(retry.status, 200, JSON.stringify(retry.json));
  assert.deepStrictEqual(retry.json.data, { duplicate: true, sent: false, uncertain: true });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(row, { status: 'delivery_uncertain', attempt_count: 0 });
});

test('stale reserved claimant becomes uncertain without a second Telegram send', async (t) => {
  const fixture = seedActiveBinding();
  const calls = [];
  let firstSendReject;
  let firstSendStarted;
  const firstSendStartedPromise = new Promise(resolve => { firstSendStarted = resolve; });
  telegramApiClient.setTelegramRequestForTest(async (_method, payload) => {
    calls.push({ payload });
    if (calls.length === 1) {
      firstSendStarted();
      return new Promise((_resolve, reject) => { firstSendReject = reject; });
    }
    return { message_id: 2 };
  });
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest();
    cleanupFixture(fixture);
  });
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-stale-guard',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));
  const app = makeApp();

  const first = postRaw(app, body, signedHeaders(body));
  await firstSendStartedPromise;
  db.prepare(`
    UPDATE twofa_notification_events
    SET updated_at = datetime('now', '-11 minutes')
    WHERE event_id = 'evt-stale-guard'
  `).run();
  const second = await postRaw(makeApp(), body, signedHeaders(body));
  firstSendReject(new Error('telegram unavailable user@example.com password=secret'));
  const stale = await first;
  const row = db.prepare(`
    SELECT status, attempt_count, last_error
    FROM twofa_notification_events
    WHERE event_id = 'evt-stale-guard'
  `).get();

  assert.strictEqual(second.status, 200, JSON.stringify(second.json));
  assert.strictEqual(stale.status, 200, JSON.stringify(stale.json));
  assert.deepStrictEqual(second.json.data, { duplicate: true, sent: false, uncertain: true });
  assert.deepStrictEqual(stale.json.data, { duplicate: false, sent: false, uncertain: true });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(row.status, 'delivery_uncertain');
  assert.strictEqual(row.attempt_count, 0);
  assert.strictEqual(row.last_error, 'Lỗi gửi thông báo cập nhật 2FA');
});

test('webhook only sends for active bindings', async (t) => {
  const fixture = seedActiveBinding();
  const calls = mockTelegram(t);
  t.after(() => cleanupFixture(fixture));
  setBindingStatus(fixture.bindingId, 'inactive');
  const body = Buffer.from(JSON.stringify({
    eventId: 'evt-inactive',
    bindingId: fixture.bindingId,
    changedAt: '2026-07-29T12:30:00Z',
  }));

  const response = await postRaw(makeApp(), body, signedHeaders(body));

  assert.strictEqual(response.status, 404);
  assert.strictEqual(calls.length, 0);
});
