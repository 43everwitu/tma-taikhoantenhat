const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const variantService = require('../../src/services/variantService');
const { NfshopError } = require('../../src/services/nfshopClient');
const svc = require('../../src/services/nfshopFulfillmentService');

const USER_ID = 9990001;
const OTHER_USER_ID = 9991001;

function seed(variants) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  for (const id of [USER_ID, OTHER_USER_ID]) db.prepare("INSERT OR IGNORE INTO users (telegram_id, full_name) VALUES (?, 'Test')").run(id);
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`NF cat ${suffix}`, `nf-cat-${suffix}`);
  const prod = db.prepare('INSERT INTO products (category_id, name, slug, price, is_active) VALUES (?, ?, ?, 1000, 1)')
    .run(cat.lastInsertRowid, `NF product ${suffix}`, `nf-product-${suffix}`);
  const ids = {};
  for (const [key, v] of Object.entries(variants)) {
    ids[key] = variantService.create(db, { productId: prod.lastInsertRowid, name: key, price: 1000, isBackorder: true, ...v }).id;
  }
  const state = { suffix, categoryId: cat.lastInsertRowid, productId: prod.lastInsertRowid, variantIds: ids, orderIds: [] };
  state.addOrder = (variantKey, { userId = USER_ID, quantity = 1, status = 'paid' } = {}) => {
    const r = db.prepare(`
      INSERT INTO orders (user_id, product_id, variant_id, quantity, total_price, payment_code, status, expires_at)
      VALUES (?, ?, ?, ?, 1000, ?, ?, datetime('now', '+1 hour'))
    `).run(userId, state.productId, ids[variantKey], quantity, `NF${suffix}${state.orderIds.length}`, status);
    state.orderIds.push(r.lastInsertRowid);
    return r.lastInsertRowid;
  };
  return state;
}

function cleanup(s) {
  const marks = s.orderIds.map(() => '?').join(',') || 'NULL';
  db.prepare(`DELETE FROM nfshop_orders WHERE tma_order_id IN (${marks})`).run(...s.orderIds);
  db.prepare(`DELETE FROM nfshop_fulfillment_attempts WHERE tma_order_id IN (${marks})`).run(...s.orderIds);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(s.productId);
  db.prepare(`DELETE FROM orders WHERE id IN (${marks})`).run(...s.orderIds);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(s.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(s.categoryId);
}

function fakeClient(overrides = {}) {
  const calls = [];
  let n = 100;
  return {
    calls,
    createOrder: async (args) => { calls.push(['create', args]); n += 1; return { id: n, public_id: `pub${n}` }; },
    extendOrder: async (id, args) => { calls.push(['extend', id, args]); return { id }; },
    getOrder: async (id) => { calls.push(['get', id]); return { id, public_id: `pub${id}`, revoked_at: null }; },
    orderUrl: (p) => `https://nf.test/o/${p}`,
    ...overrides,
  };
}

function deps(client) {
  const notified = [];
  const alerts = [];
  const waits = [];
  const cards = [];
  return {
    client, notified, alerts, waits, cards,
    notifyCustomer: async (order, url, ctx) => { notified.push({ orderId: order.id, url, ctx }); },
    alertAdmin: async (text) => { alerts.push(text); },
    notifyWait: async (order) => { waits.push(order.id); },
    postAdminCard: async (order) => { cards.push(order.id); },
  };
}

const row = (id) => db.prepare('SELECT status, delivered_keys_json FROM orders WHERE id = ?').get(id);

const VARIANTS = {
  monthly: { nfshopPackageId: 11, nfshopKind: 'monthly', nfshopValidDays: 30 },
  links: { nfshopPackageId: 12, nfshopKind: 'links', nfshopValidDays: 7 },
  plain: {},
};

test('links variant creates one order with quota = quantity and delivers the link', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('links', { quantity: 3 });
  const d = deps(fakeClient());
  const r = await svc.fulfillOrder(id, d);
  assert.strictEqual(r.delivered, true);
  assert.deepStrictEqual(d.client.calls, [['create', { packageId: 12, validDays: 7, linkQuota: 3, reference: `tma-${id}` }]]);
  assert.strictEqual(row(id).status, 'delivered');
  assert.deepStrictEqual(JSON.parse(row(id).delivered_keys_json), ['https://nf.test/o/pub101']);
  assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM nfshop_orders WHERE tma_order_id = ?').get(id).n, 1);
  assert.strictEqual(db.prepare('SELECT duration_days FROM stock WHERE product_id = ?').get(s.productId).duration_days, 7);
  assert.strictEqual(d.notified.length, 1);
  assert.strictEqual(d.notified[0].url, 'https://nf.test/o/pub101');
});

test('monthly first purchase creates; quantity multiplies days', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('monthly', { quantity: 2 });
  const d = deps(fakeClient());
  await svc.fulfillOrder(id, d);
  assert.deepStrictEqual(d.client.calls, [['create', { packageId: 11, validDays: 60, reference: `tma-${id}` }]]);
});

test('monthly renewal by same user extends the existing nfshop order and resends same link', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const first = s.addOrder('monthly');
  const d = deps(fakeClient());
  await svc.fulfillOrder(first, d);
  const second = s.addOrder('monthly');
  d.client.calls.length = 0;
  const r = await svc.fulfillOrder(second, d);
  assert.strictEqual(r.action, 'extend');
  assert.deepStrictEqual(d.client.calls, [['get', 101], ['extend', 101, { days: 30, reference: `tma-${second}` }]]);
  assert.deepStrictEqual(JSON.parse(row(second).delivered_keys_json), ['https://nf.test/o/pub101']);
  assert.strictEqual(d.notified[1].ctx.action, 'extend');
});

test('renewal falls back to create when prior order is revoked or gone', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const first = s.addOrder('monthly');
  const d = deps(fakeClient());
  await svc.fulfillOrder(first, d);
  d.client.getOrder = async () => ({ id: 101, public_id: 'pub101', revoked_at: '2026-10-01T00:00:00+07:00' });
  const second = s.addOrder('monthly');
  d.client.calls.length = 0;
  const r = await svc.fulfillOrder(second, d);
  assert.strictEqual(r.action, 'create');
  assert.strictEqual(d.client.calls[0][0], 'create');

  d.client.getOrder = async () => { throw new NfshopError('Không tìm thấy đơn hàng.', { status: 404, kind: 'rejected' }); };
  const third = s.addOrder('monthly');
  assert.strictEqual((await svc.fulfillOrder(third, d)).action, 'create');
});

test('other user never extends someone else’s order', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const first = s.addOrder('monthly');
  const d = deps(fakeClient());
  await svc.fulfillOrder(first, d);
  const other = s.addOrder('monthly', { userId: OTHER_USER_ID });
  d.client.calls.length = 0;
  assert.strictEqual((await svc.fulfillOrder(other, d)).action, 'create');
  assert.ok(!d.client.calls.some((c) => c[0] === 'extend' || c[0] === 'get'));
});

test('transient failure keeps order paid, counts attempts and alerts once at the limit', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('links');
  const d = deps(fakeClient({ createOrder: async () => { throw new NfshopError('down', { status: 503, kind: 'transient' }); } }));
  for (let i = 1; i < svc.MAX_ATTEMPTS; i++) {
    const r = await svc.fulfillOrder(id, d);
    assert.strictEqual(r.failed, true);
    assert.ok(!r.terminal);
  }
  assert.strictEqual(row(id).status, 'paid');
  assert.strictEqual(d.alerts.length, 0);
  const last = await svc.fulfillOrder(id, d);
  assert.strictEqual(last.terminal, true);
  assert.strictEqual(d.alerts.length, 1);
  const a = db.prepare('SELECT attempts, gave_up FROM nfshop_fulfillment_attempts WHERE tma_order_id = ?').get(id);
  assert.deepStrictEqual({ ...a }, { attempts: svc.MAX_ATTEMPTS, gave_up: 1 });
  assert.deepStrictEqual(svc.pendingOrderIds().filter((x) => x === id), []);
});

test('rejected failure gives up immediately and alerts', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('links', { quantity: 500 });
  const d = deps(fakeClient({ createOrder: async () => { throw new NfshopError('Số lượt link phải từ 1 đến 100.', { status: 400, kind: 'rejected' }); } }));
  const r = await svc.fulfillOrder(id, d);
  assert.strictEqual(r.terminal, true);
  assert.strictEqual(d.alerts.length, 1);
  assert.strictEqual(row(id).status, 'paid');
});

test('non-nfshop variants and non-paid orders are skipped', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const plain = s.addOrder('plain');
  const done = s.addOrder('links', { status: 'delivered' });
  const d = deps(fakeClient());
  assert.strictEqual((await svc.fulfillOrder(plain, d)).reason, 'not_nfshop');
  assert.strictEqual((await svc.fulfillOrder(done, d)).reason, 'not_paid');
  assert.strictEqual(d.client.calls.length, 0);
});

test('concurrent fulfilment of the same order calls nfshop once', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('links');
  let release;
  const gate = new Promise((r) => { release = r; });
  const client = fakeClient();
  const original = client.createOrder;
  client.createOrder = async (a) => { await gate; return original(a); };
  const d = deps(client);
  const p1 = svc.fulfillOrder(id, d);
  const p2 = svc.fulfillOrder(id, d);
  release();
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.strictEqual(client.calls.filter((c) => c[0] === 'create').length, 1);
  assert.strictEqual(r1.delivered, true);
  assert.strictEqual(r2.reason, 'in_flight');
});

test('sweep delivers paid nfshop orders only', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const a = s.addOrder('links');
  const b = s.addOrder('plain');
  const d = deps(fakeClient());
  await svc.sweep(d);
  assert.strictEqual(row(a).status, 'delivered');
  assert.strictEqual(row(b).status, 'paid');
});

test('default admin alert uses an event that is enabled by default', async (t) => {
  const adminNotifyService = require('../../src/services/adminNotifyService');
  const originalNotify = adminNotifyService.notify;
  const sent = [];
  adminNotifyService.notify = async (eventType, text) => { sent.push({ eventType, text }); return true; };
  const s = seed(VARIANTS);
  t.after(() => { adminNotifyService.notify = originalNotify; cleanup(s); });
  const id = s.addOrder('links', { quantity: 500 });
  const client = fakeClient({ createOrder: async () => { throw new NfshopError('bad quota', { status: 400, kind: 'rejected' }); } });
  const r = await svc.fulfillOrder(id, { client, notifyCustomer: async () => {}, notifyWait: async () => {}, postAdminCard: async () => {} });
  assert.strictEqual(r.terminal, true);
  assert.strictEqual(sent.length, 1);
  // 'no_stock' is off unless an admin enabled notify_admin_no_stock; the alert must not depend on that toggle.
  assert.strictEqual(sent[0].eventType, 'backorder_paid');
  assert.ok(sent[0].text.includes(`#${id}`));
});

test('manual-review orders are never auto-fulfilled', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('links');
  db.prepare('UPDATE orders SET requires_manual_review = 1 WHERE id = ?').run(id);
  const d = deps(fakeClient());
  const r = await svc.fulfillOrder(id, d);
  assert.strictEqual(r.reason, 'manual_review');
  assert.strictEqual(d.client.calls.length, 0);
  assert.ok(!svc.pendingOrderIds().includes(id));
  assert.strictEqual(row(id).status, 'paid');
});

test('customer gets one wait message on first failure; admin card only when giving up', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('links');
  const d = deps(fakeClient({ createOrder: async () => { throw new NfshopError('down', { status: 503, kind: 'transient' }); } }));
  await svc.fulfillOrder(id, d);
  assert.deepStrictEqual(d.waits, [id]);
  assert.deepStrictEqual(d.cards, []);
  for (let i = 2; i < svc.MAX_ATTEMPTS; i++) await svc.fulfillOrder(id, d);
  assert.deepStrictEqual(d.waits, [id]);
  assert.deepStrictEqual(d.cards, []);
  await svc.fulfillOrder(id, d);
  assert.deepStrictEqual(d.waits, [id]);
  assert.deepStrictEqual(d.cards, [id]);
});

test('rejected failure on first attempt sends wait message and admin card once each', async (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const id = s.addOrder('links');
  const d = deps(fakeClient({ createOrder: async () => { throw new NfshopError('bad', { status: 400, kind: 'rejected' }); } }));
  await svc.fulfillOrder(id, d);
  assert.deepStrictEqual(d.waits, [id]);
  assert.deepStrictEqual(d.cards, [id]);
});

test('isNfshopOrder tells nfshop variants from plain ones', (t) => {
  const s = seed(VARIANTS); t.after(() => cleanup(s));
  const nf = s.addOrder('links');
  const plain = s.addOrder('plain');
  assert.strictEqual(svc.isNfshopOrder(orderServiceGet(nf)), true);
  assert.strictEqual(svc.isNfshopOrder(orderServiceGet(plain)), false);
  assert.strictEqual(svc.isNfshopOrder({ variant_id: null }), false);
  assert.strictEqual(svc.isNfshopOrder(null), false);
});

function orderServiceGet(id) {
  return require('../../src/services/orderService').getById(id);
}

test('variants with incomplete nfshop config are not fulfilled automatically', async (t) => {
  const s = seed({
    noKind: { nfshopPackageId: 21, nfshopValidDays: 30 },
    noDays: { nfshopPackageId: 22, nfshopKind: 'monthly' },
  });
  t.after(() => cleanup(s));
  const a = s.addOrder('noKind');
  const b = s.addOrder('noDays');
  assert.strictEqual(svc.isNfshopOrder(orderServiceGet(a)), false);
  assert.strictEqual(svc.isNfshopOrder(orderServiceGet(b)), false);
  assert.deepStrictEqual(svc.pendingOrderIds().filter((x) => x === a || x === b), []);
  const d = deps(fakeClient());
  assert.strictEqual((await svc.fulfillOrder(a, d)).reason, 'not_nfshop');
  assert.strictEqual(d.client.calls.length, 0);
});
