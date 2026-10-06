const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function callProductsIndex() {
  const router = require('../../src/api/routes/admin/products');
  const layer = router.stack.find((l) => l.route?.path === '/' && l.route?.methods?.get);
  assert.ok(layer, 'GET / handler should exist');
  const handler = layer.route.stack[0].handle;
  let statusCode = 200;
  let body = null;
  handler(
    { query: {} },
    {
      status(code) {
        statusCode = code;
        return this;
      },
      json(payload) {
        body = payload;
        return this;
      },
    },
  );
  return { status: statusCode, json: body };
}

test('GET /admin/products includes names of active variants', () => {
  const suffix = Math.floor(Math.random() * 1e9);
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `variant-names-${suffix}`,
    `variant-names-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(cat.lastInsertRowid, `Variant names ${suffix}`, `variant-names-product-${suffix}`);

  const basicVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, 'Basic', 1000, 1)
  `).run(product.lastInsertRowid);
  const proPlusVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, 'Pro, Plus', 1000, 1)
  `).run(product.lastInsertRowid);
  db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, 'Inactive', 1000, 0)
  `).run(product.lastInsertRowid);

  try {
    const { status, json } = callProductsIndex();
    assert.strictEqual(status, 200);
    const row = json.data.find((p) => p.id === String(product.lastInsertRowid));
    assert.ok(row, 'expected created product in response');
    assert.deepStrictEqual(row.variantNames, ['Basic', 'Pro, Plus']);
    assert.deepStrictEqual(row.variantOptions, [
      { id: String(basicVariant.lastInsertRowid), name: 'Basic' },
      { id: String(proPlusVariant.lastInsertRowid), name: 'Pro, Plus' },
    ]);
  } finally {
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(cat.lastInsertRowid);
  }
});
