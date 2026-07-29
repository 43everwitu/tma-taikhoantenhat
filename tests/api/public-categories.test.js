const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const db = require('../../src/database');

async function getJson(app, path) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`);
        const json = await res.json();
        server.close();
        resolve({ status: res.status, json });
      } catch (err) {
        server.close();
        reject(err);
      }
    });
  });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1', require('../../src/api/routes/public'));
  return app;
}

function createCategoryWithProduct({ slug, productActive, archived = false }) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare(`
    INSERT INTO categories (name, slug, emoji, is_active)
    VALUES (?, ?, ?, 1)
  `).run(`PUBLIC_CAT_${suffix}`, slug, 'T');
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, is_archived)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    category.lastInsertRowid,
    `PUBLIC_PRODUCT_${suffix}`,
    `public-product-${suffix}`,
    1000,
    productActive ? 1 : 0,
    archived ? 1 : 0
  );
  return { categoryId: category.lastInsertRowid, productId: product.lastInsertRowid };
}

test('GET /categories hides categories without active products', async (t) => {
  const slug = `public-empty-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const { categoryId, productId } = createCategoryWithProduct({ slug, productActive: false });
  t.after(() => {
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  });

  const { status, json } = await getJson(makeApp(), '/api/v1/categories');

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  assert.ok(!json.data.some((c) => c.slug === slug));
});

test('GET /categories hides categories that only contain archived products', async (t) => {
  const slug = `public-archived-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  const { categoryId, productId } = createCategoryWithProduct({ slug, productActive: true, archived: true });
  t.after(() => {
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  });

  const { status, json } = await getJson(makeApp(), '/api/v1/categories');

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  assert.ok(!json.data.some((c) => c.slug === slug));
});

test('GET /categories hides categories without a usable slug', async (t) => {
  const { categoryId, productId } = createCategoryWithProduct({ slug: null, productActive: true });
  t.after(() => {
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  });

  const { status, json } = await getJson(makeApp(), '/api/v1/categories');

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  assert.ok(!json.data.some((c) => c.id === categoryId));
});
