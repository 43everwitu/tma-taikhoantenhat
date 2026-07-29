const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const db = require('../../src/database');

async function deleteJson(app, path) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'DELETE' });
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
  app.use((req, _res, next) => {
    req.admin = { adminId: 1, role: 'super_admin', username: 'admin' };
    next();
  });
  app.use('/admin/products', require('../../src/api/routes/admin/products'));
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

function createProductWithVariant() {
  const suffix = Date.now();
  const category = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)').run(`DELETE_TEST_CAT_${suffix}`, 'T');
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, ?, 1)
  `).run(category.lastInsertRowid, `DELETE_TEST_PRODUCT_${suffix}`, `delete-test-product-${suffix}`, 1000);
  db.prepare(`
    INSERT INTO product_variants (product_id, name, price)
    VALUES (?, ?, ?)
  `).run(product.lastInsertRowid, 'Variant', 1000);
  return { categoryId: category.lastInsertRowid, productId: product.lastInsertRowid };
}

function createProductWithOrder() {
  const suffix = Date.now();
  const userId = 900_000_000 + Math.floor(Math.random() * 100_000);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `DELETE_TEST_USER_${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, emoji) VALUES (?, ?)').run(`DELETE_ORDER_CAT_${suffix}`, 'T');
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, is_featured)
    VALUES (?, ?, ?, ?, 1, 1)
  `).run(category.lastInsertRowid, `DELETE_ORDER_PRODUCT_${suffix}`, `delete-order-product-${suffix}`, 1000);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status)
    VALUES (?, ?, 1, 1000, ?, 'paid')
  `).run(userId, product.lastInsertRowid, `DEL${suffix}`);
  return { categoryId: category.lastInsertRowid, productId: product.lastInsertRowid, orderId: order.lastInsertRowid, userId };
}

test('DELETE /admin/products/:id deletes a product with related variants instead of throwing 500', async (t) => {
  const { categoryId, productId } = createProductWithVariant();
  t.after(() => {
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  });

  const { status, json } = await deleteJson(makeApp(), `/admin/products/${productId}`);

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  const row = db.prepare('SELECT id FROM products WHERE id = ?').get(productId);
  assert.strictEqual(row, undefined);
});

test('DELETE /admin/products/:id archives a product that has order history', async (t) => {
  const { categoryId, productId, orderId, userId } = createProductWithOrder();
  t.after(() => {
    db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId);
  });

  const { status, json } = await deleteJson(makeApp(), `/admin/products/${productId}`);

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  assert.strictEqual(json.data.archived, true);
  const row = db.prepare('SELECT is_active, is_featured FROM products WHERE id = ?').get(productId);
  assert.strictEqual(row.is_active, 0);
  assert.strictEqual(row.is_featured, 0);
});
