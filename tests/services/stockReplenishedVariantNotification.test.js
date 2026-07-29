const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const { NotificationService } = require('../../src/services/notificationService');

function createBot() {
  const sent = [];
  return {
    sent,
    botInfo: { username: 'test_shop_bot' },
    telegram: {
      async sendMessage(chatId, body, extra) {
        sent.push({ chatId, body, extra });
      },
    },
  };
}

function seedProduct() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userTg = 990_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(userTg, `stock_user_${suffix}`, 'Stock User');
  const category = db.prepare('INSERT INTO categories (name, slug, emoji) VALUES (?, ?, ?)').run(`STOCK_CAT_${suffix}`, `stock-cat-${suffix}`, 'T');
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, emoji, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(category.lastInsertRowid, 'Tài khoản ChatGPT Plus', `chatgpt-plus-${suffix}`, 111000, '🔔');
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, ?, ?, 1)
  `).run(product.lastInsertRowid, 'Dùng chung 01 tháng', 222000);
  return { userTg, categoryId: category.lastInsertRowid, productId: product.lastInsertRowid, variantId: variant.lastInsertRowid };
}

function cleanup(seed) {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(seed.userTg);
  db.prepare('DELETE FROM low_stock_alert_states WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(seed.userTg);
}

test('notifyStockReplenished renders variant name, variant price, and variant stock count', async (t) => {
  const seed = seedProduct();
  t.after(() => cleanup(seed));
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)').run(seed.productId, seed.variantId, 'key-1');
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)').run(seed.productId, seed.variantId, 'key-2');
  db.prepare('INSERT INTO stock (product_id, data, is_sold) VALUES (?, ?, 0)').run(seed.productId, 'legacy-key');
  db.prepare(`
    INSERT INTO low_stock_alert_states (target_key, target_type, product_id, variant_id, last_alert_at)
    VALUES (?, 'variant', ?, ?, CURRENT_TIMESTAMP)
  `).run(`v:${seed.variantId}`, seed.productId, seed.variantId);

  const bot = createBot();
  const service = new NotificationService(bot);
  const result = await service.notifyStockReplenished(seed.productId, seed.variantId);

  assert.ok(result.sent >= 1);
  const message = bot.sent.find((call) => call.chatId === seed.userTg);
  assert.ok(message, 'expected notification for seeded user');
  assert.match(message.body, /Tài khoản ChatGPT Plus - Dùng chung 01 tháng/);
  assert.match(message.body, /222\.000đ/);
  assert.match(message.body, /Số lượng trong kho:\s*<b>2<\/b>/);

  const state = db.prepare('SELECT last_alert_at FROM low_stock_alert_states WHERE target_key = ?').get(`v:${seed.variantId}`);
  assert.strictEqual(state.last_alert_at, null);
});

test('notifyStockReplenished without variant uses product price and legacy stock count', async (t) => {
  const seed = seedProduct();
  t.after(() => cleanup(seed));
  db.prepare('INSERT INTO stock (product_id, data, is_sold) VALUES (?, ?, 0)').run(seed.productId, 'legacy-key-1');
  db.prepare('INSERT INTO stock (product_id, data, is_sold) VALUES (?, ?, 0)').run(seed.productId, 'legacy-key-2');
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)').run(seed.productId, seed.variantId, 'variant-key');

  const bot = createBot();
  const service = new NotificationService(bot);
  const result = await service.notifyStockReplenished(seed.productId);

  assert.ok(result.sent >= 1);
  const message = bot.sent.find((call) => call.chatId === seed.userTg);
  assert.ok(message, 'expected notification for seeded user');
  assert.match(message.body, /Tài khoản ChatGPT Plus/);
  assert.doesNotMatch(message.body, /Dùng chung 01 tháng/);
  assert.match(message.body, /111\.000đ/);
  assert.match(message.body, /Số lượng trong kho:\s*<b>2<\/b>/);
});
