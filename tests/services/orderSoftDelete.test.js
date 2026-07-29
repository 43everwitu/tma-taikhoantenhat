const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const orderService = require('../../src/services/orderService');

function createOrderFixture(status = 'delivered') {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 880_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Order Trash ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `order-trash-cat-${suffix}`,
    `order-trash-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Order trash product ${suffix}`, `order-trash-product-${suffix}`);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source)
    VALUES (?, ?, 1, 1000, ?, ?, 'web')
  `).run(userId, product.lastInsertRowid, `PNS_TRASH_${suffix}`, status);

  return { suffix, userId, categoryId: category.lastInsertRowid, productId: product.lastInsertRowid, orderId: order.lastInsertRowid };
}

function cleanupFixture(fixture) {
  db.prepare('DELETE FROM transactions WHERE mb_transaction_number LIKE ?').run(`TRASH_${fixture.suffix}%`);
  db.prepare('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?').run('order', fixture.orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
}

test('softDeleteOrders marks orders as deleted without changing status', (t) => {
  const fixture = createOrderFixture('delivered');
  t.after(() => cleanupFixture(fixture));

  const result = orderService.softDeleteOrders([fixture.orderId], 1);

  assert.deepStrictEqual(result, { requested: 1, affected: 1 });
  const row = db.prepare('SELECT status, deleted_at, deleted_by FROM orders WHERE id = ?').get(fixture.orderId);
  assert.strictEqual(row.status, 'delivered');
  assert.ok(row.deleted_at);
  assert.strictEqual(row.deleted_by, 1);
});

test('restoreDeletedOrders restores recently deleted orders', (t) => {
  const fixture = createOrderFixture('cancelled');
  t.after(() => cleanupFixture(fixture));
  orderService.softDeleteOrders([fixture.orderId], 1);

  const result = orderService.restoreDeletedOrders([fixture.orderId]);

  assert.deepStrictEqual(result, { requested: 1, affected: 1 });
  const row = db.prepare('SELECT status, deleted_at, deleted_by FROM orders WHERE id = ?').get(fixture.orderId);
  assert.strictEqual(row.status, 'cancelled');
  assert.strictEqual(row.deleted_at, null);
  assert.strictEqual(row.deleted_by, null);
});

test('restoreDeletedOrders refuses orders deleted more than 30 days ago', (t) => {
  const fixture = createOrderFixture('expired');
  t.after(() => cleanupFixture(fixture));
  db.prepare("UPDATE orders SET deleted_at = datetime('now', '-31 days'), deleted_by = 1 WHERE id = ?")
    .run(fixture.orderId);

  const result = orderService.restoreDeletedOrders([fixture.orderId]);

  assert.deepStrictEqual(result, { requested: 1, affected: 0 });
  const row = db.prepare('SELECT deleted_at, deleted_by FROM orders WHERE id = ?').get(fixture.orderId);
  assert.ok(row.deleted_at);
  assert.strictEqual(row.deleted_by, 1);
});

test('cleanupDeletedOrders hard-deletes old deleted orders and keeps transaction history', (t) => {
  const fixture = createOrderFixture('delivered');
  t.after(() => cleanupFixture(fixture));
  db.prepare("UPDATE orders SET deleted_at = datetime('now', '-31 days'), deleted_by = 1 WHERE id = ?")
    .run(fixture.orderId);
  db.prepare(`
    INSERT INTO transactions (mb_transaction_number, amount, description, matched_order_id, matched_payment_code, match_status)
    VALUES (?, 1000, 'trash cleanup', ?, ?, 'matched')
  `).run(`TRASH_${fixture.suffix}`, fixture.orderId, `PNS_TRASH_${fixture.suffix}`);

  const deleted = orderService.cleanupDeletedOrders(30);

  assert.strictEqual(deleted, 1);
  const order = db.prepare('SELECT id FROM orders WHERE id = ?').get(fixture.orderId);
  assert.strictEqual(order, undefined);
  const tx = db.prepare('SELECT matched_order_id, matched_payment_code FROM transactions WHERE mb_transaction_number = ?')
    .get(`TRASH_${fixture.suffix}`);
  assert.strictEqual(tx.matched_order_id, null);
  assert.strictEqual(tx.matched_payment_code, `PNS_TRASH_${fixture.suffix}`);
});
