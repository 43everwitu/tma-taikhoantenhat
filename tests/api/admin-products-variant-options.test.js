const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function callProductsIndex() {
  const router = require('../../src/api/routes/admin/products');
  const layer = router.stack.find((item) => item.route?.path === '/' && item.route?.methods?.get);
  assert.ok(layer, 'GET / handler should exist');

  let body = null;
  layer.route.stack[0].handle(
    { query: {} },
    {
      json(payload) {
        body = payload;
        return this;
      },
    },
  );
  return body;
}

test('GET /admin/products trả về id và tên của biến thể đang hoạt động', () => {
  const suffix = Math.floor(Math.random() * 1e9);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `variant-options-${suffix}`,
    `variant-options-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Variant options ${suffix}`, `variant-options-product-${suffix}`);
  const activeVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, 'Pro 12 tháng', 1000, 1)
  `).run(product.lastInsertRowid);
  db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, 'Đã tắt', 1000, 0)
  `).run(product.lastInsertRowid);

  try {
    const response = callProductsIndex();
    const row = response.data.find((item) => item.id === String(product.lastInsertRowid));

    assert.ok(row, 'sản phẩm vừa tạo phải có trong response');
    assert.deepStrictEqual(row.variantOptions, [
      { id: String(activeVariant.lastInsertRowid), name: 'Pro 12 tháng' },
    ]);
  } finally {
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(category.lastInsertRowid);
  }
});
