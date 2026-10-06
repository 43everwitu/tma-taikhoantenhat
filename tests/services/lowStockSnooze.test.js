const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const telegramApiClient = require('../../src/services/telegramApiClient');

function ensureSnoozeColumn() {
  const has = db.prepare('PRAGMA table_info(products)').all()
    .some((col) => col.name === 'low_stock_snoozed_until');
  if (!has) db.exec('ALTER TABLE products ADD COLUMN low_stock_snoozed_until DATETIME');
}

function seedLowStockProduct(name = 'Snooze Low') {
  ensureSnoozeColumn();
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`snooze-cat-${suffix}`, `snooze-cat-${suffix}`);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, last_low_stock_alert_at, low_stock_snoozed_until)
    VALUES (?, ?, ?, 1000, 1, 5, NULL, NULL)
  `).run(cat.lastInsertRowid, name, `snooze-product-${suffix}`);
  db.prepare("INSERT INTO stock (product_id, data, is_sold) VALUES (?, 'k', 0)").run(product.lastInsertRowid);
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_alert_threshold','5') ON CONFLICT(key) DO UPDATE SET value='5'").run();
  return { productId: product.lastInsertRowid, categoryId: cat.lastInsertRowid };
}

function cleanup(seed) {
  db.prepare('DELETE FROM low_stock_alert_states WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
}

function freshQuery() {
  delete require.cache[require.resolve('../../src/services/lowStockQuery')];
  return require('../../src/services/lowStockQuery');
}

function makeFakeBot(sent) {
  return {
    telegram: {
      async sendMessage(chatId, message, opts) {
        sent.push({ chatId, message, opts });
      },
    },
  };
}

function loadNotificationService(fakeBot) {
  delete require.cache[require.resolve('../../src/services/adminNotifyService')];
  delete require.cache[require.resolve('../../src/services/notificationService')];
  delete require.cache[require.resolve('../../src/services/lowStockQuery')];
  const adminNotifyService = require('../../src/services/adminNotifyService');
  const { NotificationService } = require('../../src/services/notificationService');
  db.prepare("INSERT INTO settings (key, value) VALUES ('notify_admin_low_stock','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_chat_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_thread_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  adminNotifyService.init(fakeBot);
  adminNotifyService.invalidateCache();
  // adminNotifyService.notify() always sends through telegramApiClient (real
  // Telegram HTTPS calls), never through the bot instance passed to init() —
  // route it back into fakeBot so nothing here reaches production.
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    await fakeBot.telegram.sendMessage(payload.chat_id, payload.text, payload);
    return { message_id: 1 };
  });
  return new NotificationService(fakeBot);
}

test('effectiveLowStockProducts skips products snoozed for the next 24 hours', () => {
  const seed = seedLowStockProduct();
  try {
    db.prepare("UPDATE products SET low_stock_snoozed_until = datetime('now', '+24 hours') WHERE id = ?").run(seed.productId);
    const { effectiveLowStockProducts } = freshQuery();
    const rows = effectiveLowStockProducts();
    assert.strictEqual(rows.some((row) => row.id === seed.productId), false);
  } finally {
    cleanup(seed);
  }
});

test('effectiveLowStockProducts includes low stock products after snooze expires', () => {
  const seed = seedLowStockProduct();
  try {
    db.prepare("UPDATE products SET low_stock_snoozed_until = datetime('now', '-1 minute') WHERE id = ?").run(seed.productId);
    const { effectiveLowStockProducts } = freshQuery();
    const rows = effectiveLowStockProducts();
    assert.strictEqual(rows.some((row) => row.id === seed.productId), true);
  } finally {
    cleanup(seed);
  }
});

test('checkLowStock adds done stock callback button to Telegram alert', async () => {
  const seed = seedLowStockProduct('Button Low');
  const sent = [];
  const originalWebUrl = process.env.WEB_URL;
  process.env.WEB_URL = 'https://tenhatshop.taikhoantenhat.me';
  try {
    const svc = loadNotificationService(makeFakeBot(sent));
    await svc.checkLowStock();
    const alert = sent.find((item) => String(item.message || '').includes(`<code>${seed.productId}</code>`));
    assert.ok(alert, 'expected low-stock alert for seeded product');
    const keyboard = alert.opts.reply_markup.inline_keyboard.flat();
    assert.ok(keyboard.some((button) => button.text === `📥 Thêm kho cho #${seed.productId}` && button.url));
    assert.ok(keyboard.some((button) => button.text === '✅ Đã up Stock' && button.callback_data === `lowstock_done:p:${seed.productId}`));
  } finally {
    telegramApiClient.setTelegramRequestForTest(null);
    if (originalWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = originalWebUrl;
    cleanup(seed);
  }
});
