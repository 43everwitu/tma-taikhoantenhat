const assert = require('node:assert/strict');
const test = require('node:test');
const db = require('../../src/database');

function getProductDetailHandler() {
  const router = require('../../src/api/routes/public');
  const layer = router.stack.find((item) => (
    item.route?.path === '/products/:slug' && item.route?.methods?.get
  ));
  assert.ok(layer, 'GET /products/:slug handler should exist');
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test('GET /products/:slug returns real available stock for a backorder variant', async (t) => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare(`
    INSERT INTO categories (name, slug, is_active)
    VALUES (?, ?, 1)
  `).run(`Backorder stock category ${suffix}`, `backorder-stock-category-${suffix}`);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(
    category.lastInsertRowid,
    `Backorder stock product ${suffix}`,
    `backorder-stock-product-${suffix}`,
  );
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
    VALUES (?, ?, 1000, 1, 1)
  `).run(product.lastInsertRowid, `Backorder variant ${suffix}`);

  const insertStock = db.prepare(`
    INSERT INTO stock (product_id, variant_id, data, is_sold)
    VALUES (?, ?, ?, 0)
  `);
  insertStock.run(product.lastInsertRowid, variant.lastInsertRowid, `key-a-${suffix}`);
  insertStock.run(product.lastInsertRowid, variant.lastInsertRowid, `key-b-${suffix}`);

  t.after(() => {
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(category.lastInsertRowid);
  });

  const req = { params: { slug: `backorder-stock-product-${suffix}` }, query: {} };
  const res = mockRes();

  await getProductDetailHandler()(req, res);

  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.data.variants[0].isBackorder, true);
  assert.equal(res.body.data.variants[0].stock, 2);
});
