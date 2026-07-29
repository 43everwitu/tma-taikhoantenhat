const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function createFixture() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const activeUserId = 997000000 + Math.floor(Math.random() * 100000);
  const shadowUserId = activeUserId + 1;
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(activeUserId, `Active ${suffix}`);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(shadowUserId, `Shadow ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `shadow-review-cat-${suffix}`,
    `shadow-review-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Shadow review product ${suffix}`, `shadow-review-product-${suffix}`);
  const stock = db.prepare('INSERT INTO stock (product_id, data, is_sold) VALUES (?, ?, 0)');
  stock.run(product.lastInsertRowid, `active-key-${suffix}`);
  stock.run(product.lastInsertRowid, `shadow-key-${suffix}`);

  return {
    suffix,
    activeUserId,
    shadowUserId,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
  };
}

function cleanup(fixture) {
  db.prepare('DELETE FROM orders WHERE product_id = ?').run(fixture.productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(fixture.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id IN (?, ?)').run(fixture.activeUserId, fixture.shadowUserId);
}

test('order creation snapshots shadow ban into manual review fields without changing older orders', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  const orderService = require('../../src/services/orderService');
  const moderation = require('../../src/services/userModerationService');

  const activeOrder = orderService.create(fixture.activeUserId, fixture.productId, 1, 1000, {
    source: 'web',
    allowDuplicate: true,
  });
  moderation.setStatus(fixture.activeUserId, 'shadow_banned', { reason: 'watch', adminId: 1 });

  const olderOrder = orderService.getById(activeOrder.id);
  assert.strictEqual(olderOrder.requires_manual_review, 0);
  assert.strictEqual(olderOrder.manual_review_reason, null);

  moderation.setStatus(fixture.shadowUserId, 'shadow_banned', { reason: 'review', adminId: 1 });
  const shadowOrder = orderService.create(fixture.shadowUserId, fixture.productId, 1, 1000, {
    source: 'web',
    allowDuplicate: true,
  });

  assert.strictEqual(shadowOrder.requires_manual_review, 1);
  assert.strictEqual(shadowOrder.manual_review_reason, 'shadow_banned');
});
