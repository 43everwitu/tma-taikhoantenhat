const assert = require('node:assert/strict');
const test = require('node:test');

const {
  extractTwofaOrderLinks,
  maskTelegramRecipient,
  reconcileDeliveredOrder,
} = require('../../src/services/twofaBindingService');
const config = require('../../src/config');
const db = require('../../src/database');
const { signPayload } = require('../../src/services/twofaIntegrationAuth');

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
    'https://order.taikhoantenhat.com.evil.test/abc123',
  ]);

  assert.deepStrictEqual(links, [{
    uurl: 'abc123',
    host: 'order.taikhoantenhat.com',
    orderUrl: 'https://order.taikhoantenhat.com/abc123',
  }]);
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
    return new Response(JSON.stringify({ status: 'active' }), { status: 200 });
  };

  const result = await reconcileDeliveredOrder(fixture.orderId);

  assert.strictEqual(result.active, 1);
  assert.strictEqual(request.url, 'https://twofa.example.test/api/internal/tma/twofa-bindings');
  assert.ok(Buffer.isBuffer(request.options.body));
  assert.strictEqual(
    request.options.headers['x-tma-signature'],
    signPayload('shared-secret', request.options.headers['x-tma-timestamp'], request.options.body),
  );
  assert.strictEqual(JSON.parse(request.options.body.toString()).uurl, 'register-uurl');
});
