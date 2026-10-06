const assert = require('node:assert');
const test = require('node:test');
const http = require('node:http');
const express = require('express');
const db = require('../../src/database');
const subscriptions = require('../../src/services/variantStockSubscriptionService');

function makeApp(admin) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.admin = admin; next(); });
  app.use('/admin/stock', require('../../src/api/routes/admin/stock'));
  app.use((err, _req, res, _next) => res.status(500).json({ success: false, error: { message: err.message } }));
  return app;
}

async function get(app, path) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`);
    return { status: res.status, json: await res.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function seed() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 950_000_000 + Math.floor(Math.random() * 90000);
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(userId, `demandapi_${suffix}`, 'Demand API');
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`DEMANDAPI_CAT_${suffix}`, `demandapi-cat-${suffix}`);
  const product = db.prepare('INSERT INTO products (category_id, name, slug, price, is_active) VALUES (?, ?, ?, 1000, 1)')
    .run(category.lastInsertRowid, `Demand API Product ${suffix}`, `demandapi-product-${suffix.replace('_', '-')}`);
  const variant = db.prepare('INSERT INTO product_variants (product_id, name, price, is_active) VALUES (?, ?, 1000, 1)').run(product.lastInsertRowid, 'Goi API');
  subscriptions.subscribe(userId, variant.lastInsertRowid);
  return { userId, categoryId: category.lastInsertRowid, productId: product.lastInsertRowid, variantId: variant.lastInsertRowid };
}

function cleanup(s) {
  db.prepare('DELETE FROM variant_stock_subscriptions WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(s.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(s.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(s.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(s.userId);
}

const SUPER = { adminId: 1, role: 'super_admin', permissions: JSON.stringify(['*']) };

test('GET /admin/stock/demand lists products with waiting customers', async (t) => {
  const s = seed(); t.after(() => cleanup(s));
  const { status, json } = await get(makeApp(SUPER), '/admin/stock/demand');
  assert.strictEqual(status, 200, JSON.stringify(json));
  assert.strictEqual(json.success, true);
  const product = json.data.products.find((p) => p.productId === s.productId);
  assert.ok(product, 'seeded product present');
  assert.strictEqual(product.waiting, 1);
  assert.strictEqual(product.variants[0].variantId, s.variantId);
  assert.strictEqual(product.variants[0].waiting, 1);
  assert.ok(json.data.totals.waiting >= 1);
  assert.strictEqual(json.data.days, 30);
});

test('days is validated and clamped', async (t) => {
  const s = seed(); t.after(() => cleanup(s));
  const app = makeApp(SUPER);
  assert.strictEqual((await get(app, '/admin/stock/demand?days=abc')).json.data.days, 30);
  assert.strictEqual((await get(app, '/admin/stock/demand?days=9999')).json.data.days, 365);
  assert.strictEqual((await get(app, '/admin/stock/demand?days=7')).json.data.days, 7);
});

test('requires stock.read', async (t) => {
  const s = seed(); t.after(() => cleanup(s));
  const noStock = { adminId: 2, role: 'admin', permissions: JSON.stringify(['orders.read']) };
  const { status } = await get(makeApp(noStock), '/admin/stock/demand');
  assert.strictEqual(status, 403);
  const reader = { adminId: 3, role: 'admin', permissions: JSON.stringify(['stock.read']) };
  assert.strictEqual((await get(makeApp(reader), '/admin/stock/demand')).status, 200);
});

test('the demand route is not shadowed by /:productId', async (t) => {
  const s = seed(); t.after(() => cleanup(s));
  const { json } = await get(makeApp(SUPER), '/admin/stock/demand');
  assert.ok(json.data && Array.isArray(json.data.products));
});
