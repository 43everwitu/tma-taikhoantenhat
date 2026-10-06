const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../../src/database');
const orderService = require('../../src/services/orderService');

function createFixture(status, options = {}) {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const userId = 8_700_000_000 + Math.floor(Math.random() * 1_000_000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(
    userId,
    `Cancelled recovery user ${suffix}`,
  );
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `Cancelled recovery category ${suffix}`,
    `cancelled-recovery-category-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(
    category.lastInsertRowid,
    `Cancelled recovery product ${suffix}`,
    `cancelled-recovery-product-${suffix}`,
  );
  const paidAt = options.paidAt ?? null;
  const order = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, quantity, total_price, payment_code, status,
      paid_at, delivered_at, delivered_keys_json
    )
    VALUES (?, ?, 1, 1000, ?, ?, ?, ?, ?)
  `).run(
    userId,
    product.lastInsertRowid,
    `PNS_CANCELLED_RECOVERY_${suffix}`,
    status,
    paidAt,
    options.deliveredAt ?? null,
    options.deliveredKeys == null ? null : JSON.stringify(options.deliveredKeys),
  );

  return {
    userId,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    orderId: order.lastInsertRowid,
  };
}

function cleanupFixture(fixture) {
  db.prepare('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?')
    .run('order', fixture.orderId);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(fixture.userId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(fixture.productId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
}

test('restoreCancelledToPaid khôi phục đơn hủy và giữ paid_at cũ', (t) => {
  const paidAt = '2026-07-28 09:32:01';
  const fixture = createFixture('cancelled', {
    paidAt,
    deliveredAt: '2026-07-28 09:40:00',
    deliveredKeys: ['stale-key'],
  });
  t.after(() => cleanupFixture(fixture));

  const result = orderService.restoreCancelledToPaid(fixture.orderId);

  assert.strictEqual(result.success, true);
  const updated = db.prepare(`
    SELECT status, paid_at, delivered_at, delivered_keys_json
    FROM orders
    WHERE id = ?
  `).get(fixture.orderId);
  assert.deepStrictEqual(updated, {
    status: 'paid',
    paid_at: paidAt,
    delivered_at: null,
    delivered_keys_json: null,
  });
});

test('restoreCancelledToPaid từ chối đơn không ở trạng thái cancelled', (t) => {
  const fixture = createFixture('pending');
  t.after(() => cleanupFixture(fixture));

  const result = orderService.restoreCancelledToPaid(fixture.orderId);

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.code, 'INVALID_STATE');
  assert.strictEqual(
    db.prepare('SELECT status FROM orders WHERE id = ?').get(fixture.orderId).status,
    'pending',
  );
});

test('restoreCancelledToPaid điền paid_at khi đơn hủy chưa có thời gian thanh toán', (t) => {
  const fixture = createFixture('cancelled');
  t.after(() => cleanupFixture(fixture));

  const result = orderService.restoreCancelledToPaid(fixture.orderId);

  assert.strictEqual(result.success, true);
  const updated = db.prepare('SELECT status, paid_at FROM orders WHERE id = ?')
    .get(fixture.orderId);
  assert.strictEqual(updated.status, 'paid');
  assert.ok(updated.paid_at);
});
