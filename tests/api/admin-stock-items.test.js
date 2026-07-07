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

function seedSoldStock() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 871_000_000 + Math.floor(Math.random() * 100000);
  const originalKey = `sold-stock-key-${suffix}`;
  const updatedKey = `updated-sold-stock-key-${suffix}`;

  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(
    userId,
    `stock_user_${suffix}`,
    `Stock User ${suffix}`,
  );

  const category = db.prepare('INSERT INTO categories (name, slug, emoji) VALUES (?, ?, ?)').run(
    `STOCK_ITEMS_CAT_${suffix}`,
    `stock-items-cat-${suffix}`,
    'K',
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Stock Items Product ${suffix}`, `stock-items-product-${suffix}`);
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, ?, 1000, 1)
  `).run(product.lastInsertRowid, `Gói cũ ${suffix}`);

  const targetProduct = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 2000, 1)
  `).run(category.lastInsertRowid, `Stock Items Target ${suffix}`, `stock-items-target-${suffix}`);
  const targetVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active)
    VALUES (?, ?, 2000, 1)
  `).run(targetProduct.lastInsertRowid, `Gói mới ${suffix}`);

  const order = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, variant_id, quantity, total_price, payment_code,
      status, source, delivered_at, delivered_keys_json
    ) VALUES (?, ?, ?, 1, 1000, ?, 'delivered', 'web', datetime('now'), ?)
  `).run(
    userId,
    product.lastInsertRowid,
    variant.lastInsertRowid,
    `PNS_STOCK_${suffix}`,
    JSON.stringify([originalKey]),
  );

  const stock = db.prepare(`
    INSERT INTO stock (
      product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at
    ) VALUES (?, ?, ?, 30, 1, ?, datetime('now'))
  `).run(product.lastInsertRowid, variant.lastInsertRowid, originalKey, userId);

  return {
    suffix,
    userId,
    originalKey,
    updatedKey,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    variantId: variant.lastInsertRowid,
    targetProductId: targetProduct.lastInsertRowid,
    targetVariantId: targetVariant.lastInsertRowid,
    orderId: order.lastInsertRowid,
    stockId: stock.lastInsertRowid,
  };
}

function seedProductOnly() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare('INSERT INTO categories (name, slug, emoji) VALUES (?, ?, ?)').run(
    `STOCK_ADD_CAT_${suffix}`,
    `stock-add-cat-${suffix}`,
    'K',
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Stock Add Product ${suffix}`, `stock-add-product-${suffix}`);

  return {
    suffix,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
  };
}

function cleanup(seed) {
  if (seed.stockId) db.prepare('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?').run('stock', seed.stockId);
  if (seed.orderId) db.prepare('DELETE FROM orders WHERE id = ?').run(seed.orderId);
  if (seed.stockId) db.prepare('DELETE FROM stock WHERE id = ?').run(seed.stockId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(seed.productId);
  if (seed.targetProductId) {
    db.prepare('DELETE FROM product_variants WHERE product_id IN (?, ?)').run(seed.productId, seed.targetProductId);
    db.prepare('DELETE FROM products WHERE id IN (?, ?)').run(seed.productId, seed.targetProductId);
  } else {
    db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(seed.productId);
    db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  }
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
  if (seed.userId) db.prepare('DELETE FROM users WHERE telegram_id = ?').run(seed.userId);
}

test('POST /admin/stock/:productId stores added_at so new keys show creation time', async (t) => {
  const seed = seedProductOnly();
  const keyValue = `new-stock-key-${seed.suffix}`;
  t.after(() => cleanup(seed));

  const add = await runRoute('post', '/:productId', {
    params: { productId: String(seed.productId) },
    body: { items: [keyValue], durationDays: 30 },
  });

  assert.strictEqual(add.status, 200, `unexpected body: ${JSON.stringify(add.json)}`);
  assert.strictEqual(add.json.success, true);

  const list = await runRoute('get', '/', { query: { q: keyValue, sold: 'false' } });
  assert.strictEqual(list.status, 200, `unexpected body: ${JSON.stringify(list.json)}`);
  assert.strictEqual(list.json.data.items.length, 1);
  assert.ok(list.json.data.items[0].createdAt, 'expected createdAt in API response');

  const stock = db.prepare('SELECT id, added_at FROM stock WHERE data = ?').get(keyValue);
  seed.stockId = stock.id;
  assert.ok(stock.added_at, 'expected stock.added_at to be stored');
});

test('GET /admin/stock includes sold order and customer information when snapshot matches', async (t) => {
  const seed = seedSoldStock();
  t.after(() => cleanup(seed));

  const { status, json } = await runRoute('get', '/', {
    query: { sold: 'true', q: seed.originalKey },
  });

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  assert.strictEqual(json.data.items.length, 1);
  const item = json.data.items[0];
  assert.strictEqual(item.id, String(seed.stockId));
  assert.deepStrictEqual(item.soldOrder, {
    id: String(seed.orderId),
    paymentCode: `PNS_STOCK_${seed.suffix}`,
    status: 'delivered',
    deliveredAt: item.soldOrder.deliveredAt,
  });
  assert.ok(item.soldOrder.deliveredAt);
  assert.deepStrictEqual(item.soldCustomer, {
    telegramId: seed.userId,
    username: `stock_user_${seed.suffix}`,
    fullName: `Stock User ${seed.suffix}`,
  });
});

test('PATCH /admin/stock/items/:itemId edits sold stock without changing delivered order snapshot', async (t) => {
  const seed = seedSoldStock();
  t.after(() => cleanup(seed));

  const { status, json } = await runRoute('patch', '/items/:itemId', {
    params: { itemId: String(seed.stockId) },
    body: {
      content: seed.updatedKey,
      productId: seed.targetProductId,
      variantId: seed.targetVariantId,
      durationDays: 45,
    },
  });

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);

  const stock = db.prepare('SELECT data, product_id, variant_id, duration_days, is_sold FROM stock WHERE id = ?')
    .get(seed.stockId);
  assert.deepStrictEqual(stock, {
    data: seed.updatedKey,
    product_id: seed.targetProductId,
    variant_id: seed.targetVariantId,
    duration_days: 45,
    is_sold: 1,
  });

  const order = db.prepare('SELECT delivered_keys_json FROM orders WHERE id = ?').get(seed.orderId);
  assert.deepStrictEqual(JSON.parse(order.delivered_keys_json), [seed.originalKey]);
});

test('DELETE /admin/stock/items/:itemId deletes sold stock without changing delivered order snapshot', async (t) => {
  const seed = seedSoldStock();
  t.after(() => cleanup(seed));

  const { status, json } = await runRoute('delete', '/items/:itemId', {
    params: { itemId: String(seed.stockId) },
  });

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);

  const stock = db.prepare('SELECT id FROM stock WHERE id = ?').get(seed.stockId);
  assert.strictEqual(stock, undefined);

  const order = db.prepare('SELECT delivered_keys_json FROM orders WHERE id = ?').get(seed.orderId);
  assert.deepStrictEqual(JSON.parse(order.delivered_keys_json), [seed.originalKey]);
});
