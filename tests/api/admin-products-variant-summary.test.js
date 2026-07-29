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

test('GET /admin/products includes active variant summary without per-product calls', async () => {
  const suffix = Math.floor(Math.random() * 1e9);
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `variant-summary-${suffix}`,
    `variant-summary-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(cat.lastInsertRowid, `Variant summary ${suffix}`, `variant-summary-product-${suffix}`);

  const activeA = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, 'A', 1000, 1)
  `).run(product.lastInsertRowid);
  const activeB = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, 'B', 1000, 1)
  `).run(product.lastInsertRowid);
  const inactive = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, 'C', 1000, 0)
  `).run(product.lastInsertRowid);

  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)')
    .run(product.lastInsertRowid, activeA.lastInsertRowid, 'a-1');
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)')
    .run(product.lastInsertRowid, activeB.lastInsertRowid, 'b-1');
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 1)')
    .run(product.lastInsertRowid, activeB.lastInsertRowid, 'b-sold');
  db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)')
    .run(product.lastInsertRowid, inactive.lastInsertRowid, 'inactive');

  try {
    const { status, json } = callProductsIndex();
    assert.strictEqual(status, 200);
    const row = json.data.find((p) => p.id === String(product.lastInsertRowid));
    assert.ok(row, 'expected created product in response');
    assert.strictEqual(row.variantCount, 2);
    assert.strictEqual(row.variantStock, 2);
  } finally {
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(cat.lastInsertRowid);
  }
});
