const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
  };
}

async function runRoute(method, routePath, { body = {}, params = {}, query = {} } = {}) {
  const router = require('../../src/api/routes/admin/products');
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${routePath}`);
  const req = {
    body,
    params,
    query,
    admin: { adminId: 1, role: 'super_admin', username: 'admin' },
    app: { locals: {} },
    ip: '127.0.0.1',
  };
  const res = mockRes();

  for (const item of layer.route.stack) {
    if (res.ended) break;
    const handle = item.handle;
    if (handle.length >= 3) {
      await new Promise((resolve, reject) => {
        let nextCalled = false;
        const next = (err) => {
          nextCalled = true;
          err ? reject(err) : resolve();
        };
        Promise.resolve(handle(req, res, next))
          .then(() => {
            if (res.ended || nextCalled) resolve();
          })
          .catch(reject);
      });
    } else {
      await handle(req, res);
    }
  }

  return { status: res.statusCode, json: res.body };
}

function seedProduct(threshold) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare(`
    INSERT INTO categories (name, slug, emoji)
    VALUES (?, ?, ?)
  `).run(`LOW_STOCK_CAT_${suffix}`, `low-stock-cat-${suffix}`, 'T');
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold)
    VALUES (?, ?, ?, ?, 1, ?)
  `).run(
    category.lastInsertRowid,
    `LOW_STOCK_PRODUCT_${suffix}`,
    `low-stock-product-${suffix}`,
    1000,
    threshold,
  );
  return { categoryId: category.lastInsertRowid, productId: product.lastInsertRowid };
}

test('PUT /admin/products/:id accepts null lowStockThreshold to inherit the global setting', async (t) => {
  const { categoryId, productId } = seedProduct(5);
  t.after(() => {
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  });

  const { status, json } = await runRoute('put', '/:id', {
    params: { id: String(productId) },
    body: { lowStockThreshold: null },
  });

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  assert.strictEqual(json.data.lowStockThreshold, null);
  const row = db.prepare('SELECT low_stock_threshold FROM products WHERE id = ?').get(productId);
  assert.strictEqual(row.low_stock_threshold, null);
});

test('GET /admin/products returns raw and effective low stock thresholds', async (t) => {
  const oldSetting = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_alert_threshold'").get()?.value;
  db.prepare("UPDATE settings SET value = '7' WHERE key = 'low_stock_alert_threshold'").run();
  const { categoryId, productId } = seedProduct(null);
  t.after(() => {
    if (oldSetting === undefined) {
      db.prepare("DELETE FROM settings WHERE key = 'low_stock_alert_threshold'").run();
    } else {
      db.prepare("UPDATE settings SET value = ? WHERE key = 'low_stock_alert_threshold'").run(oldSetting);
    }
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(productId);
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  });

  const { status, json } = await runRoute('get', '/', { query: { view: 'all' } });

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  const product = json.data.find((p) => p.id === String(productId));
  assert.ok(product, 'expected product in response');
  assert.strictEqual(product.lowStockThreshold, null);
  assert.strictEqual(product.effectiveLowStockThreshold, 7);
  assert.strictEqual(product.usesDefaultLowStockThreshold, true);
});
