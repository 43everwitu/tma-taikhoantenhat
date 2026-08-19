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
  const router = require('../../src/api/routes/admin/stock');
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

function createFixture() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `reorder-cat-${suffix}`,
    `reorder-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Reorder product ${suffix}`, `reorder-product-${suffix}`);
  const otherProduct = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Reorder other product ${suffix}`, `reorder-other-product-${suffix}`);

  const insertStock = db.prepare('INSERT INTO stock (product_id, data, is_sold, sort_order) VALUES (?, ?, ?, ?)');
  const a = insertStock.run(product.lastInsertRowid, `key-a-${suffix}`, 0, 10);
  const b = insertStock.run(product.lastInsertRowid, `key-b-${suffix}`, 0, 20);
  const c = insertStock.run(product.lastInsertRowid, `key-c-${suffix}`, 0, 30);
  const sold = insertStock.run(product.lastInsertRowid, `key-sold-${suffix}`, 1, 40);
  const otherGroup = insertStock.run(otherProduct.lastInsertRowid, `key-other-${suffix}`, 0, 5);

  return {
    suffix,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    otherProductId: otherProduct.lastInsertRowid,
    aId: a.lastInsertRowid,
    bId: b.lastInsertRowid,
    cId: c.lastInsertRowid,
    soldId: sold.lastInsertRowid,
    otherGroupId: otherGroup.lastInsertRowid,
  };
}

function cleanup(fixture) {
  db.prepare('DELETE FROM audit_log WHERE entity_type = ?').run('stock');
  db.prepare('DELETE FROM stock WHERE product_id IN (?, ?)').run(fixture.productId, fixture.otherProductId);
  db.prepare('DELETE FROM products WHERE id IN (?, ?)').run(fixture.productId, fixture.otherProductId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
}

test('GET /admin/stock enables priorityMode + sortOrder only when product+variant+unsold are all narrowed', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  const narrowed = await runRoute('get', '/', {
    query: { productId: String(fixture.productId), variantId: '0', sold: 'false' },
  });
  assert.strictEqual(narrowed.json.data.priorityMode, true);
  assert.deepStrictEqual(narrowed.json.data.items.map(i => i.id), [String(fixture.aId), String(fixture.bId), String(fixture.cId)]);
  assert.strictEqual(narrowed.json.data.items[0].sortOrder, 10);

  const broad = await runRoute('get', '/', {
    query: { productId: String(fixture.productId), sold: 'false' },
  });
  assert.strictEqual(broad.json.data.priorityMode, false);
});

test('PATCH /admin/stock/_reorder interpolates sort_order between neighbors', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  const { status, json } = await runRoute('patch', '/_reorder', {
    body: { ids: [fixture.cId], beforeId: fixture.aId, afterId: fixture.bId },
  });
  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);

  const rows = db.prepare('SELECT id, sort_order FROM stock WHERE product_id = ? AND is_sold = 0 ORDER BY sort_order ASC').all(fixture.productId);
  assert.deepStrictEqual(rows.map(r => r.id), [fixture.aId, fixture.cId, fixture.bId]);
});

test('PATCH /admin/stock/_reorder moves to the very top when afterId only', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  const { status } = await runRoute('patch', '/_reorder', {
    body: { ids: [fixture.cId], beforeId: null, afterId: fixture.aId },
  });
  assert.strictEqual(status, 200);

  const rows = db.prepare('SELECT id FROM stock WHERE product_id = ? AND is_sold = 0 ORDER BY sort_order ASC').all(fixture.productId);
  assert.deepStrictEqual(rows.map(r => r.id), [fixture.cId, fixture.aId, fixture.bId]);
});

test('PATCH /admin/stock/_reorder moves multiple selected ids together preserving relative order', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  const { status } = await runRoute('patch', '/_reorder', {
    body: { ids: [fixture.bId, fixture.cId], beforeId: null, afterId: fixture.aId },
  });
  assert.strictEqual(status, 200);

  const rows = db.prepare('SELECT id FROM stock WHERE product_id = ? AND is_sold = 0 ORDER BY sort_order ASC').all(fixture.productId);
  assert.deepStrictEqual(rows.map(r => r.id), [fixture.bId, fixture.cId, fixture.aId]);
});

test('PATCH /admin/stock/_reorder rejects cross-group neighbor', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  const { status, json } = await runRoute('patch', '/_reorder', {
    body: { ids: [fixture.cId], beforeId: fixture.otherGroupId, afterId: null },
  });
  assert.strictEqual(status, 409);
  assert.strictEqual(json.success, false);
});

test('PATCH /admin/stock/_reorder rejects sold stock', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanup(fixture));

  const { status, json } = await runRoute('patch', '/_reorder', {
    body: { ids: [fixture.soldId], beforeId: fixture.aId, afterId: fixture.bId },
  });
  assert.strictEqual(status, 409);
  assert.strictEqual(json.success, false);
});
