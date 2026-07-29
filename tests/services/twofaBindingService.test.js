const assert = require('node:assert/strict');
const test = require('node:test');
const Database = require('better-sqlite3');

const {
  extractTwofaOrderLinks,
  maskTelegramRecipient,
  reconcileDeliveredOrder,
  retryPendingBindings,
  startRetryWorker,
  setReconcileForTest,
  redactIntegrationError,
} = require('../../src/services/twofaBindingService');
const config = require('../../src/config');
const db = require('../../src/database');
const { signPayload } = require('../../src/services/twofaIntegrationAuth');
const migration = require('../../src/database/migrations/062_twofa_order_bindings');

function seedDeliveredOrder({ accounts, username = 'fixtureuser' }) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const userId = 8_800_000_000 + Math.floor(Math.random() * 1_000_000);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `2FA binding category ${suffix}`,
    `twofa-binding-category-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(
    category.lastInsertRowid,
    `2FA binding product ${suffix}`,
    `twofa-binding-product-${suffix}`,
  );
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(
    userId,
    username,
    `2FA binding user ${suffix}`,
  );
  const order = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, quantity, total_price, payment_code, status, delivered_at, delivered_keys_json
    )
    VALUES (?, ?, 1, 1000, ?, 'delivered', CURRENT_TIMESTAMP, ?)
  `).run(userId, product.lastInsertRowid, `PNS_TWOFA_${suffix}`, JSON.stringify(accounts));

  return {
    userId,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    orderId: Number(order.lastInsertRowid),
  };
}

function cleanupFixture(fixture) {
  db.prepare('DELETE FROM twofa_order_bindings WHERE shop_order_id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
}

test('extractTwofaOrderLinks chấp nhận allowlist chính xác và dedupe theo UURL', () => {
  const links = extractTwofaOrderLinks([
    'https://order.taikhoantenhat.com/abc123',
    'Xem lại: https://order.godstudy.me/abc123?source=tma#account',
    'https://order.subhub.vn/subhub-abc',
    'https://order.taikhoantenhat.com.evil.test/abc123',
    'https://order.subhub.vn/invalid/path',
    'https://order.subhub.vn/bad%ZZ',
    'https://order.subhub.vn/encoded%2Fpath',
  ]);

  assert.deepStrictEqual(links, [
    {
      uurl: 'abc123',
      host: 'order.taikhoantenhat.com',
      orderUrl: 'https://order.taikhoantenhat.com/abc123',
    },
    {
      uurl: 'subhub-abc',
      host: 'order.subhub.vn',
      orderUrl: 'https://order.subhub.vn/subhub-abc',
    },
  ]);
});

test('migration tạo schema binding, index và cascade foreign key', () => {
  const memoryDb = new Database(':memory:');
  memoryDb.pragma('foreign_keys = ON');
  memoryDb.exec('CREATE TABLE orders (id INTEGER PRIMARY KEY)');
  migration.up(memoryDb);
  migration.up(memoryDb);

  const columns = memoryDb.prepare('PRAGMA table_info(twofa_order_bindings)').all();
  const names = columns.map(column => column.name);
  assert.deepStrictEqual(names, [
    'id', 'binding_id', 'shop_order_id', 'telegram_user_id', 'uurl', 'order_host', 'order_url',
    'recipient_label', 'status', 'last_error', 'created_at', 'updated_at', 'synced_at',
  ]);
  const indexes = memoryDb.prepare('PRAGMA index_list(twofa_order_bindings)').all();
  assert.ok(indexes.some(index => index.name === 'idx_twofa_binding_order_uurl'));
  assert.ok(indexes.some(index => index.name === 'idx_twofa_binding_uurl_status'));

  memoryDb.prepare('INSERT INTO orders (id) VALUES (1)').run();
  memoryDb.prepare(`
    INSERT INTO twofa_order_bindings (
      binding_id, shop_order_id, telegram_user_id, uurl, order_host, order_url, recipient_label
    ) VALUES ('binding-1', 1, 123456789, 'abc', 'order.subhub.vn', 'https://order.subhub.vn/abc', '@user***er')
  `).run();
  memoryDb.prepare('DELETE FROM orders WHERE id = 1').run();
  assert.strictEqual(memoryDb.prepare('SELECT COUNT(*) AS count FROM twofa_order_bindings').get().count, 0);
  memoryDb.close();
});

test('maskTelegramRecipient không bao giờ lộ Telegram ID thô', () => {
  assert.strictEqual(
    maskTelegramRecipient({ username: 'nguyenvan89', telegramId: 123456789 }),
    '@nguy***89',
  );
  assert.strictEqual(
    maskTelegramRecipient({ username: null, telegramId: 123456789 }),
    'Telegram ID ••••6789',
  );
});

test('maskTelegramRecipient fallback Telegram ID khi username quá ngắn để mask an toàn', () => {
  assert.strictEqual(
    maskTelegramRecipient({ username: 'short', telegramId: 123456789 }),
    'Telegram ID ••••6789',
  );
  assert.strictEqual(
    maskTelegramRecipient({ username: 'sixsix', telegramId: 123456789 }),
    'Telegram ID ••••6789',
  );
});

test('redactIntegrationError không giữ URL, email hay credential', () => {
  const redacted = redactIntegrationError(
    new Error('https://order.subhub.vn/a alice@example.com password=super-secret uurl-only'),
  );

  assert.strictEqual(redacted, 'Lỗi đồng bộ 2FA');
});

test('reconcile lưu một candidate khi UURL lặp lại trong cùng đơn', async (t) => {
  const fixture = seedDeliveredOrder({
    accounts: [
      'https://order.taikhoantenhat.com/same-uurl',
      'Mở lại https://order.godstudy.me/same-uurl',
    ],
  });
  t.after(() => cleanupFixture(fixture));

  const result = await reconcileDeliveredOrder(fixture.orderId, { register: false });

  assert.strictEqual(result.created, 1);
  assert.strictEqual(result.conflicts, 0);
});

test('cùng UURL ở hai đơn đánh dấu cả hai là conflict', async (t) => {
  const first = seedDeliveredOrder({ accounts: ['https://order.taikhoantenhat.com/shared-uurl'] });
  const second = seedDeliveredOrder({ accounts: ['https://order.taikhoantenhat.com/shared-uurl'] });
  t.after(() => {
    cleanupFixture(second);
    cleanupFixture(first);
  });

  await reconcileDeliveredOrder(first.orderId, { register: false });
  await reconcileDeliveredOrder(second.orderId, { register: false });

  const statuses = db.prepare(
    'SELECT status FROM twofa_order_bindings WHERE uurl = ? ORDER BY id',
  ).all('shared-uurl');
  assert.deepStrictEqual(statuses.map(row => row.status), ['conflict', 'conflict']);
});

test('reconcile đăng ký raw JSON đã ký mà không gọi network thật', async (t) => {
  const fixture = seedDeliveredOrder({ accounts: ['https://order.taikhoantenhat.com/register-uurl'] });
  const originalFetch = global.fetch;
  const originalUrl = config.TWOFA_INTERNAL_URL;
  const originalSecret = config.TWOFA_TMA_SHARED_SECRET;
  config.TWOFA_INTERNAL_URL = 'https://twofa.example.test';
  config.TWOFA_TMA_SHARED_SECRET = 'shared-secret';
  t.after(() => {
    global.fetch = originalFetch;
    config.TWOFA_INTERNAL_URL = originalUrl;
    config.TWOFA_TMA_SHARED_SECRET = originalSecret;
    cleanupFixture(fixture);
  });

  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ success: true, data: { status: 'active' } }), { status: 200 });
  };

  const result = await reconcileDeliveredOrder(fixture.orderId);

  assert.strictEqual(result.active, 1);
  assert.strictEqual(request.url, 'https://twofa.example.test/api/internal/tma/twofa-bindings');
  assert.ok(Buffer.isBuffer(request.options.body));
  assert.deepStrictEqual(Object.keys(request.options.headers).sort(), [
    'X-TKTN-Signature',
    'X-TKTN-Timestamp',
    'content-type',
  ]);
  assert.strictEqual(
    request.options.headers['X-TKTN-Signature'],
    signPayload('shared-secret', request.options.headers['X-TKTN-Timestamp'], request.options.body),
  );
  assert.deepStrictEqual(JSON.parse(request.options.body.toString()), {
    bindingId: db.prepare('SELECT binding_id FROM twofa_order_bindings WHERE shop_order_id = ?')
      .get(fixture.orderId).binding_id,
    uurl: 'register-uurl',
    recipientLabel: '@fixt***er',
  });
});

test('reconcile đọc semantic conflict từ HTTP 409 envelope', async (t) => {
  const fixture = seedDeliveredOrder({ accounts: ['https://order.subhub.vn/http-conflict'] });
  const originalFetch = global.fetch;
  const originalUrl = config.TWOFA_INTERNAL_URL;
  const originalSecret = config.TWOFA_TMA_SHARED_SECRET;
  config.TWOFA_INTERNAL_URL = 'https://twofa.example.test';
  config.TWOFA_TMA_SHARED_SECRET = 'shared-secret';
  global.fetch = async () => new Response(
    JSON.stringify({ success: false, data: { status: 'conflict' } }),
    { status: 409 },
  );
  t.after(() => {
    global.fetch = originalFetch;
    config.TWOFA_INTERNAL_URL = originalUrl;
    config.TWOFA_TMA_SHARED_SECRET = originalSecret;
    cleanupFixture(fixture);
  });

  const result = await reconcileDeliveredOrder(fixture.orderId);

  assert.strictEqual(result.conflicts, 1);
  assert.strictEqual(
    db.prepare('SELECT status FROM twofa_order_bindings WHERE shop_order_id = ?').get(fixture.orderId).status,
    'conflict',
  );
});

test('reconcile xử lý HTTP 400 envelope invalid thành sync_failed', async (t) => {
  const fixture = seedDeliveredOrder({ accounts: ['https://order.subhub.vn/http-invalid'] });
  const originalFetch = global.fetch;
  const originalUrl = config.TWOFA_INTERNAL_URL;
  const originalSecret = config.TWOFA_TMA_SHARED_SECRET;
  config.TWOFA_INTERNAL_URL = 'https://twofa.example.test';
  config.TWOFA_TMA_SHARED_SECRET = 'shared-secret';
  global.fetch = async () => new Response(
    JSON.stringify({ success: false, data: { status: 'invalid' } }),
    { status: 400 },
  );
  t.after(() => {
    global.fetch = originalFetch;
    config.TWOFA_INTERNAL_URL = originalUrl;
    config.TWOFA_TMA_SHARED_SECRET = originalSecret;
    cleanupFixture(fixture);
  });

  const result = await reconcileDeliveredOrder(fixture.orderId);

  assert.strictEqual(result.failed, 1);
  assert.strictEqual(
    db.prepare('SELECT status FROM twofa_order_bindings WHERE shop_order_id = ?').get(fixture.orderId).status,
    'sync_failed',
  );
});

test('deactivate failure giữ marker remote-active và retry DELETE theo path đã encode', async (t) => {
  const fixture = seedDeliveredOrder({ accounts: ['https://order.subhub.vn/remove-uurl'] });
  const originalFetch = global.fetch;
  const originalUrl = config.TWOFA_INTERNAL_URL;
  const originalSecret = config.TWOFA_TMA_SHARED_SECRET;
  config.TWOFA_INTERNAL_URL = 'https://twofa.example.test';
  config.TWOFA_TMA_SHARED_SECRET = 'shared-secret';
  global.fetch = async () => new Response(
    JSON.stringify({ success: true, data: { status: 'active' } }),
    { status: 200 },
  );
  t.after(() => {
    global.fetch = originalFetch;
    config.TWOFA_INTERNAL_URL = originalUrl;
    config.TWOFA_TMA_SHARED_SECRET = originalSecret;
    cleanupFixture(fixture);
  });

  await reconcileDeliveredOrder(fixture.orderId);
  db.prepare('UPDATE twofa_order_bindings SET binding_id = ? WHERE shop_order_id = ?')
    .run('binding/remove one', fixture.orderId);
  db.prepare('UPDATE orders SET delivered_keys_json = ? WHERE id = ?').run('[]', fixture.orderId);
  global.fetch = async () => {
    throw new Error('https://order.subhub.vn/remove-uurl alice@example.com password=secret');
  };

  const failed = await reconcileDeliveredOrder(fixture.orderId);
  const pendingDeletion = db.prepare(`
    SELECT status, synced_at, last_error FROM twofa_order_bindings WHERE shop_order_id = ?
  `).get(fixture.orderId);
  assert.strictEqual(failed.failed, 1);
  assert.strictEqual(pendingDeletion.status, 'inactive');
  assert.ok(pendingDeletion.synced_at);
  assert.strictEqual(pendingDeletion.last_error, 'Lỗi đồng bộ 2FA');

  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify({ success: true, data: { status: 'inactive' } }), { status: 200 });
  };
  const retried = await retryPendingBindings();
  const deleted = db.prepare(`
    SELECT synced_at, last_error FROM twofa_order_bindings WHERE shop_order_id = ?
  `).get(fixture.orderId);

  assert.strictEqual(retried.attempted, 1);
  assert.strictEqual(request.url, 'https://twofa.example.test/api/internal/tma/twofa-bindings/binding%2Fremove%20one');
  assert.strictEqual(request.options.method, 'DELETE');
  assert.strictEqual(request.options.body.length, 0);
  assert.strictEqual(
    request.options.headers['X-TKTN-Signature'],
    signPayload('shared-secret', request.options.headers['X-TKTN-Timestamp'], request.options.body),
  );
  assert.strictEqual(deleted.synced_at, null);
  assert.strictEqual(deleted.last_error, null);

  db.prepare(`
    UPDATE twofa_order_bindings SET synced_at = CURRENT_TIMESTAMP WHERE shop_order_id = ?
  `).run(fixture.orderId);
  global.fetch = async () => new Response(
    JSON.stringify({ success: false, data: { status: 'not_found' } }),
    { status: 404 },
  );
  await retryPendingBindings();
  assert.strictEqual(
    db.prepare('SELECT synced_at FROM twofa_order_bindings WHERE shop_order_id = ?').get(fixture.orderId).synced_at,
    null,
  );
});

test('reconcile conflict mới deactivate ngay binding active của order khác', async (t) => {
  const first = seedDeliveredOrder({ accounts: ['https://order.subhub.vn/immediate-conflict'] });
  const second = seedDeliveredOrder({ accounts: ['https://order.subhub.vn/immediate-conflict'] });
  const originalFetch = global.fetch;
  const originalUrl = config.TWOFA_INTERNAL_URL;
  const originalSecret = config.TWOFA_TMA_SHARED_SECRET;
  config.TWOFA_INTERNAL_URL = 'https://twofa.example.test';
  config.TWOFA_TMA_SHARED_SECRET = 'shared-secret';
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    const status = options.method === 'DELETE' ? 'inactive' : 'active';
    return new Response(JSON.stringify({ success: true, data: { status } }), { status: 200 });
  };
  t.after(() => {
    global.fetch = originalFetch;
    config.TWOFA_INTERNAL_URL = originalUrl;
    config.TWOFA_TMA_SHARED_SECRET = originalSecret;
    cleanupFixture(second);
    cleanupFixture(first);
  });

  await reconcileDeliveredOrder(first.orderId);
  const firstBinding = db.prepare(`
    SELECT binding_id FROM twofa_order_bindings WHERE shop_order_id = ?
  `).get(first.orderId);
  const conflicted = await reconcileDeliveredOrder(second.orderId);
  const bindings = db.prepare(`
    SELECT shop_order_id, status, synced_at
    FROM twofa_order_bindings
    WHERE uurl = ?
    ORDER BY shop_order_id
  `).all('immediate-conflict');

  assert.strictEqual(conflicted.conflicts, 1);
  assert.ok(requests.some(request => (
    request.options.method === 'DELETE'
    && request.url === `https://twofa.example.test/api/internal/tma/twofa-bindings/${encodeURIComponent(firstBinding.binding_id)}`
  )));
  assert.deepStrictEqual(bindings, [
    { shop_order_id: first.orderId, status: 'conflict', synced_at: null },
    { shop_order_id: second.orderId, status: 'conflict', synced_at: null },
  ]);
});

test('reconcile phục hồi binding conflict còn lại khi duplicate được gỡ', async (t) => {
  const first = seedDeliveredOrder({ accounts: ['https://order.subhub.vn/recovery-uurl'] });
  const second = seedDeliveredOrder({ accounts: ['https://order.subhub.vn/recovery-uurl'] });
  const originalFetch = global.fetch;
  const originalUrl = config.TWOFA_INTERNAL_URL;
  const originalSecret = config.TWOFA_TMA_SHARED_SECRET;
  t.after(() => {
    global.fetch = originalFetch;
    config.TWOFA_INTERNAL_URL = originalUrl;
    config.TWOFA_TMA_SHARED_SECRET = originalSecret;
    cleanupFixture(second);
    cleanupFixture(first);
  });

  await reconcileDeliveredOrder(first.orderId, { register: false });
  await reconcileDeliveredOrder(second.orderId, { register: false });
  db.prepare('UPDATE orders SET delivered_keys_json = ? WHERE id = ?').run('[]', first.orderId);

  await reconcileDeliveredOrder(first.orderId, { register: false });
  const statuses = db.prepare(`
    SELECT shop_order_id, status FROM twofa_order_bindings WHERE uurl = ? ORDER BY shop_order_id
  `).all('recovery-uurl');

  assert.deepStrictEqual(statuses, [
    { shop_order_id: first.orderId, status: 'inactive' },
    { shop_order_id: second.orderId, status: 'pending' },
  ]);

  config.TWOFA_INTERNAL_URL = 'https://twofa.example.test';
  config.TWOFA_TMA_SHARED_SECRET = 'shared-secret';
  global.fetch = async () => new Response(
    JSON.stringify({ success: true, data: { status: 'active' } }),
    { status: 200 },
  );
  const recovered = await reconcileDeliveredOrder(second.orderId);

  assert.strictEqual(recovered.active, 1);
  assert.strictEqual(
    db.prepare('SELECT status FROM twofa_order_bindings WHERE shop_order_id = ?').get(second.orderId).status,
    'active',
  );
});

test('retryPendingBindings cap cứng 50 binding mỗi tick', async (t) => {
  const fixture = seedDeliveredOrder({ accounts: [] });
  t.after(() => {
    setReconcileForTest();
    cleanupFixture(fixture);
  });
  const insert = db.prepare(`
    INSERT INTO twofa_order_bindings (
      binding_id, shop_order_id, telegram_user_id, uurl, order_host, order_url, recipient_label
    ) VALUES (?, ?, ?, ?, 'order.subhub.vn', ?, 'Telegram ID ••••6789')
  `);
  for (let index = 0; index < 51; index += 1) {
    insert.run(
      `cap-binding-${index}`,
      fixture.orderId,
      fixture.userId,
      `cap-uurl-${index}`,
      `https://order.subhub.vn/cap-uurl-${index}`,
    );
  }
  let calls = 0;
  setReconcileForTest(async () => {
    calls += 1;
    return { active: 1, failed: 0 };
  });

  const result = await retryPendingBindings(999);

  assert.deepStrictEqual(result, { attempted: 50, active: 50, failed: 0 });
  assert.strictEqual(calls, 50);
});

test('startRetryWorker không tạo timer khi thiếu cấu hình 2FA', (t) => {
  const originalUrl = config.TWOFA_INTERNAL_URL;
  const originalSecret = config.TWOFA_TMA_SHARED_SECRET;
  const originalSetInterval = global.setInterval;
  config.TWOFA_INTERNAL_URL = '';
  config.TWOFA_TMA_SHARED_SECRET = '';
  let timerCount = 0;
  global.setInterval = () => {
    timerCount += 1;
    return { unref() {} };
  };
  t.after(() => {
    global.setInterval = originalSetInterval;
    config.TWOFA_INTERNAL_URL = originalUrl;
    config.TWOFA_TMA_SHARED_SECRET = originalSecret;
  });

  const stop = startRetryWorker({ intervalMs: 1 });

  assert.strictEqual(timerCount, 0);
  assert.doesNotThrow(stop);
});
