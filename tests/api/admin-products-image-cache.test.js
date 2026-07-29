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
  const router = require('../../src/api/routes/admin/products');
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${routePath}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function mockRes() {
  const res = {
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
  return res;
}

test('POST /admin/products caches external imageUrl before saving', async (t) => {
  const restoreFetch = stubFetchImage();
  t.after(() => restoreFetch());

  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `image-cache-route-${Date.now()}`,
    `image-cache-route-${Date.now()}`,
  );
  t.after(() => {
    db.prepare('DELETE FROM products WHERE category_id = ?').run(category.lastInsertRowid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(category.lastInsertRowid);
  });

  const handler = getRouteHandler('post', '/');
  const req = {
    validated: {
      categoryId: category.lastInsertRowid,
      name: 'Route cache test',
      price: 1234,
      description: 'desc',
      longDescription: null,
      usageInstructions: null,
      emoji: '📦',
      imageUrl: 'https://example.com/route-image.png',
      lowStockThreshold: 5,
      promotion: null,
      contactOnly: false,
      contactUrl: null,
      notifyOnCreate: false,
    },
    admin: { adminId: 1 },
    app: { locals: {} },
    ip: '127.0.0.1',
  };
  const res = mockRes();

  await handler(req, res);

  assert.strictEqual(res.statusCode, 200);
  assert.ok(res.body?.data?.imageUrl, 'response should include an imageUrl');
  assert.match(res.body.data.imageUrl, /^\/uploads\/products-inline\//);

  const row = db.prepare('SELECT image_url FROM products WHERE id = ?').get(Number(res.body.data.id));
  assert.ok(row);
  assert.match(row.image_url, /^\/uploads\/products-inline\//);
});
