const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const telegramApiClient = require('../../src/services/telegramApiClient');

function makeFakeBot(sent, control = {}) {
  return {
    telegram: {
      async sendMessage(chatId, message, opts) {
        if (control.fail) throw new Error('telegram unavailable');
        sent.push({ chatId, message, opts });
      },
    },
  };
}

function seedLowStockVariant() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `notify-variant-cat-${suffix}`,
    `notify-variant-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, last_low_stock_alert_at)
    VALUES (?, ?, ?, 1000, 1, 5, NULL)
  `).run(category.lastInsertRowid, `Notify variant product ${suffix}`, `notify-variant-product-${suffix}`);
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
    VALUES (?, ?, 1000, 1, 0)
  `).run(product.lastInsertRowid, `Notify variant ${suffix}`);
  for (let i = 0; i < 3; i++) {
    db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)')
      .run(product.lastInsertRowid, variant.lastInsertRowid, `variant-key-${i}-${suffix}`);
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('notify_admin_low_stock','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_chat_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_thread_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_alert_threshold','5') ON CONFLICT(key) DO UPDATE SET value='5'").run();

  return {
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    productName: `Notify variant product ${suffix}`,
    variantId: variant.lastInsertRowid,
    variantName: `Notify variant ${suffix}`,
  };
}

function cleanup(seed) {
  db.prepare('DELETE FROM low_stock_alert_states WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
}

function loadServiceFresh(fakeBot) {
  delete require.cache[require.resolve('../../src/services/adminNotifyService')];
  delete require.cache[require.resolve('../../src/services/notificationService')];
  delete require.cache[require.resolve('../../src/services/lowStockQuery')];
  const adminNotify = require('../../src/services/adminNotifyService');
  const { NotificationService } = require('../../src/services/notificationService');
  adminNotify.init(fakeBot);
  adminNotify.invalidateCache();
  // adminNotifyService.notify() always sends through telegramApiClient (real
  // Telegram HTTPS calls), never through the bot instance passed to init() —
  // route it back into fakeBot so nothing here reaches production.
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    await fakeBot.telegram.sendMessage(payload.chat_id, payload.text, payload);
    return { message_id: 1 };
  });
  return new NotificationService(fakeBot);
}

test('checkLowStock sends variant-specific Telegram message and done callback', async (t) => {
  const seed = seedLowStockVariant();
  t.after(() => { telegramApiClient.setTelegramRequestForTest(null); cleanup(seed); });
  const sent = [];
  const originalWebUrl = process.env.WEB_URL;
  process.env.WEB_URL = 'https://tenhatshop.taikhoantenhat.me';
  t.after(() => {
    if (originalWebUrl === undefined) delete process.env.WEB_URL;
    else process.env.WEB_URL = originalWebUrl;
  });

  const svc = loadServiceFresh(makeFakeBot(sent));
  await svc.checkLowStock();

  const alert = sent.find((item) => String(item.message || '').includes(seed.variantName));
  assert.ok(alert, `expected alert to mention variant ${seed.variantName}`);
  assert.ok(String(alert.message).includes(`<code>${seed.variantId}</code>`), 'expected variant id in message');
  const buttons = alert.opts.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((button) => button.callback_data === `lowstock_done:v:${seed.variantId}`));

  const state = db.prepare('SELECT last_alert_at FROM low_stock_alert_states WHERE target_key = ?').get(`v:${seed.variantId}`);
  assert.ok(state?.last_alert_at, 'expected variant alert marker');
});

test('checkLowStock sends one out-of-stock alert despite active snooze', async (t) => {
  const seed = seedLowStockVariant();
  t.after(() => { telegramApiClient.setTelegramRequestForTest(null); cleanup(seed); });
  const sent = [];
  const config = require('../../src/config');
  const originalWebUrl = config.WEB_URL;
  config.WEB_URL = 'https://tenhatshop.taikhoantenhat.me';
  t.after(() => { config.WEB_URL = originalWebUrl; });

  const svc = loadServiceFresh(makeFakeBot(sent));
  await svc.checkLowStock();
  db.prepare(`
    UPDATE low_stock_alert_states
    SET snoozed_until = datetime('now', '+24 hours')
    WHERE target_key = ?
  `).run(`v:${seed.variantId}`);
  db.prepare('UPDATE stock SET is_sold = 1 WHERE variant_id = ?').run(seed.variantId);

  sent.length = 0;
  await svc.checkLowStock();

  const alert = sent.find((item) => String(item.message || '').includes('Hết hàng'));
  assert.ok(alert, 'expected out-of-stock alert');
  assert.ok(String(alert.message).includes(seed.variantName));
  const buttons = alert.opts.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((button) => button.callback_data === `outstock_done:v:${seed.variantId}`));
  assert.ok(buttons.some((button) => String(button.url || '').includes(`variantId=${seed.variantId}`)));

  const state = db.prepare(`
    SELECT snoozed_until, out_of_stock_alert_at
    FROM low_stock_alert_states
    WHERE target_key = ?
  `).get(`v:${seed.variantId}`);
  assert.ok(state?.snoozed_until, 'low-stock snooze should remain unchanged');
  assert.ok(state?.out_of_stock_alert_at, 'expected out-of-stock marker');

  sent.length = 0;
  await svc.checkLowStock();
  assert.strictEqual(sent.some((item) => String(item.message || '').includes('Hết hàng')), false);
});

test('checkLowStock retries out-of-stock alert after Telegram failure', async (t) => {
  const seed = seedLowStockVariant();
  t.after(() => { telegramApiClient.setTelegramRequestForTest(null); cleanup(seed); });
  const sent = [];
  const control = { fail: false };
  const svc = loadServiceFresh(makeFakeBot(sent, control));

  await svc.checkLowStock();
  db.prepare('UPDATE stock SET is_sold = 1 WHERE variant_id = ?').run(seed.variantId);
  control.fail = true;
  await svc.checkLowStock();

  const state = db.prepare(`
    SELECT out_of_stock_alert_at
    FROM low_stock_alert_states
    WHERE target_key = ?
  `).get(`v:${seed.variantId}`);
  assert.strictEqual(state?.out_of_stock_alert_at ?? null, null);
});
