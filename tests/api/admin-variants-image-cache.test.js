const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAA' +
  'AAC0lEQVR42mP8/x8AAwMCAO2n8sQAAAAASUVORK5CYII=',
  'base64',
);

function stubFetchImage(buffer = PNG_1X1, contentType = 'image/png') {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return String(name).toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    async arrayBuffer() {
      return buffer;
    },
  });
  return () => {
    global.fetch = originalFetch;
  };
}

function getRouteHandler(method, routePath) {
  const router = require('../../src/api/routes/admin/variants');
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${routePath}`);
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

test('POST /admin/products/:id/variants caches external imageUrl before saving', async (t) => {
  const restoreFetch = stubFetchImage();
  t.after(() => restoreFetch());

  const suffix = Date.now();
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `variant-image-cache-${suffix}`,
    `variant-image-cache-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1234, 1)
  `).run(category.lastInsertRowid, `Variant cache ${suffix}`, `variant-cache-product-${suffix}`);
  t.after(() => {
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(category.lastInsertRowid);
  });

  const handler = getRouteHandler('post', '/');
  const req = {
    params: { productId: String(product.lastInsertRowid) },
    validated: {
      name: 'Variant image cache',
      description: '',
      price: 1234,
      sortOrder: 0,
      requiresInput: false,
      inputLabel: null,
      inputPlaceholder: null,
      inputType: 'text',
      inputFields: null,
      imageUrl: 'https://example.com/variant-image.png',
      isBackorder: false,
      defaultDurationDays: null,
    },
    admin: { adminId: 1 },
    ip: '127.0.0.1',
  };
  const res = mockRes();

  await handler(req, res);

  assert.strictEqual(res.statusCode, 201);
  assert.ok(res.body?.data?.id, 'response should include a variant id');

  const row = db.prepare('SELECT image_url FROM product_variants WHERE id = ?').get(Number(res.body.data.id));
  assert.ok(row);
  assert.match(row.image_url, /^\/uploads\/products-inline\//);
});
