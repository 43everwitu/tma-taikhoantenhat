const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

const renewalReminderLogService = require('../../src/services/renewalReminderLogService');

function seedFixture() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 898_000_000 + Math.floor(Math.random() * 100000);

  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(
    userId,
    `Backfill Renewal User ${suffix}`,
  );
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `backfill-renewal-cat-${suffix}`,
    `backfill-renewal-cat-${suffix}`,
  );
  const productName = `Backfill Renewal Product ${suffix}`;
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(
    category.lastInsertRowid,
    productName,
    `backfill-renewal-product-${suffix}`,
  );
  const stock = db.prepare(`
    INSERT INTO stock (
      product_id,
      data,
      duration_days,
      is_sold,
      sold_to,
      sold_at,
      reminder_sent_at
    )
    VALUES (?, ?, 30, 1, ?, '2026-05-21 02:00:00', '2026-06-20 02:00:00')
  `).run(product.lastInsertRowid, `backfill-renewal-key-${suffix}`, userId);

  return {
    userId,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    productName,
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

function hideExistingMissingRows() {
  const rows = renewalReminderLogService.findMissingLegacyLogs({ limit: 1_000_000 });
  for (const row of rows) {
    renewalReminderLogService.insertLog({
      stockId: row.stock_id,
      userId: row.user_id,
      productId: row.product_id,
      productName: row.product_name,
      status: 'sent_legacy',
      telegramSent: 1,
      createdAt: row.reminder_sent_at,
    });
  }
}

function withIsolatedLegacyRows(run) {
  db.exec('SAVEPOINT backfill_renewal_logs_test');
  try {
    hideExistingMissingRows();
    run();
  } finally {
    db.exec('ROLLBACK TO backfill_renewal_logs_test');
    db.exec('RELEASE backfill_renewal_logs_test');
  }
}

test('dry-run finds the legacy fixture without creating a log', () => {
  withIsolatedLegacyRows(() => {
    const seed = seedFixture();
    try {
      const result = renewalReminderLogService.backfillMissingLegacyLogs();

      assert.strictEqual(result.scanned, 1);
      assert.strictEqual(result.created, 0);
      assert.strictEqual(result.rows.length, 1);
      assert.strictEqual(result.rows[0].stock_id, seed.stockId);
      assert.strictEqual(
        db.prepare('SELECT COUNT(*) AS count FROM renewal_reminder_logs WHERE stock_id = ?')
          .get(seed.stockId).count,
        0,
      );
    } finally {
      cleanup(seed);
    }
  });
});

test('apply creates one exact legacy log and is idempotent', () => {
  withIsolatedLegacyRows(() => {
    const seed = seedFixture();
    try {
      const first = renewalReminderLogService.backfillMissingLegacyLogs({ apply: true });
      const row = db.prepare(`
        SELECT *
        FROM renewal_reminder_logs
        WHERE stock_id = ?
      `).get(seed.stockId);

      assert.strictEqual(first.scanned, 1);
      assert.strictEqual(first.created, 1);
      assert.strictEqual(row.status, 'sent_legacy');
      assert.strictEqual(row.telegram_sent, 1);
      assert.strictEqual(row.created_at, '2026-06-20 02:00:00');
      assert.strictEqual(row.expiry_date, '2026-06-20');
      assert.strictEqual(row.user_id, seed.userId);
      assert.strictEqual(row.product_id, seed.productId);
      assert.strictEqual(row.product_name, seed.productName);
      assert.strictEqual(row.order_id, null);
      assert.strictEqual(row.web_notification_id, null);
      assert.strictEqual(row.days_before_expiry, null);
      assert.strictEqual(row.error_message, null);
      assert.strictEqual(row.message_body, null);

      const second = renewalReminderLogService.backfillMissingLegacyLogs({ apply: true });
      const total = db.prepare(`
        SELECT COUNT(*) AS count
        FROM renewal_reminder_logs
        WHERE stock_id = ?
      `).get(seed.stockId).count;

      assert.strictEqual(second.scanned, 0);
      assert.strictEqual(second.created, 0);
      assert.strictEqual(total, 1);
    } finally {
      cleanup(seed);
    }
  });
});
