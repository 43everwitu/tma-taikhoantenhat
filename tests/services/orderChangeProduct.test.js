const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const orderService = require('../../src/services/orderService');

const TEST_USER_ID = 9990001;

function makeSuffix() {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function makeProduct({ price = 100000, withVariant = false, stockCount = 1, isBackorder = false } = {}) {
  const suffix = makeSuffix();
  const slug = `ocp-${suffix}`;
  const cat = db.prepare("INSERT INTO categories (name, slug) VALUES ('ocp', ?)").run(slug);
  const p = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, 'OCP Product', ?, ?, 1)
  `).run(cat.lastInsertRowid, slug, price);
  const productId = p.lastInsertRowid;

  let variantId = null;
  if (withVariant) {
    const v = db.prepare(`
      INSERT INTO product_variants (product_id, name, price, is_backorder)
      VALUES (?, 'Variant A', ?, ?)
    `).run(productId, price, isBackorder ? 1 : 0);
    variantId = v.lastInsertRowid;
  }

  for (let i = 0; i < stockCount; i++) {
    db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)')
      .run(productId, variantId, `key-${suffix}-${i}`);
  }

  return { productId, categoryId: cat.lastInsertRowid, variantId };
}

function makeOrder({ productId, variantId = null, status = 'paid', quantity = 1, totalPrice = 100000, discountCodeId = null, discountAmount = 0 } = {}) {
  db.prepare("INSERT OR IGNORE INTO users (telegram_id, full_name) VALUES (?, 'Test')").run(TEST_USER_ID);
  const paymentCode = 'OCP' + Math.floor(Math.random() * 1e9);
  const r = db.prepare(`
    INSERT INTO orders (user_id, product_id, variant_id, quantity, total_price, payment_code, status, discount_code_id, discount_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(TEST_USER_ID, productId, variantId, quantity, totalPrice, paymentCode, status, discountCodeId, discountAmount);
  return r.lastInsertRowid;
}

function cleanupProduct(seed) {
  db.prepare('DELETE FROM low_stock_alert_states WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
}

function cleanupOrder(orderId) {
  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
}

test('changeProduct switches to a new variant of a different product and auto-computes price', (t) => {
  const from = makeProduct({ price: 100000, withVariant: false, stockCount: 1 });
  const to = makeProduct({ price: 250000, withVariant: true, stockCount: 1 });
  const orderId = makeOrder({ productId: from.productId, quantity: 2, totalPrice: 200000 });
  t.after(() => { cleanupOrder(orderId); cleanupProduct(from); cleanupProduct(to); });

  const result = orderService.changeProduct(orderId, { productId: to.productId, variantId: to.variantId });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.order.product_id, to.productId);
  assert.strictEqual(result.order.variant_id, to.variantId);
  assert.strictEqual(result.order.total_price, 500000, 'expected variant price (250000) x quantity (2)');

  // new stock reserved for the order, old stock's reservation released
  const newStock = db.prepare('SELECT reserved_for_order_id FROM stock WHERE product_id = ? AND variant_id = ?').get(to.productId, to.variantId);
  assert.strictEqual(newStock.reserved_for_order_id, orderId);
  const oldStock = db.prepare('SELECT reserved_for_order_id FROM stock WHERE product_id = ?').get(from.productId);
  assert.strictEqual(oldStock.reserved_for_order_id, null);
});

test('changeProduct accepts an explicit totalPrice override', (t) => {
  const from = makeProduct({ price: 100000 });
  const to = makeProduct({ price: 250000 });
  const orderId = makeOrder({ productId: from.productId, quantity: 1, totalPrice: 100000 });
  t.after(() => { cleanupOrder(orderId); cleanupProduct(from); cleanupProduct(to); });

  const result = orderService.changeProduct(orderId, { productId: to.productId, variantId: null, totalPrice: 199000 });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.order.total_price, 199000);
});

test('changeProduct clears discount fields from the original order', (t) => {
  const from = makeProduct({ price: 100000 });
  const to = makeProduct({ price: 100000 });
  const suffix = makeSuffix();
  const discount = db.prepare("INSERT INTO discount_codes (code, type, amount) VALUES (?, 'fixed', 5000)").run(`OCP_${suffix}`);
  const orderId = makeOrder({ productId: from.productId, discountCodeId: discount.lastInsertRowid, discountAmount: 5000, totalPrice: 95000 });
  t.after(() => {
    cleanupOrder(orderId);
    cleanupProduct(from);
    cleanupProduct(to);
    db.prepare('DELETE FROM discount_codes WHERE id = ?').run(discount.lastInsertRowid);
  });

  const result = orderService.changeProduct(orderId, { productId: to.productId, variantId: null });

  assert.strictEqual(result.order.discount_code_id, null);
  assert.strictEqual(result.order.discount_amount, 0);
});

test('changeProduct rejects when order status is delivered/cancelled/expired', (t) => {
  const from = makeProduct({ price: 100000 });
  const to = makeProduct({ price: 100000 });
  const orderId = makeOrder({ productId: from.productId, status: 'delivered' });
  t.after(() => { cleanupOrder(orderId); cleanupProduct(from); cleanupProduct(to); });

  const result = orderService.changeProduct(orderId, { productId: to.productId, variantId: null });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.code, 'INVALID_STATUS');
});

test('changeProduct still succeeds when new variant is out of stock and not backorder', (t) => {
  const from = makeProduct({ price: 100000, stockCount: 1 });
  const to = makeProduct({ price: 100000, withVariant: true, stockCount: 0, isBackorder: false });
  const orderId = makeOrder({ productId: from.productId, quantity: 1 });
  t.after(() => { cleanupOrder(orderId); cleanupProduct(from); cleanupProduct(to); });

  const result = orderService.changeProduct(orderId, { productId: to.productId, variantId: to.variantId });

  assert.strictEqual(result.success, true);
  assert.strictEqual(result.order.product_id, to.productId);
  assert.strictEqual(result.order.variant_id, to.variantId);
});
