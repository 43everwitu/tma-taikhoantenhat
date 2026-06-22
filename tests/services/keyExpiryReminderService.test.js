const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function seedDueReminder() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 895_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('key_expiry_reminder_days', '3');
  db.prepare("UPDATE message_templates SET is_enabled = 1 WHERE key = 'bot.expiry_reminder'").run();
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Reminder User ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `reminder-cat-${suffix}`,
    `reminder-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Reminder product ${suffix}`, `reminder-product-${suffix}`);
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, default_duration_days)
    VALUES (?, 'Reminder variant', 1000, 30)
  `).run(product.lastInsertRowid);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, variant_id, quantity, total_price, payment_code, status, source, delivered_at, delivered_keys_json)
    VALUES (?, ?, ?, 1, 1000, ?, 'delivered', 'telegram', datetime('now', '-27 days'), ?)
  `).run(userId, product.lastInsertRowid, variant.lastInsertRowid, `PNS_REMINDER_${suffix}`, JSON.stringify([`key-${suffix}`]));
  const stock = db.prepare(`
    INSERT INTO stock (product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at)
    VALUES (?, ?, ?, 30, 1, ?, datetime('now', '-27 days'))
  `).run(product.lastInsertRowid, variant.lastInsertRowid, `key-${suffix}`, userId);

  return {
    userId,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    variantId: variant.lastInsertRowid,
    productSlug: `reminder-product-${suffix}`,
    orderId: order.lastInsertRowid,
    stockId: stock.lastInsertRowid,
  };
}

function cleanup(seed) {
  const hasLogs = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'renewal_reminder_logs'").get();
  if (hasLogs) db.prepare('DELETE FROM renewal_reminder_logs WHERE stock_id = ?').run(seed.stockId);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(seed.userId);
  db.prepare('DELETE FROM stock WHERE id = ?').run(seed.stockId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(seed.orderId);
  db.prepare('DELETE FROM product_variants WHERE id = ?').run(seed.variantId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(seed.userId);
}

function freshService() {
  delete require.cache[require.resolve('../../src/services/keyExpiryReminderService')];
  delete require.cache[require.resolve('../../src/services/orderExpiryService')];
  return require('../../src/services/keyExpiryReminderService');
}

test('sweep sends Telegram reminder, creates TMA notification, and logs delivery', async (t) => {
  const seed = seedDueReminder();
  t.after(() => cleanup(seed));
  const sent = [];
  const service = freshService();
  service.init({
    telegram: {
      async sendMessage(chatId, body, opts) {
        sent.push({ chatId, body, opts });
      },
    },
  });

  const result = await service.sweep();

  assert.deepStrictEqual(result, {
    scanned: 1,
    sent: 1,
    skipped: 0,
    failed: 0,
    exhausted: 0,
  });
  assert.strictEqual(result.sent, 1);
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].chatId, seed.userId);

  const notification = db.prepare(`
    SELECT * FROM notifications
    WHERE user_id = ? AND type = 'renewal_reminder'
    ORDER BY id DESC LIMIT 1
  `).get(seed.userId);
  assert.ok(notification, 'expected renewal reminder web notification');
  const data = JSON.parse(notification.data);
  assert.strictEqual(data.renewUrl, `/san-pham/${seed.productSlug}?renewFromOrderId=${seed.orderId}`);
  assert.strictEqual(data.orderUrl, `/don-hang/${seed.orderId}`);

  const log = db.prepare('SELECT * FROM renewal_reminder_logs WHERE stock_id = ?').get(seed.stockId);
  assert.ok(log, 'expected renewal reminder log row');
  assert.strictEqual(log.status, 'sent');
  assert.strictEqual(log.telegram_sent, 1);
  assert.strictEqual(log.web_notification_id, notification.id);

  const stock = db.prepare('SELECT reminder_sent_at FROM stock WHERE id = ?').get(seed.stockId);
  assert.ok(stock.reminder_sent_at, 'expected stock reminder dedupe marker');
});

test('failed Telegram attempt logs failure without marking reminder sent', async (t) => {
  const seed = seedDueReminder();
  t.after(() => cleanup(seed));
  const service = freshService();
  service.init({
    telegram: {
      async sendMessage() {
        throw new Error('Telegram unavailable');
      },
    },
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  let result;
  try {
    result = await service.sweep();
  } finally {
    console.error = originalConsoleError;
  }

  assert.deepStrictEqual(result, {
    scanned: 1,
    sent: 0,
    skipped: 0,
    failed: 1,
    exhausted: 0,
  });

  const logs = db.prepare(`
    SELECT status, error_message
    FROM renewal_reminder_logs
    WHERE stock_id = ?
  `).all(seed.stockId);
  assert.strictEqual(logs.length, 1);
  assert.strictEqual(logs[0].status, 'failed');
  assert.strictEqual(logs[0].error_message, 'Telegram unavailable');

  const stock = db.prepare('SELECT reminder_sent_at FROM stock WHERE id = ?').get(seed.stockId);
  assert.strictEqual(stock.reminder_sent_at, null);
});

test('three failed attempts become exhausted without a fourth send or duplicate exhausted log', async (t) => {
  const seed = seedDueReminder();
  t.after(() => cleanup(seed));
  let sendAttempts = 0;
  const service = freshService();
  service.init({
    telegram: {
      async sendMessage() {
        sendAttempts++;
        throw new Error(`Telegram failure ${sendAttempts}`);
      },
    },
  });

  const originalConsoleError = console.error;
  console.error = () => {};
  let fourthSweep;
  let laterSweep;
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await service.sweep();
      assert.strictEqual(result.failed, 1);
      assert.strictEqual(result.exhausted, 0);
    }
    fourthSweep = await service.sweep();
    laterSweep = await service.sweep();
  } finally {
    console.error = originalConsoleError;
  }

  assert.strictEqual(sendAttempts, 3);
  assert.deepStrictEqual(fourthSweep, {
    scanned: 1,
    sent: 0,
    skipped: 0,
    failed: 0,
    exhausted: 1,
  });
  assert.deepStrictEqual(laterSweep, {
    scanned: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    exhausted: 0,
  });

  const logs = db.prepare(`
    SELECT status, error_message
    FROM renewal_reminder_logs
    WHERE stock_id = ?
    ORDER BY id
  `).all(seed.stockId);
  assert.strictEqual(logs.filter((log) => log.status === 'failed').length, 3);
  const exhaustedLogs = logs.filter((log) => log.status === 'exhausted');
  assert.strictEqual(exhaustedLogs.length, 1);
  assert.strictEqual(exhaustedLogs[0].error_message, 'Reached 3 failed reminder attempts');

  const stock = db.prepare('SELECT reminder_sent_at FROM stock WHERE id = ?').get(seed.stockId);
  assert.strictEqual(stock.reminder_sent_at, null);
});
