const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const { NotificationService } = require('../../src/services/notificationService');
const telegramApiClient = require('../../src/services/telegramApiClient');
const subscriptions = require('../../src/services/variantStockSubscriptionService');

// notifySubscribers only targets subscribed users, but telegramApiClient MUST
// still be mocked — never let a test hit the real Telegram API.
function mockTelegramSend(failFor = new Set()) {
  const sent = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    if (failFor.has(payload.chat_id)) throw new Error('Too Many Requests: retry later');
    sent.push({ chatId: payload.chat_id, body: payload.text, extra: payload });
    return { message_id: sent.length };
  });
  return sent;
}

function seed() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const base = 980_000_000 + Math.floor(Math.random() * 90000) * 10;
  const users = [base + 1, base + 2, base + 3];
  users.forEach((id, i) => {
    db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(id, `sub_user_${i}_${suffix}`, 'Sub User');
  });
  const category = db.prepare('INSERT INTO categories (name, slug, emoji) VALUES (?, ?, ?)').run(`SUB_CAT_${suffix}`, `sub-cat-${suffix}`, 'T');
  const slug = `sub-product-${suffix.replace('_', '-')}`;
  const product = db.prepare('INSERT INTO products (category_id, name, slug, price, emoji, is_active) VALUES (?, ?, ?, ?, ?, 1)')
    .run(category.lastInsertRowid, 'Sub Product', slug, 100000, '🔔');
  const variant = db.prepare('INSERT INTO product_variants (product_id, name, price, is_active) VALUES (?, ?, ?, 1)')
    .run(product.lastInsertRowid, 'Goi 1 thang', 150000);
  const other = db.prepare('INSERT INTO product_variants (product_id, name, price, is_active) VALUES (?, ?, ?, 1)')
    .run(product.lastInsertRowid, 'Goi 3 thang', 350000);
  return {
    users, slug,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    variantId: variant.lastInsertRowid,
    otherVariantId: other.lastInsertRowid,
  };
}

function cleanup(seedData) {
  db.prepare("DELETE FROM notifications WHERE type = 'stock_alert' AND data LIKE ?").run(`%"product_id":${seedData.productId}%`);
  db.prepare('DELETE FROM variant_stock_subscriptions WHERE product_id = ?').run(seedData.productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(seedData.productId);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(seedData.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seedData.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seedData.categoryId);
  for (const id of seedData.users) db.prepare('DELETE FROM users WHERE telegram_id = ?').run(id);
}

function setup(t) {
  const data = seed();
  t.after(() => { telegramApiClient.setTelegramRequestForTest(null); cleanup(data); });
  return data;
}

test('subscribe is idempotent and unsubscribe removes the row', (t) => {
  const s = setup(t);
  subscriptions.subscribe(s.users[0], s.variantId);
  subscriptions.subscribe(s.users[0], s.variantId);
  assert.deepStrictEqual(subscriptions.listSubscribedVariantIds(s.users[0], s.productId), [s.variantId]);
  subscriptions.unsubscribe(s.users[0], s.variantId);
  assert.deepStrictEqual(subscriptions.listSubscribedVariantIds(s.users[0], s.productId), []);
});

test('subscribe rejects unknown variant', (t) => {
  const s = setup(t);
  assert.strictEqual(subscriptions.subscribe(s.users[0], 999_999_999), null);
});

test('notifySubscribers messages only subscribers of that variant, with product deep link, then clears them', async (t) => {
  const s = setup(t);
  const sent = mockTelegramSend();
  subscriptions.subscribe(s.users[0], s.variantId);
  subscriptions.subscribe(s.users[1], s.variantId);
  subscriptions.subscribe(s.users[2], s.otherVariantId);
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)').run(s.productId, s.variantId, 'key-1');

  const service = new NotificationService({ botInfo: { username: 'test_shop_bot' } });
  const result = await service.notifySubscribers(s.variantId);

  assert.strictEqual(result.sent, 2);
  const chats = sent.map((m) => m.chatId).sort();
  assert.deepStrictEqual(chats, [s.users[0], s.users[1]].sort());
  assert.match(sent[0].body, /Sub Product - Goi 1 thang/);
  assert.match(sent[0].extra.reply_markup.inline_keyboard[0][0].web_app.url, new RegExp(`/san-pham/${s.slug}(\\?|$)`));
  assert.deepStrictEqual(subscriptions.listSubscribedVariantIds(s.users[0], s.productId), []);
  assert.deepStrictEqual(subscriptions.listSubscribedVariantIds(s.users[2], s.productId), [s.otherVariantId]);
});

test('notifySubscribers keeps subscription when telegram send fails transiently', async (t) => {
  const s = setup(t);
  mockTelegramSend(new Set([s.users[0]]));
  subscriptions.subscribe(s.users[0], s.variantId);
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)').run(s.productId, s.variantId, 'key-1');

  const service = new NotificationService({ botInfo: { username: 'test_shop_bot' } });
  const result = await service.notifySubscribers(s.variantId);

  assert.strictEqual(result.sent, 0);
  assert.deepStrictEqual(subscriptions.listSubscribedVariantIds(s.users[0], s.productId), [s.variantId]);
});

test('notifySubscribers does nothing when there are no subscribers', async (t) => {
  const s = setup(t);
  const sent = mockTelegramSend();
  const service = new NotificationService({ botInfo: { username: 'test_shop_bot' } });
  const result = await service.notifySubscribers(s.variantId);
  assert.strictEqual(result.total, 0);
  assert.strictEqual(sent.length, 0);
});
