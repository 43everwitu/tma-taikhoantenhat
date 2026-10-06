const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const orderService = require('../../src/services/orderService');

const USER_ID = 9990001;

function seed() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  db.prepare("INSERT OR IGNORE INTO users (telegram_id, full_name) VALUES (?, 'Test')").run(USER_ID);
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`Deliver cat ${suffix}`, `deliver-cat-${suffix}`);
  const prod = db.prepare('INSERT INTO products (category_id, name, slug, price, is_active) VALUES (?, ?, ?, 1000, 1)')
    .run(cat.lastInsertRowid, `Deliver product ${suffix}`, `deliver-product-${suffix}`);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, expires_at)
    VALUES (?, ?, 1, 1000, ?, 'paid', datetime('now', '+1 hour'))
  `).run(USER_ID, prod.lastInsertRowid, `DLV${suffix}`);
  return { suffix, categoryId: cat.lastInsertRowid, productId: prod.lastInsertRowid, orderId: order.lastInsertRowid };
}

function cleanup(s) {
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(s.orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(s.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(s.categoryId);
}

test('deliverWithAccounts marks delivered, stores keys and sold stock rows', (t) => {
  const s = seed();
  t.after(() => cleanup(s));
  orderService.deliverWithAccounts(s.orderId, ['https://x/o/abc'], 7);
  const order = db.prepare('SELECT status, delivered_at, delivered_keys_json FROM orders WHERE id = ?').get(s.orderId);
  assert.strictEqual(order.status, 'delivered');
  assert.ok(order.delivered_at);
  assert.deepStrictEqual(JSON.parse(order.delivered_keys_json), ['https://x/o/abc']);
  const rows = db.prepare('SELECT data, duration_days, is_sold, sold_to FROM stock WHERE product_id = ?').all(s.productId);
  assert.deepStrictEqual(rows.map((r) => ({ ...r })), [{ data: 'https://x/o/abc', duration_days: 7, is_sold: 1, sold_to: USER_ID }]);
});

test('deliverWithAccounts accepts null duration', (t) => {
  const s = seed();
  t.after(() => cleanup(s));
  orderService.deliverWithAccounts(s.orderId, ['k1', 'k2'], null);
  const rows = db.prepare('SELECT duration_days FROM stock WHERE product_id = ?').all(s.productId);
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => r.duration_days === null));
});
