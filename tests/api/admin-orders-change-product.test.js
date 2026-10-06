const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    ended: false,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; this.ended = true; return this; },
  };
}

async function runRoute(method, routePath, { body = {}, params = {} } = {}) {
  const router = require('../../src/api/routes/admin/orders');
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${routePath}`);
  const req = {
    body,
    params,
    admin: { adminId: 1, role: 'super_admin', username: 'admin' },
    app: { locals: {}, get: () => null },
    ip: '127.0.0.1',
  };
  const res = mockRes();

  for (const item of layer.route.stack) {
    if (res.ended) break;
    const handle = item.handle;
    if (handle.length >= 3) {
      await new Promise((resolve, reject) => {
        let nextCalled = false;
        const next = (err) => { nextCalled = true; err ? reject(err) : resolve(); };
        Promise.resolve(handle(req, res, next))
          .then(() => { if (res.ended || nextCalled) resolve(); })
          .catch(reject);
      });
    } else {
      await handle(req, res);
    }
  }

  return { status: res.statusCode, json: res.body };
}

function makeSuffix() {
  return `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
}

function makeProduct(withVariant) {
  const suffix = makeSuffix();
  const slug = `ocp-api-${suffix}`;
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(slug, slug);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 150000, 1)
  `).run(category.lastInsertRowid, `OCP API Product ${suffix}`, slug);
  const productId = product.lastInsertRowid;

  let variantId = null;
  if (withVariant) {
    const variant = db.prepare(`
      INSERT INTO product_variants (product_id, name, price) VALUES (?, 'Variant', 200000)
    `).run(productId);
    variantId = variant.lastInsertRowid;
  }
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)')
    .run(productId, variantId, `key-${suffix}`);

  return { productId, categoryId: category.lastInsertRowid, variantId };
}

function makeOrder(productId, status = 'paid') {
  const userId = 838_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `OCP API ${userId}`);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status)
    VALUES (?, ?, 1, 100000, ?, ?)
  `).run(userId, productId, `OCPAPI${Math.floor(Math.random() * 1e9)}`, status);
  return { orderId: order.lastInsertRowid, userId };
}

function cleanup({ order, from, to }) {
  db.prepare('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?').run('order', order.orderId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(order.orderId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(order.userId);
  for (const p of [from, to]) {
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(p.productId);
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(p.productId);
    db.prepare('DELETE FROM products WHERE id = ?').run(p.productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(p.categoryId);
  }
}

test('POST /admin/orders/:id/change-product switches product+variant and logs an audit entry', async (t) => {
  const from = makeProduct(false);
  const to = makeProduct(true);
  const order = makeOrder(from.productId, 'paid');
  t.after(() => cleanup({ order, from, to }));

  const { status, json } = await runRoute('post', '/:id/change-product', {
    params: { id: String(order.orderId) },
    body: { productId: to.productId, variantId: to.variantId },
  });

  assert.strictEqual(status, 200, JSON.stringify(json));
  assert.strictEqual(json.success, true);

  const updated = db.prepare('SELECT product_id, variant_id, total_price FROM orders WHERE id = ?').get(order.orderId);
  assert.strictEqual(updated.product_id, to.productId);
  assert.strictEqual(updated.variant_id, to.variantId);
  assert.strictEqual(updated.total_price, 200000);

  const audit = db.prepare("SELECT action, details FROM audit_log WHERE entity_type = 'order' AND entity_id = ?").get(order.orderId);
  assert.strictEqual(audit.action, 'order.change_product');
  const details = JSON.parse(audit.details);
  assert.strictEqual(details.toProductId, to.productId);
});

test('POST /admin/orders/:id/change-product rejects a delivered order', async (t) => {
  const from = makeProduct(false);
  const to = makeProduct(false);
  const order = makeOrder(from.productId, 'delivered');
  t.after(() => cleanup({ order, from, to }));

  const { status, json } = await runRoute('post', '/:id/change-product', {
    params: { id: String(order.orderId) },
    body: { productId: to.productId },
  });

  assert.strictEqual(status, 400);
  assert.strictEqual(json.error.code, 'INVALID_STATUS');
});
