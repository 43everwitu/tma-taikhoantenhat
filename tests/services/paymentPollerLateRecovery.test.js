const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const { PaymentPoller } = require('../../src/services/paymentPoller');

const TEST_USER_ID = 9991001;

function makeBot() {
  return {
    telegram: {
      sendMessage: async () => ({ message_id: 1 }),
      deleteMessage: async () => true,
    },
  };
}

function setupExpiredOrder() {
  db.prepare("INSERT OR IGNORE INTO users (telegram_id, full_name) VALUES (?, 'Late Payment Test')").run(TEST_USER_ID);
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `late-payment-cat-${suffix}`,
    `late-payment-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(cat.lastInsertRowid, `Late payment product ${suffix}`, `late-payment-product-${suffix}`);
  const paymentCode = `PNS${Math.floor(900000000 + Math.random() * 100000000)}`;
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source, expires_at)
    VALUES (?, ?, 1, 1000, ?, 'expired', 'web', datetime('now', '-1 hour'))
  `).run(TEST_USER_ID, product.lastInsertRowid, paymentCode);

  return {
    categoryId: cat.lastInsertRowid,
    productId: product.lastInsertRowid,
    orderId: order.lastInsertRowid,
    paymentCode,
    txNumber: `FT_LATE_${suffix}`,
  };
}

function cleanupFixture(fixture) {
  db.prepare('DELETE FROM transactions WHERE mb_transaction_number = ?').run(fixture.txNumber);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(TEST_USER_ID);
  db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(fixture.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
}

test('poller recovers an expired order even when its bank transaction was already marked matched', async (t) => {
  const fixture = setupExpiredOrder();
  t.after(() => cleanupFixture(fixture));
  db.prepare(`
    INSERT INTO transactions (mb_transaction_number, amount, description, matched_order_id, matched_payment_code, match_status, raw_data)
    VALUES (?, 1000, ?, ?, ?, 'matched', ?)
  `).run(
    fixture.txNumber,
    `Thanh toan ${fixture.paymentCode}`,
    fixture.orderId,
    fixture.paymentCode,
    JSON.stringify({ transactionNumber: fixture.txNumber, amount: 1000, description: `Thanh toan ${fixture.paymentCode}` }),
  );

  const poller = new PaymentPoller(db, makeBot());
  poller.running = true;
  poller._fetchTransactions = async () => [
    { transactionNumber: fixture.txNumber, amount: 1000, description: `Thanh toan ${fixture.paymentCode}` },
  ];

  await poller._poll();

  const row = db.prepare('SELECT status, paid_at, payment_matched_at FROM orders WHERE id = ?').get(fixture.orderId);
  assert.strictEqual(row.status, 'paid');
  assert.ok(row.paid_at);
  assert.ok(row.payment_matched_at);
});

test('poller stays awake while recently expired orders remain recoverable', async (t) => {
  const fixture = setupExpiredOrder();
  t.after(() => cleanupFixture(fixture));
  const poller = new PaymentPoller(db, makeBot());
  poller.running = true;
  poller._fetchTransactions = async () => [];

  await poller._poll();

  assert.strictEqual(poller.running, true);
});
