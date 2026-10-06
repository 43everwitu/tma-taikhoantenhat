const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const { NotificationService } = require('../../src/services/notificationService');
const telegramApiClient = require('../../src/services/telegramApiClient');
const subscriptions = require('../../src/services/variantStockSubscriptionService');
const userNotificationPreferenceService = require('../../src/services/userNotificationPreferenceService');

// Restock broadcasts reach every real row in `users` — telegramApiClient MUST
// be mocked so a test can never hit the real Telegram API.
function mockTelegramSend(failFor = new Set()) {
  const sent = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    if (failFor.has(payload.chat_id)) throw new Error('Too Many Requests: retry later');
    sent.push({ chatId: payload.chat_id, body: payload.text });
    return { message_id: sent.length };
  });
  return sent;
}

function newService() {
  return new NotificationService({ botInfo: { username: 'test_shop_bot' } }, { pacingMs: 0 });
}

function seed() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const base = 960_000_000 + Math.floor(Math.random() * 90000) * 10;
  const users = { follower: base + 1, plain: base + 2, muted: base + 3 };
  Object.entries(users).forEach(([name, id]) => {
    db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(id, `demand_${name}_${suffix}`, `Demand ${name}`);
  });
  userNotificationPreferenceService.setTelegramMarketingEnabled(users.muted, false);
  const category = db.prepare('INSERT INTO categories (name, slug, emoji) VALUES (?, ?, ?)').run(`DEMAND_CAT_${suffix}`, `demand-cat-${suffix}`, 'T');
  const slug = `demand-product-${suffix.replace('_', '-')}`;
  const product = db.prepare('INSERT INTO products (category_id, name, slug, price, emoji, is_active) VALUES (?, ?, ?, ?, ?, 1)')
    .run(category.lastInsertRowid, `Demand Product ${suffix}`, slug, 100000, '🔔');
  const v1 = db.prepare('INSERT INTO product_variants (product_id, name, price, is_active) VALUES (?, ?, ?, 1)').run(product.lastInsertRowid, 'Goi A', 150000);
  const v2 = db.prepare('INSERT INTO product_variants (product_id, name, price, is_active) VALUES (?, ?, ?, 1)').run(product.lastInsertRowid, 'Goi B', 350000);
  return {
    suffix, slug, users,
    categoryId: category.lastInsertRowid, productId: product.lastInsertRowid,
    v1: v1.lastInsertRowid, v2: v2.lastInsertRowid,
  };
}

function cleanup(s) {
  const ids = Object.values(s.users);
  db.prepare(`DELETE FROM notifications WHERE user_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  db.prepare("DELETE FROM notifications WHERE type = 'stock_alert' AND data LIKE ?").run(`%"product_id":${s.productId}%`);
  db.prepare('DELETE FROM variant_stock_subscriptions WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM low_stock_alert_states WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(s.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(s.categoryId);
  db.prepare(`DELETE FROM users WHERE telegram_id IN (${ids.map(() => '?').join(',')})`).run(...ids);
}

const addKey = (s, variantId, data = 'key') => db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)').run(s.productId, variantId, data);
const webRows = (userId, productId) => db.prepare("SELECT * FROM notifications WHERE user_id = ? AND type = 'stock_alert' AND data LIKE ?").all(userId, `%"product_id":${productId}%`);
const subRow = (userId, variantId) => db.prepare('SELECT * FROM variant_stock_subscriptions WHERE user_id = ? AND variant_id = ?').get(userId, variantId);

test('subscription keeps history: markNotified hides it from waiting lists, resubscribe reactivates, unsubscribe deletes', (t) => {
  const s = seed(); t.after(() => cleanup(s));
  subscriptions.subscribe(s.users.follower, s.v1);
  assert.deepStrictEqual(subscriptions.listSubscribedVariantIds(s.users.follower, s.productId), [s.v1]);
  assert.deepStrictEqual(subscriptions.listFollowerIds({ productId: s.productId, variantId: s.v1 }), [s.users.follower]);

  subscriptions.markNotified(s.users.follower, s.v1);
  assert.ok(subRow(s.users.follower, s.v1).notified_at, 'row kept with notified_at');
  assert.deepStrictEqual(subscriptions.listSubscribedVariantIds(s.users.follower, s.productId), []);
  assert.deepStrictEqual(subscriptions.listSubscriberIds(s.v1), []);
  assert.deepStrictEqual(subscriptions.listFollowerIds({ productId: s.productId, variantId: s.v1 }), []);

  subscriptions.subscribe(s.users.follower, s.v1);
  assert.strictEqual(subRow(s.users.follower, s.v1).notified_at, null);
  assert.deepStrictEqual(subscriptions.listSubscriberIds(s.v1), [s.users.follower]);

  subscriptions.unsubscribe(s.users.follower, s.v1);
  assert.strictEqual(subRow(s.users.follower, s.v1), undefined);
});

test('markNotifiedForVariant marks only waiting rows of that variant', (t) => {
  const s = seed(); t.after(() => cleanup(s));
  subscriptions.subscribe(s.users.follower, s.v1);
  subscriptions.subscribe(s.users.plain, s.v1);
  subscriptions.subscribe(s.users.follower, s.v2);
  subscriptions.markNotifiedForVariant(s.v1);
  assert.ok(subRow(s.users.follower, s.v1).notified_at);
  assert.ok(subRow(s.users.plain, s.v1).notified_at);
  assert.strictEqual(subRow(s.users.follower, s.v2).notified_at, null);
});

test('listFollowerIds without a variant covers any variant of the product', (t) => {
  const s = seed(); t.after(() => cleanup(s));
  subscriptions.subscribe(s.users.follower, s.v1);
  subscriptions.subscribe(s.users.plain, s.v2);
  subscriptions.subscribe(s.users.plain, s.v1);
  assert.deepStrictEqual(subscriptions.listFollowerIds({ productId: s.productId }).sort(), [s.users.follower, s.users.plain].sort());
  assert.deepStrictEqual(subscriptions.listFollowerIds({ productId: s.productId, variantId: s.v2 }), [s.users.plain]);
});

test('restock broadcast: Telegram to everyone except /thongbao-off users, in-app row only for followers', async (t) => {
  const s = seed();
  const sent = mockTelegramSend();
  t.after(() => { telegramApiClient.setTelegramRequestForTest(null); cleanup(s); });
  addKey(s, s.v1);
  subscriptions.subscribe(s.users.follower, s.v1);
  subscriptions.subscribe(s.users.muted, s.v1);

  const result = await newService().notifyStockReplenished(s.productId, s.v1);

  assert.ok(result.sent >= 2);
  const chats = new Set(sent.map((c) => c.chatId));
  assert.ok(chats.has(s.users.follower), 'follower gets Telegram');
  assert.ok(chats.has(s.users.plain), 'non-follower still gets Telegram');
  assert.ok(!chats.has(s.users.muted), 'user who turned notifications off gets no Telegram');

  assert.strictEqual(webRows(s.users.follower, s.productId).length, 1);
  assert.strictEqual(webRows(s.users.muted, s.productId).length, 1, 'follower with Telegram off still gets the in-app row');
  assert.strictEqual(webRows(s.users.plain, s.productId).length, 0, 'non-follower gets no in-app row');

  const data = JSON.parse(webRows(s.users.follower, s.productId)[0].data);
  assert.strictEqual(data.product_id, s.productId);
  assert.strictEqual(data.variant_id, s.v1);
  assert.strictEqual(data.product_slug, s.slug);
});

test('restock broadcast without a variant gives in-app rows to followers of any variant', async (t) => {
  const s = seed();
  mockTelegramSend();
  t.after(() => { telegramApiClient.setTelegramRequestForTest(null); cleanup(s); });
  addKey(s, s.v2);
  subscriptions.subscribe(s.users.follower, s.v2);

  await newService().notifyStockReplenished(s.productId);

  assert.strictEqual(webRows(s.users.follower, s.productId).length, 1);
  assert.strictEqual(webRows(s.users.plain, s.productId).length, 0);
});

test('notifySubscribers marks delivered subscriptions as notified instead of deleting them', async (t) => {
  const s = seed();
  const sent = mockTelegramSend();
  t.after(() => { telegramApiClient.setTelegramRequestForTest(null); cleanup(s); });
  addKey(s, s.v1);
  subscriptions.subscribe(s.users.follower, s.v1);

  const result = await newService().notifySubscribers(s.v1);

  assert.strictEqual(result.sent, 1);
  assert.deepStrictEqual(sent.map((c) => c.chatId), [s.users.follower]);
  assert.ok(subRow(s.users.follower, s.v1).notified_at);
  assert.strictEqual(webRows(s.users.follower, s.productId).length, 1);
});

test('notifySubscribers: Telegram-off follower gets the in-app row once and counts as notified', async (t) => {
  const s = seed();
  const sent = mockTelegramSend();
  t.after(() => { telegramApiClient.setTelegramRequestForTest(null); cleanup(s); });
  addKey(s, s.v1);
  subscriptions.subscribe(s.users.muted, s.v1);

  const service = newService();
  const first = await service.notifySubscribers(s.v1);
  assert.strictEqual(first.sent, 1);
  assert.deepStrictEqual(sent, []);
  assert.ok(subRow(s.users.muted, s.v1).notified_at);
  const again = await service.notifySubscribers(s.v1);
  assert.strictEqual(again.skipped, 'no_subscribers');
  assert.strictEqual(webRows(s.users.muted, s.productId).length, 1, 'no duplicate in-app row');
});

test('notifySubscribers keeps a waiting subscription when the Telegram send fails', async (t) => {
  const s = seed();
  mockTelegramSend(new Set([s.users.follower]));
  t.after(() => { telegramApiClient.setTelegramRequestForTest(null); cleanup(s); });
  addKey(s, s.v1);
  subscriptions.subscribe(s.users.follower, s.v1);

  const result = await newService().notifySubscribers(s.v1);

  assert.strictEqual(result.failed, 1);
  assert.strictEqual(subRow(s.users.follower, s.v1).notified_at, null);
});

test('getDemand aggregates waiting and recently notified per product and variant, most wanted first', (t) => {
  const s = seed(); t.after(() => cleanup(s));
  addKey(s, s.v1); addKey(s, s.v1);
  subscriptions.subscribe(s.users.follower, s.v2);
  subscriptions.subscribe(s.users.plain, s.v2);
  subscriptions.subscribe(s.users.muted, s.v2);
  subscriptions.subscribe(s.users.follower, s.v1);
  subscriptions.subscribe(s.users.plain, s.v1);
  subscriptions.markNotified(s.users.plain, s.v1);

  const demand = subscriptions.getDemand({ days: 30 });
  const product = demand.find((p) => p.productId === s.productId);
  assert.ok(product);
  assert.strictEqual(product.name.startsWith('Demand Product'), true);
  assert.strictEqual(product.waiting, 4);
  assert.strictEqual(product.notifiedRecent, 1);
  assert.deepStrictEqual(product.variants.map((v) => [v.variantId, v.waiting, v.notifiedRecent, v.stock]), [
    [s.v2, 3, 0, 0],
    [s.v1, 1, 1, 2],
  ]);
  assert.ok(product.variants[0].lastSubscribedAt);
  assert.strictEqual(product.slug, s.slug);

  const waitings = demand.map((p) => p.waiting);
  assert.deepStrictEqual(waitings, [...waitings].sort((a, b) => b - a), 'sorted by waiting desc');
});

test('getDemand ignores variants without any recent activity and old notified rows', (t) => {
  const s = seed(); t.after(() => cleanup(s));
  subscriptions.subscribe(s.users.plain, s.v1);
  subscriptions.markNotified(s.users.plain, s.v1);
  db.prepare("UPDATE variant_stock_subscriptions SET notified_at = datetime('now', '-45 days') WHERE variant_id = ?").run(s.v1);
  assert.strictEqual(subscriptions.getDemand({ days: 30 }).find((p) => p.productId === s.productId), undefined);
  assert.ok(subscriptions.getDemand({ days: 90 }).find((p) => p.productId === s.productId));
});

test('broadcast stores the announcement once and creates no per-user in-app rows', async (t) => {
  const title = `FANOUT_TITLE_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  let announcementId = null;
  t.after(() => {
    if (announcementId) db.prepare('DELETE FROM announcements WHERE id = ?').run(announcementId);
    db.prepare('DELETE FROM notifications WHERE title = ?').run(title);
  });
  // target 'web' sends no Telegram at all, so nothing can reach a real chat.
  const adminId = db.prepare('SELECT id FROM admins ORDER BY id LIMIT 1').get().id;
  const result = await newService().broadcast(title, 'body', 'web', adminId);
  announcementId = result.announcementId;

  assert.ok(db.prepare('SELECT 1 FROM announcements WHERE id = ?').get(announcementId));
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE title = ?').get(title).c, 0);
});
