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
  app.use((req, _res, next) => {
    req.admin = { adminId: 1, role: 'super_admin', username: 'admin' };
    next();
  });
  app.use('/admin/products', require('../../src/api/routes/admin/products'));
  return app;
}

function createProduct({ archived, active = true }) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare(`
    INSERT INTO categories (name, slug, emoji)
    VALUES (?, ?, ?)
  `).run(`ARCHIVE_VIEW_CAT_${suffix}`, `archive-view-cat-${suffix}`, 'T');
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, is_archived)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    category.lastInsertRowid,
    `ARCHIVE_VIEW_PRODUCT_${suffix}`,
    `archive-view-product-${suffix}`,
    1000,
    active ? 1 : 0,
    archived ? 1 : 0
  );
  return { categoryId: category.lastInsertRowid, productId: product.lastInsertRowid };
}

test('GET /admin/products separates active and archived products', async (t) => {
  const active = createProduct({ archived: false });
  const archived = createProduct({ archived: true });
  t.after(() => {
    for (const id of [active.productId, archived.productId]) {
      db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(id);
      db.prepare('DELETE FROM stock WHERE product_id = ?').run(id);
      db.prepare('DELETE FROM products WHERE id = ?').run(id);
    }
    db.prepare('DELETE FROM categories WHERE id IN (?, ?)').run(active.categoryId, archived.categoryId);
  });

  const app = makeApp();
  const defaultView = await getJson(app, '/admin/products');
  const archiveView = await getJson(app, '/admin/products?view=archived');
  const allView = await getJson(app, '/admin/products?view=all');

  assert.strictEqual(defaultView.status, 200, `unexpected body: ${JSON.stringify(defaultView.json)}`);
  assert.ok(defaultView.json.data.some((p) => p.id === String(active.productId)));
  assert.ok(!defaultView.json.data.some((p) => p.id === String(archived.productId)));

  assert.strictEqual(archiveView.status, 200, `unexpected body: ${JSON.stringify(archiveView.json)}`);
  assert.ok(!archiveView.json.data.some((p) => p.id === String(active.productId)));
  assert.ok(archiveView.json.data.some((p) => p.id === String(archived.productId)));

  assert.strictEqual(allView.status, 200, `unexpected body: ${JSON.stringify(allView.json)}`);
  assert.ok(allView.json.data.some((p) => p.id === String(active.productId)));
  assert.ok(allView.json.data.some((p) => p.id === String(archived.productId)));
});

test('GET /admin/products treats older audited deletes as archived', async (t) => {
  const legacy = createProduct({ archived: false, active: false });
  const audit = db.prepare(`
    INSERT INTO audit_log (admin_id, action, entity_type, entity_id, details)
    VALUES (?, 'product.delete', 'product', ?, ?)
  `).run(1, legacy.productId, JSON.stringify({ archived: true }));
  t.after(() => {
    db.prepare('DELETE FROM audit_log WHERE id = ?').run(audit.lastInsertRowid);
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(legacy.productId);
    db.prepare('DELETE FROM stock WHERE product_id = ?').run(legacy.productId);
    db.prepare('DELETE FROM products WHERE id = ?').run(legacy.productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(legacy.categoryId);
  });

  const app = makeApp();
  const defaultView = await getJson(app, '/admin/products');
  const archiveView = await getJson(app, '/admin/products?view=archived');

  assert.strictEqual(defaultView.status, 200, `unexpected body: ${JSON.stringify(defaultView.json)}`);
  assert.ok(!defaultView.json.data.some((p) => p.id === String(legacy.productId)));

  assert.strictEqual(archiveView.status, 200, `unexpected body: ${JSON.stringify(archiveView.json)}`);
  const archivedRow = archiveView.json.data.find((p) => p.id === String(legacy.productId));
  assert.ok(archivedRow);
  assert.strictEqual(archivedRow.archived, true);
});
