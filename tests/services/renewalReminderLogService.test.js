const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

const renewalReminderLogService = require('../../src/services/renewalReminderLogService');

function seedFixture() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 897_000_000 + Math.floor(Math.random() * 100000);

  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Renewal Log User ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `renewal-log-cat-${suffix}`,
    `renewal-log-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Renewal Log Product ${suffix}`, `renewal-log-product-${suffix}`);
  const stock = db.prepare(`
    INSERT INTO stock (product_id, data, duration_days, is_sold, sold_to, sold_at, reminder_sent_at)
    VALUES (?, ?, 30, 1, ?, datetime('now', '-27 days'), '1900-01-01 00:00:00')
  `).run(product.lastInsertRowid, `renewal-log-key-${suffix}`, userId);

  return {
    userId,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    productName: `Renewal Log Product ${suffix}`,
    stockId: stock.lastInsertRowid,
  };
}

function cleanup(seed) {
  db.prepare('DELETE FROM renewal_reminder_logs WHERE stock_id = ?').run(seed.stockId);
  db.prepare('DELETE FROM stock WHERE id = ?').run(seed.stockId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(seed.userId);
}

function logInput(seed, status) {
  return {
    stockId: seed.stockId,
    userId: seed.userId,
    productId: seed.productId,
    productName: seed.productName,
    status,
  };
}

test('MAX_FAILED_ATTEMPTS remains 3', () => {
  assert.strictEqual(renewalReminderLogService.MAX_FAILED_ATTEMPTS, 3);
});

test('insertLog stores telegramSent true as SQLite integer 1', () => {
  const seed = seedFixture();
  try {
    const result = renewalReminderLogService.insertLog({
      ...logInput(seed, 'sent'),
      telegramSent: true,
    });
    const row = db.prepare(`
      SELECT telegram_sent
      FROM renewal_reminder_logs
      WHERE id = ?
    `).get(result.lastInsertRowid);

    assert.strictEqual(row.telegram_sent, 1);
  } finally {
    cleanup(seed);
  }
});

test('countFailedAttempts counts only failed logs for a stock and ignores sent', () => {
  const seed = seedFixture();
  try {
    renewalReminderLogService.insertLog(logInput(seed, 'failed'));
    renewalReminderLogService.insertLog(logInput(seed, 'failed'));
    renewalReminderLogService.insertLog(logInput(seed, 'sent'));

    assert.strictEqual(renewalReminderLogService.countFailedAttempts(seed.stockId), 2);
  } finally {
    cleanup(seed);
  }
});

test('hasExhausted detects exhausted log for a stock', () => {
  const seed = seedFixture();
  try {
    assert.strictEqual(renewalReminderLogService.hasExhausted(seed.stockId), false);

    renewalReminderLogService.insertLog(logInput(seed, 'exhausted'));

    assert.strictEqual(renewalReminderLogService.hasExhausted(seed.stockId), true);
  } finally {
    cleanup(seed);
  }
});

test('findMissingLegacyLogs finds a reminder_sent_at stock without log', () => {
  const seed = seedFixture();
  try {
    const rows = renewalReminderLogService.findMissingLegacyLogs({ limit: 10 });
    const row = rows.find((item) => item.stock_id === seed.stockId);

    assert.ok(row, 'expected legacy stock without renewal reminder log');
    assert.strictEqual(row.user_id, seed.userId);
    assert.strictEqual(row.product_id, seed.productId);
    assert.strictEqual(row.product_name, seed.productName);
    assert.strictEqual(row.duration_days, 30);
    assert.strictEqual(row.reminder_sent_at, '1900-01-01 00:00:00');

    renewalReminderLogService.insertLog(logInput(seed, 'sent'));

    const afterRows = renewalReminderLogService.findMissingLegacyLogs({ limit: 10 });
    assert.strictEqual(afterRows.some((item) => item.stock_id === seed.stockId), false);
  } finally {
    cleanup(seed);
  }
});
