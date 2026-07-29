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

test('getPaymentMatchCandidates returns pending and recent expired bank orders only', (t) => {
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  const userId = 8_000_000_000 + Math.floor(Math.random() * 1_000_000);
  const slug = `payment-match-${suffix}`;
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Payment Match ${suffix}`);
  const category = db.prepare(
    'INSERT INTO categories (name, slug) VALUES (?, ?)',
  ).run(`Payment Match ${suffix}`, slug);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Payment Match ${suffix}`, slug);

  const insertCandidate = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, quantity, total_price, payment_code,
      status, payment_method, expires_at
    ) VALUES (?, ?, 1, 1000, ?, ?, ?, datetime('now', ?))
  `);
  const pending = insertCandidate.run(
    userId, product.lastInsertRowid, `PNS_CAND_PENDING_${suffix}`,
    'pending', 'bank', '+5 minutes',
  );
  const pendingWithoutExpiry = insertCandidate.run(
    userId, product.lastInsertRowid, `PNS_CAND_NO_EXPIRY_${suffix}`,
    'pending', 'bank', null,
  );
  const legacyPending = insertCandidate.run(
    userId, product.lastInsertRowid, `PNS_CAND_LEGACY_${suffix}`,
    'pending', null, '+5 minutes',
  );
  const recentExpired = insertCandidate.run(
    userId, product.lastInsertRowid, `PNS_CAND_RECENT_${suffix}`,
    'expired', 'bank', '-1 hour',
  );
  const boundaryExpired = insertCandidate.run(
    userId, product.lastInsertRowid, `PNS_CAND_BOUNDARY_${suffix}`,
    'expired', 'bank', '-24 hours',
  );
  const oldExpired = insertCandidate.run(
    userId, product.lastInsertRowid, `PNS_CAND_OLD_${suffix}`,
    'expired', 'bank', '-25 hours',
  );
  const wallet = insertCandidate.run(
    userId, product.lastInsertRowid, `PNS_CAND_WALLET_${suffix}`,
    'pending', 'wallet', '+5 minutes',
  );
  const orderIds = [
    pending.lastInsertRowid,
    pendingWithoutExpiry.lastInsertRowid,
    legacyPending.lastInsertRowid,
    recentExpired.lastInsertRowid,
    boundaryExpired.lastInsertRowid,
    oldExpired.lastInsertRowid,
    wallet.lastInsertRowid,
  ];

  t.after(() => {
    const placeholders = orderIds.map(() => '?').join(',');
    db.prepare(`DELETE FROM orders WHERE id IN (${placeholders})`).run(...orderIds);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(category.lastInsertRowid);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId);
  });

  let resultIds;
  let boundarySecondStable = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const currentSecond = db.prepare("SELECT datetime('now') AS value").get().value;
    db.prepare(`
      UPDATE orders
      SET expires_at = datetime(?, '-24 hours')
      WHERE id = ?
    `).run(currentSecond, boundaryExpired.lastInsertRowid);
    resultIds = new Set(
      orderService.getPaymentMatchCandidates(24).map(row => row.id),
    );
    const afterSecond = db.prepare("SELECT datetime('now') AS value").get().value;
    if (afterSecond === currentSecond) {
      boundarySecondStable = true;
      break;
    }
  }
  assert.ok(boundarySecondStable, 'expected a stable SQLite second for exact 24h boundary');
  assert.deepStrictEqual({
    pending: resultIds.has(pending.lastInsertRowid),
    pendingWithoutExpiry: resultIds.has(pendingWithoutExpiry.lastInsertRowid),
    legacyPending: resultIds.has(legacyPending.lastInsertRowid),
    recentExpired: resultIds.has(recentExpired.lastInsertRowid),
    boundaryExpired: resultIds.has(boundaryExpired.lastInsertRowid),
    oldExpired: resultIds.has(oldExpired.lastInsertRowid),
    wallet: resultIds.has(wallet.lastInsertRowid),
  }, {
    pending: true,
    pendingWithoutExpiry: false,
    legacyPending: true,
    recentExpired: true,
    boundaryExpired: true,
    oldExpired: false,
    wallet: false,
  });
});

test('markRecoveredPaid flips expired → paid + sets payment timestamps', () => {
  const { productId } = setup();
  const o = insertOrder(productId, 'PNS999993', 'expired', '-1 hour');
  const updated = orderService.markRecoveredPaid(o.lastInsertRowid);
  assert.strictEqual(updated, true);
  const row = db.prepare('SELECT status, paid_at, payment_matched_at FROM orders WHERE id = ?').get(o.lastInsertRowid);
  assert.strictEqual(row.status, 'paid');
  assert.ok(row.paid_at, 'paid_at should be set');
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
