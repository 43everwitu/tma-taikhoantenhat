const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function createFixture() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 995000000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Sort user ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `sort-order-cat-${suffix}`,
    `sort-order-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Sort order product ${suffix}`, `sort-order-product-${suffix}`);

  return {
    suffix,
    userId,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
  };
}

function cleanup(fixture) {
  db.prepare('DELETE FROM orders WHERE product_id = ?').run(fixture.productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(fixture.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
}

test('order reservation picks the lowest sort_order key first, not the oldest id', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  const insertStock = db.prepare('INSERT INTO stock (product_id, data, is_sold, sort_order) VALUES (?, ?, 0, ?)');
  const older = insertStock.run(fixture.productId, `older-key-${fixture.suffix}`, 100);
  const newer = insertStock.run(fixture.productId, `newer-key-${fixture.suffix}`, 1);

  const orderService = require('../../src/services/orderService');
  const order = orderService.create(fixture.userId, fixture.productId, 1, 1000, {
    source: 'web',
    allowDuplicate: true,
  });

  const reserved = db.prepare('SELECT id FROM stock WHERE reserved_for_order_id = ?').all(order.id);
  assert.strictEqual(reserved.length, 1);
  assert.strictEqual(reserved[0].id, Number(newer.lastInsertRowid), 'expected the lower sort_order row to be reserved, not the older-id row');
});

test('addStock sets sort_order to the new row id (FIFO by default among fresh keys)', (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  const productService = require('../../src/services/productService');
  productService.addStock(fixture.productId, [`fresh-key-${fixture.suffix}`]);

  const row = db.prepare('SELECT id, sort_order FROM stock WHERE product_id = ?').get(fixture.productId);
  assert.strictEqual(row.sort_order, row.id);
});
