const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const orderService = require('../../src/services/orderService');

function createFixture(t, { backorder = false } = {}) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
  const userId = 9_100_000_000 + Math.floor(Math.random() * 1_000_000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(
    userId,
    `Payment Claim ${suffix}`,
  );
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `payment-claim-cat-${suffix}`,
    `payment-claim-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(
    category.lastInsertRowid,
    `Payment Claim Product ${suffix}`,
    `payment-claim-product-${suffix}`,
  );
  const variant = backorder
    ? db.prepare(`
        INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
        VALUES (?, ?, 1000, 1, 1)
      `).run(product.lastInsertRowid, `Payment Claim Variant ${suffix}`)
    : null;
  const order = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, variant_id, quantity, total_price,
      payment_code, status, source, bank_name, expires_at, payment_method
    ) VALUES (?, ?, ?, 1, 1000, ?, 'pending', 'web', 'MB', datetime('now', '+5 minutes'), 'bank')
  `).run(
    userId,
    product.lastInsertRowid,
    variant?.lastInsertRowid ?? null,
    `PNS_CLAIM_${suffix}`,
  );

  const fixture = {
    userId,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    variantId: variant?.lastInsertRowid ?? null,
    orderId: order.lastInsertRowid,
  };

  t.after(() => {
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(fixture.productId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
    if (fixture.variantId) {
      db.prepare('DELETE FROM product_variants WHERE id = ?').run(fixture.variantId);
    }
    db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
  });

  return fixture;
}

test('markPaid claims a pending order only once', (t) => {
  const fixture = createFixture(t);

  const first = orderService.markPaid(fixture.orderId);
  const second = orderService.markPaid(fixture.orderId);

  assert.strictEqual(first.success, true);
  assert.strictEqual(second.success, false);
  assert.match(second.error, /xử lý/);
});

test('confirmAndDeliver claims a backorder payment only once', (t) => {
  const fixture = createFixture(t, { backorder: true });

  const first = orderService.confirmAndDeliver(fixture.orderId, 1);
  const second = orderService.confirmAndDeliver(fixture.orderId, 1);

  assert.strictEqual(first.success, true);
  assert.strictEqual(first.backorder, true);
  assert.strictEqual(second.success, false);
  assert.match(second.error, /xử lý/);
});

test('confirmAndDeliver delivers a backorder variant when stock is available', (t) => {
  const fixture = createFixture(t, { backorder: true });
  db.prepare(`
    INSERT INTO stock (product_id, variant_id, data, is_sold)
    VALUES (?, ?, ?, 0)
  `).run(fixture.productId, fixture.variantId, 'BACKORDER_STOCK_KEY');

  const result = orderService.confirmAndDeliver(fixture.orderId, 1);
  const order = db.prepare('SELECT status, delivered_keys_json FROM orders WHERE id = ?')
    .get(fixture.orderId);
  const stock = db.prepare('SELECT is_sold, sold_to FROM stock WHERE product_id = ?')
    .get(fixture.productId);

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.backorder, undefined);
  assert.deepStrictEqual(result.accounts, ['BACKORDER_STOCK_KEY']);
  assert.strictEqual(order.status, 'delivered');
  assert.deepStrictEqual(JSON.parse(order.delivered_keys_json), ['BACKORDER_STOCK_KEY']);
  assert.strictEqual(stock.is_sold, 1);
  assert.strictEqual(stock.sold_to, fixture.userId);
});

test('confirmAndDeliver allows paid backorder only when recovery option is explicit', (t) => {
  const fixture = createFixture(t, { backorder: true });
  db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(fixture.orderId);

  const normal = orderService.confirmAndDeliver(fixture.orderId, 1);
  const recovered = orderService.confirmAndDeliver(
    fixture.orderId,
    1,
    { allowPaidBackorder: true },
  );

  assert.strictEqual(normal.success, false);
  assert.strictEqual(recovered.success, true);
  assert.strictEqual(recovered.backorder, true);
});
