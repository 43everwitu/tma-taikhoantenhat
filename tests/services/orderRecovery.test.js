const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const orderService = require('../../src/services/orderService');

const TEST_USER_ID = 9990001;

function setup() {
  db.prepare("INSERT OR IGNORE INTO users (telegram_id, full_name) VALUES (?, 'Test')").run(TEST_USER_ID);
  const slug = 'r-' + Math.floor(Math.random() * 1e9);
  const cat = db.prepare("INSERT INTO categories (name, slug) VALUES ('r', ?)").run(slug);
  const p = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, 'R', ?, 1000, 1)
  `).run(cat.lastInsertRowid, slug);
  return { productId: p.lastInsertRowid };
}

function insertOrder(productId, paymentCode, status, expiresOffset) {
  const uniqueCode = paymentCode + '-' + Math.floor(Math.random() * 1e9);
  return db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, expires_at)
    VALUES (?, ?, 1, 1000, ?, ?, datetime('now', ?))
  `).run(TEST_USER_ID, productId, uniqueCode, status, expiresOffset);
}

test('getRecentlyExpired returns orders expired within last 24h', () => {
  const { productId } = setup();
  const o = insertOrder(productId, 'PNS999991', 'expired', '-2 hours');
  const rows = orderService.getRecentlyExpired(24);
  assert.ok(rows.some(r => r.id === o.lastInsertRowid), 'expected recent expired order in list');
});

test('getRecentlyExpired excludes orders older than 24h', () => {
  const { productId } = setup();
  const o = insertOrder(productId, 'PNS999992', 'expired', '-26 hours');
  const rows = orderService.getRecentlyExpired(24);
  assert.ok(!rows.some(r => r.id === o.lastInsertRowid), 'expected stale expired order NOT in list');
});

test('markRecoveredPaid flips expired → paid + sets payment_matched_at', () => {
  const { productId } = setup();
  const o = insertOrder(productId, 'PNS999993', 'expired', '-1 hour');
  const updated = orderService.markRecoveredPaid(o.lastInsertRowid);
  assert.strictEqual(updated, true);
  const row = db.prepare('SELECT status, payment_matched_at FROM orders WHERE id = ?').get(o.lastInsertRowid);
  assert.strictEqual(row.status, 'paid');
  assert.ok(row.payment_matched_at, 'payment_matched_at should be set');
});

test('markRecoveredPaid is idempotent when status not expired', () => {
  const { productId } = setup();
  const o = insertOrder(productId, 'PNS999996', 'delivered', '-1 hour');
  const updated = orderService.markRecoveredPaid(o.lastInsertRowid);
  assert.strictEqual(updated, false);
  const row = db.prepare('SELECT status FROM orders WHERE id = ?').get(o.lastInsertRowid);
  assert.strictEqual(row.status, 'delivered');
});

test('cleanupExpiredOrders deletes expired older than 24h, keeps recent', () => {
  const { productId } = setup();
  const old = insertOrder(productId, 'PNS999994', 'expired', '-26 hours');
  const recent = insertOrder(productId, 'PNS999995', 'expired', '-1 hour');
  orderService.cleanupExpiredOrders(24);
  assert.strictEqual(db.prepare('SELECT 1 FROM orders WHERE id = ?').get(old.lastInsertRowid), undefined);
  assert.ok(db.prepare('SELECT 1 FROM orders WHERE id = ?').get(recent.lastInsertRowid), 'recent expired should remain');
});
