const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const variantService = require('../../src/services/variantService');
const orderChannelService = require('../../src/services/orderChannelService');
const { PaymentPoller } = require('../../src/services/paymentPoller');

const USER_ID = 9990001;

function seed() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  db.prepare("INSERT OR IGNORE INTO users (telegram_id, full_name) VALUES (?, 'Test')").run(USER_ID);
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`NFQ cat ${suffix}`, `nfq-cat-${suffix}`);
  const prod = db.prepare('INSERT INTO products (category_id, name, slug, price, is_active) VALUES (?, ?, ?, 1000, 1)')
    .run(cat.lastInsertRowid, `NFQ product ${suffix}`, `nfq-product-${suffix}`);
  const nfVariant = variantService.create(db, {
    productId: prod.lastInsertRowid, name: 'nf', price: 1000, isBackorder: true,
    nfshopPackageId: 5, nfshopKind: 'links', nfshopValidDays: 7,
  }).id;
  const plainVariant = variantService.create(db, { productId: prod.lastInsertRowid, name: 'plain', price: 1000, isBackorder: true }).id;
  const mk = (variantId) => db.prepare(`
    INSERT INTO orders (user_id, product_id, variant_id, quantity, total_price, payment_code, status, expires_at)
    VALUES (?, ?, ?, 1, 1000, ?, 'pending', datetime('now', '+1 hour'))
  `).run(USER_ID, prod.lastInsertRowid, variantId, `NFQ${suffix}${variantId}`).lastInsertRowid;
  const orderIds = [mk(nfVariant), mk(plainVariant)];
  return { categoryId: cat.lastInsertRowid, productId: prod.lastInsertRowid, orderIds, nfOrderId: orderIds[0], plainOrderId: orderIds[1] };
}

function cleanup(s) {
  db.prepare(`DELETE FROM orders WHERE id IN (${s.orderIds.map(() => '?').join(',')})`).run(...s.orderIds);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(s.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(s.categoryId);
}

test('poller _notifyBackorderPaid is silent for nfshop orders but not for plain backorders', async (t) => {
  const s = seed();
  const originalPost = orderChannelService.postOrderCard;
  const cards = [];
  orderChannelService.postOrderCard = async (arg) => { cards.push(arg.order.id); };
  t.after(() => { orderChannelService.postOrderCard = originalPost; cleanup(s); });

  const poller = new PaymentPoller(db, {});
  const messages = [];
  poller._notifyCustomer = (userId, text) => { messages.push({ userId, text }); };
  const get = (id) => require('../../src/services/orderService').getById(id);

  await poller._notifyBackorderPaid(get(s.nfOrderId));
  assert.strictEqual(messages.length, 0);
  assert.deepStrictEqual(cards, []);

  await poller._notifyBackorderPaid(get(s.plainOrderId));
  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual(cards, [s.plainOrderId]);

  // manual-review orders must still reach admins even for nfshop variants
  db.prepare('UPDATE orders SET requires_manual_review = 1 WHERE id = ?').run(s.nfOrderId);
  await poller._notifyBackorderPaid(get(s.nfOrderId));
  assert.strictEqual(messages.length, 2);
  assert.deepStrictEqual(cards, [s.plainOrderId, s.nfOrderId]);
});

test('deliverOrder backorder skips the admin card for nfshop orders', async (t) => {
  const s = seed();
  const orderService = require('../../src/services/orderService');
  const originalConfirm = orderService.confirmAndDeliver;
  const originalPost = orderChannelService.postOrderCard;
  const cards = [];
  orderChannelService.postOrderCard = async (arg) => { cards.push(arg.order.id); };
  t.after(() => {
    orderService.confirmAndDeliver = originalConfirm;
    orderChannelService.postOrderCard = originalPost;
    cleanup(s);
  });
  orderService.confirmAndDeliver = (id) => ({ success: true, backorder: true, order: orderService.getById(id) });

  delete require.cache[require.resolve('../../src/services/orderFulfillmentService')];
  const { deliverOrder } = require('../../src/services/orderFulfillmentService');
  await deliverOrder({}, s.nfOrderId);
  assert.deepStrictEqual(cards, []);
  await deliverOrder({}, s.plainOrderId);
  assert.deepStrictEqual(cards, [s.plainOrderId]);
});
