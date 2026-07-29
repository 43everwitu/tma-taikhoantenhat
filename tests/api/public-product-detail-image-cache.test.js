const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAA' +
  'AAC0lEQVR42mP8/x8AAwMCAO2n8sQAAAAASUVORK5CYII=',
  'base64',
);

function stubFetchImage() {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? 'image/png' : null;
      },
    },
    async arrayBuffer() {
      return PNG_1X1;
    },
  });
  return () => {
    global.fetch = originalFetch;
  };
}

function getProductDetailHandler() {
  const router = require('../../src/api/routes/public');
  const layer = router.stack.find((l) => l.route?.path === '/products/:slug' && l.route?.methods?.get);
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

test('GET /products/:slug caches legacy remote product detail images before responding', async (t) => {
  const restoreFetch = stubFetchImage();
  t.after(() => restoreFetch());

  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare(`
    INSERT INTO categories (name, slug, is_active)
    VALUES (?, ?, 1)
  `).run(`DETAIL_CACHE_CAT_${suffix}`, `detail-cache-cat-${suffix}`);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, image_url, long_description, is_active)
    VALUES (?, ?, ?, 1000, ?, ?, 1)
  `).run(
    category.lastInsertRowid,
    `Detail cache product ${suffix}`,
    `detail-cache-product-${suffix}`,
    'https://example.com/product.png',
    '<p>Intro</p><img src="https://example.com/inline.png" />',
  );
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, image_url, is_active)
    VALUES (?, ?, 1000, ?, 1)
  `).run(product.lastInsertRowid, 'Variant', 'https://example.com/variant.png');

  t.after(() => {
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(category.lastInsertRowid);
  });

  const handler = getProductDetailHandler();
  const req = { params: { slug: `detail-cache-product-${suffix}` }, query: {} };
  const res = mockRes();

  await handler(req, res);

  assert.strictEqual(res.statusCode, 200, `unexpected body: ${JSON.stringify(res.body)}`);
  assert.strictEqual(res.body.success, true);
  assert.match(res.body.data.imageUrl, /^\/uploads\/products-inline\//);
  assert.match(res.body.data.longDescription, /src="\/uploads\/products-inline\//);
  assert.match(res.body.data.variants[0].imageUrl, /^\/uploads\/products-inline\//);

  const productRow = db.prepare('SELECT image_url, long_description FROM products WHERE id = ?').get(product.lastInsertRowid);
  const variantRow = db.prepare('SELECT image_url FROM product_variants WHERE id = ?').get(variant.lastInsertRowid);
  assert.match(productRow.image_url, /^\/uploads\/products-inline\//);
  assert.match(productRow.long_description, /src="\/uploads\/products-inline\//);
  assert.match(variantRow.image_url, /^\/uploads\/products-inline\//);
});
