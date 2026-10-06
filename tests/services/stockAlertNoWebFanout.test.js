const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const { NotificationService } = require('../../src/services/notificationService');
const telegramApiClient = require('../../src/services/telegramApiClient');
const subscriptions = require('../../src/services/variantStockSubscriptionService');

// notifyStockReplenished broadcasts to every real row in `users`, so
// telegramApiClient MUST be mocked — never let a test reach the real Telegram API.
function mockTelegramSend() {
  const sent = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    sent.push({ chatId: payload.chat_id, body: payload.text });
    return { message_id: sent.length };
  });
  return sent;
}

function seed() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userTg = 970_000_000 + Math.floor(Math.random() * 90000);
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(userTg, `fanout_user_${suffix}`, 'Fanout User');
  const category = db.prepare('INSERT INTO categories (name, slug, emoji) VALUES (?, ?, ?)').run(`FANOUT_CAT_${suffix}`, `fanout-cat-${suffix}`, 'T');
  const product = db.prepare('INSERT INTO products (category_id, name, slug, price, emoji, is_active) VALUES (?, ?, ?, ?, ?, 1)')
    .run(category.lastInsertRowid, 'Fanout Product', `fanout-product-${suffix.replace('_', '-')}`, 100000, '🔔');
  const variant = db.prepare('INSERT INTO product_variants (product_id, name, price, is_active) VALUES (?, ?, ?, 1)')
    .run(product.lastInsertRowid, 'Goi 1 thang', 150000);
  return { userTg, categoryId: category.lastInsertRowid, productId: product.lastInsertRowid, variantId: variant.lastInsertRowid };
}

function cleanup(s) {
  db.prepare("DELETE FROM notifications WHERE type = 'stock_alert' AND data LIKE ?").run(`%"product_id":${s.productId}%`);
  db.prepare('DELETE FROM variant_stock_subscriptions WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM low_stock_alert_states WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(s.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(s.categoryId);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(s.userTg);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(s.userTg);
}

const stockAlertRows = (productId) => db.prepare(
  "SELECT COUNT(*) AS c FROM notifications WHERE type = 'stock_alert' AND data LIKE ?",
).get(`%"product_id":${productId}%`).c;

test('restock broadcast goes to Telegram only and creates no in-app row per user', async (t) => {
  const s = seed();
  const sent = mockTelegramSend();
  t.after(() => { telegramApiClient.setTelegramRequestForTest(null); cleanup(s); });
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)').run(s.productId, s.variantId, 'key-1');

  const service = new NotificationService({ botInfo: { username: 'test_shop_bot' } });
  const result = await service.notifyStockReplenished(s.productId, s.variantId);

  assert.ok(result.sent >= 1);
  assert.ok(sent.some((call) => call.chatId === s.userTg), 'seeded user still gets the Telegram message');
  assert.strictEqual(stockAlertRows(s.productId), 0, 'no per-user in-app rows for the broadcast');
});

test('opted-in subscribers still get a Telegram message and one in-app row', async (t) => {
  const s = seed();
  const sent = mockTelegramSend();
  t.after(() => { telegramApiClient.setTelegramRequestForTest(null); cleanup(s); });
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)').run(s.productId, s.variantId, 'key-1');
  subscriptions.subscribe(s.userTg, s.variantId);

  const service = new NotificationService({ botInfo: { username: 'test_shop_bot' } });
  const result = await service.notifySubscribers(s.variantId);

  assert.strictEqual(result.sent, 1);
  assert.deepStrictEqual(sent.map((c) => c.chatId), [s.userTg]);
  assert.strictEqual(stockAlertRows(s.productId), 1);
  const row = db.prepare("SELECT user_id, channel FROM notifications WHERE type = 'stock_alert' AND data LIKE ?").get(`%"product_id":${s.productId}%`);
  assert.strictEqual(row.user_id, s.userTg);
});
