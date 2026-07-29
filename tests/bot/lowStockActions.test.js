const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function ensureSnoozeColumn() {
  const has = db.prepare('PRAGMA table_info(products)').all()
    .some((col) => col.name === 'low_stock_snoozed_until');
  if (!has) db.exec('ALTER TABLE products ADD COLUMN low_stock_snoozed_until DATETIME');
}

function seedProduct() {
  ensureSnoozeColumn();
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`action-cat-${suffix}`, `action-cat-${suffix}`);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, low_stock_snoozed_until)
    VALUES (?, 'Action Low', ?, 1000, 1, 5, NULL)
  `).run(cat.lastInsertRowid, `action-product-${suffix}`);
  return { productId: product.lastInsertRowid, categoryId: cat.lastInsertRowid };
}

function cleanup(seed) {
  db.prepare('DELETE FROM low_stock_alert_states WHERE product_id = ?').run(seed.productId);
  if (seed.variantId) db.prepare('DELETE FROM product_variants WHERE id = ?').run(seed.variantId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
}

test('low stock done callback snoozes product for 24h and deletes message', async () => {
  const seed = seedProduct();
  const actions = [];
  const fakeBot = {
    action(pattern, handler) {
      actions.push({ pattern, handler });
    },
  };
  try {
    require('../../src/bot/lowStockActions')(fakeBot);
    const registered = actions.find((item) => item.pattern.test(`lowstock_done:${seed.productId}`));
    assert.ok(registered, 'expected lowstock_done action registration');

    let answered = null;
    let deleted = false;
    const ctx = {
      match: [`lowstock_done:${seed.productId}`, String(seed.productId)],
      answerCbQuery: async (message) => { answered = message; },
      deleteMessage: async () => { deleted = true; },
    };

    await registered.handler(ctx);

    const row = db.prepare('SELECT low_stock_snoozed_until FROM products WHERE id = ?').get(seed.productId);
    assert.ok(row.low_stock_snoozed_until, 'expected snooze timestamp');
    assert.ok(new Date(`${row.low_stock_snoozed_until}Z`).getTime() > Date.now() + 23 * 60 * 60 * 1000);
    assert.strictEqual(deleted, true);
    assert.strictEqual(answered, 'Đã ẩn cảnh báo tồn kho 24h');
  } finally {
    cleanup(seed);
  }
});

test('low stock done callback snoozes variant bucket for 24h', async () => {
  const seed = seedProduct();
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
    VALUES (?, 'Action Variant', 1000, 1, 0)
  `).run(seed.productId);
  seed.variantId = variant.lastInsertRowid;

  const actions = [];
  const fakeBot = {
    action(pattern, handler) {
      actions.push({ pattern, handler });
    },
  };
  try {
    require('../../src/bot/lowStockActions')(fakeBot);
    const callbackData = `lowstock_done:v:${seed.variantId}`;
    const registered = actions.find((item) => item.pattern.test(callbackData));
    assert.ok(registered, 'expected variant lowstock_done action registration');

    let answered = null;
    let deleted = false;
    const ctx = {
      match: callbackData.match(registered.pattern),
      answerCbQuery: async (message) => { answered = message; },
      deleteMessage: async () => { deleted = true; },
    };

    await registered.handler(ctx);

    const row = db.prepare(`
      SELECT snoozed_until
      FROM low_stock_alert_states
      WHERE target_key = ?
    `).get(`v:${seed.variantId}`);
    assert.ok(row?.snoozed_until, 'expected variant snooze timestamp');
    assert.ok(new Date(`${row.snoozed_until}Z`).getTime() > Date.now() + 23 * 60 * 60 * 1000);
    assert.strictEqual(deleted, true);
    assert.strictEqual(answered, 'Đã ẩn cảnh báo tồn kho 24h');
  } finally {
    cleanup(seed);
  }
});

test('out-of-stock done callback deletes message without changing state', async () => {
  const seed = seedProduct();
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
    VALUES (?, 'Out Action Variant', 1000, 1, 0)
  `).run(seed.productId);
  seed.variantId = variant.lastInsertRowid;
  db.prepare(`
    INSERT INTO low_stock_alert_states (
      target_key, target_type, product_id, variant_id,
      last_alert_at, snoozed_until, out_of_stock_alert_at
    )
    VALUES (
      ?, 'variant', ?, ?, CURRENT_TIMESTAMP,
      datetime('now', '+24 hours'), CURRENT_TIMESTAMP
    )
  `).run(`v:${seed.variantId}`, seed.productId, seed.variantId);

  const actions = [];
  const fakeBot = {
    action(pattern, handler) {
      actions.push({ pattern, handler });
    },
  };
  try {
    require('../../src/bot/lowStockActions')(fakeBot);
    const callbackData = `outstock_done:v:${seed.variantId}`;
    const registered = actions.find((item) => item.pattern.test(callbackData));
    assert.ok(registered, 'expected outstock_done action registration');

    const before = db.prepare(`
      SELECT snoozed_until, out_of_stock_alert_at
      FROM low_stock_alert_states
      WHERE target_key = ?
    `).get(`v:${seed.variantId}`);
    let answered = null;
    let deleted = false;
    await registered.handler({
      match: callbackData.match(registered.pattern),
      answerCbQuery: async (message) => { answered = message; },
      deleteMessage: async () => { deleted = true; },
    });

    const after = db.prepare(`
      SELECT snoozed_until, out_of_stock_alert_at
      FROM low_stock_alert_states
      WHERE target_key = ?
    `).get(`v:${seed.variantId}`);
    assert.strictEqual(deleted, true);
    assert.strictEqual(answered, 'Đã xóa cảnh báo. Hệ thống sẽ tự nhận biết khi có stock mới.');
    assert.deepStrictEqual(after, before);
  } finally {
    cleanup(seed);
  }
});

test('out-of-stock done callback answers even when message deletion fails', async () => {
  const actions = [];
  const fakeBot = {
    action(pattern, handler) {
      actions.push({ pattern, handler });
    },
  };
  require('../../src/bot/lowStockActions')(fakeBot);
  const callbackData = 'outstock_done:p:123';
  const registered = actions.find((item) => item.pattern.test(callbackData));
  assert.ok(registered, 'expected outstock_done action registration');

  let answered = null;
  await registered.handler({
    match: callbackData.match(registered.pattern),
    answerCbQuery: async (message) => { answered = message; },
    deleteMessage: async () => { throw new Error('cannot delete'); },
  });

  assert.strictEqual(answered, 'Đã xóa cảnh báo. Hệ thống sẽ tự nhận biết khi có stock mới.');
});
