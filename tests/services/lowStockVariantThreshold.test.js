const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function freshQuery() {
  delete require.cache[require.resolve('../../src/services/lowStockQuery')];
  return require('../../src/services/lowStockQuery');
}

function seedProductWithVariants() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `variant-low-cat-${suffix}`,
    `variant-low-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, last_low_stock_alert_at)
    VALUES (?, ?, ?, 1000, 1, 5, NULL)
  `).run(category.lastInsertRowid, `Variant low product ${suffix}`, `variant-low-product-${suffix}`);
  const lowVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
    VALUES (?, ?, 1000, 1, 0)
  `).run(product.lastInsertRowid, `Low variant ${suffix}`);
  const healthyVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
    VALUES (?, ?, 1000, 1, 0)
  `).run(product.lastInsertRowid, `Healthy variant ${suffix}`);
  const backorderVariant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
    VALUES (?, ?, 1000, 1, 1)
  `).run(product.lastInsertRowid, `Backorder variant ${suffix}`);

  const insertStock = db.prepare('INSERT INTO stock (product_id, variant_id, data, is_sold) VALUES (?, ?, ?, 0)');
  for (let i = 0; i < 3; i++) insertStock.run(product.lastInsertRowid, lowVariant.lastInsertRowid, `low-${i}-${suffix}`);
  for (let i = 0; i < 10; i++) insertStock.run(product.lastInsertRowid, healthyVariant.lastInsertRowid, `healthy-${i}-${suffix}`);

  return {
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    lowVariantId: lowVariant.lastInsertRowid,
    healthyVariantId: healthyVariant.lastInsertRowid,
    backorderVariantId: backorderVariant.lastInsertRowid,
    lowVariantName: `Low variant ${suffix}`,
  };
}

function cleanup(seed) {
  const hasStates = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'low_stock_alert_states'").get();
  if (hasStates) db.prepare('DELETE FROM low_stock_alert_states WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
}

test('effectiveLowStockProducts reports low stock per active non-backorder variant', () => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_alert_threshold','5') ON CONFLICT(key) DO UPDATE SET value='5'").run();
  const seed = seedProductWithVariants();
  try {
    const rows = freshQuery().effectiveLowStockProducts();
    const low = rows.find((row) => row.variant_id === seed.lowVariantId);
    const healthy = rows.find((row) => row.variant_id === seed.healthyVariantId);
    const backorder = rows.find((row) => row.variant_id === seed.backorderVariantId);
    const productLevel = rows.find((row) => row.id === seed.productId && row.variant_id == null);

    assert.ok(low, 'expected low variant bucket to alert');
    assert.strictEqual(low.target_type, 'variant');
    assert.strictEqual(low.target_key, `v:${seed.lowVariantId}`);
    assert.strictEqual(low.variant_name, seed.lowVariantName);
    assert.strictEqual(low.stock_count, 3);
    assert.strictEqual(low.effective_threshold, 5);
    assert.strictEqual(healthy, undefined);
    assert.strictEqual(backorder, undefined);
    assert.strictEqual(productLevel, undefined);
  } finally {
    cleanup(seed);
  }
});

test('effectiveLowStockProducts respects variant-specific snooze without hiding sibling variants', () => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_alert_threshold','5') ON CONFLICT(key) DO UPDATE SET value='5'").run();
  const seed = seedProductWithVariants();
  try {
    db.prepare(`
      INSERT INTO low_stock_alert_states (target_key, target_type, product_id, variant_id, snoozed_until)
      VALUES (?, 'variant', ?, ?, datetime('now', '+24 hours'))
    `).run(`v:${seed.lowVariantId}`, seed.productId, seed.lowVariantId);

    const rows = freshQuery().effectiveLowStockProducts();
    assert.strictEqual(rows.find((row) => row.variant_id === seed.lowVariantId), undefined);
  } finally {
    cleanup(seed);
  }
});

test('effectiveOutOfStockProducts reports a previously-alerted zero-stock variant despite snooze', () => {
  const seed = seedProductWithVariants();
  try {
    db.prepare('UPDATE stock SET is_sold = 1 WHERE variant_id = ?').run(seed.lowVariantId);
    db.prepare(`
      INSERT INTO low_stock_alert_states (
        target_key, target_type, product_id, variant_id,
        last_alert_at, snoozed_until, out_of_stock_alert_at
      )
      VALUES (?, 'variant', ?, ?, CURRENT_TIMESTAMP, datetime('now', '+24 hours'), NULL)
    `).run(`v:${seed.lowVariantId}`, seed.productId, seed.lowVariantId);

    const rows = freshQuery().effectiveOutOfStockProducts();
    const hit = rows.find((row) => row.variant_id === seed.lowVariantId);

    assert.ok(hit, 'expected zero-stock variant bucket');
    assert.strictEqual(hit.stock_count, 0);
    assert.strictEqual(hit.target_key, `v:${seed.lowVariantId}`);
    assert.strictEqual(rows.some((row) => row.variant_id === seed.healthyVariantId), false);
    assert.strictEqual(rows.some((row) => row.variant_id === seed.backorderVariantId), false);
  } finally {
    cleanup(seed);
  }
});

test('effectiveOutOfStockProducts requires low-stock state and suppresses an already-alerted bucket', () => {
  const seed = seedProductWithVariants();
  try {
    db.prepare('UPDATE stock SET is_sold = 1 WHERE variant_id = ?').run(seed.lowVariantId);
    assert.strictEqual(
      freshQuery().effectiveOutOfStockProducts().some((row) => row.variant_id === seed.lowVariantId),
      false,
    );

    db.prepare(`
      INSERT INTO low_stock_alert_states (
        target_key, target_type, product_id, variant_id,
        last_alert_at, out_of_stock_alert_at
      )
      VALUES (?, 'variant', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(`v:${seed.lowVariantId}`, seed.productId, seed.lowVariantId);

    assert.strictEqual(
      freshQuery().effectiveOutOfStockProducts().some((row) => row.variant_id === seed.lowVariantId),
      false,
    );
  } finally {
    cleanup(seed);
  }
});

test('effectiveOutOfStockProducts supports product-level stock buckets', () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `product-out-cat-${suffix}`,
    `product-out-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold)
    VALUES (?, ?, ?, 1000, 1, 5)
  `).run(category.lastInsertRowid, `Product out ${suffix}`, `product-out-${suffix}`);
  try {
    db.prepare(`
      INSERT INTO low_stock_alert_states (
        target_key, target_type, product_id, variant_id, last_alert_at
      )
      VALUES (?, 'product', ?, NULL, CURRENT_TIMESTAMP)
    `).run(`p:${product.lastInsertRowid}`, product.lastInsertRowid);

    const hit = freshQuery().effectiveOutOfStockProducts()
      .find((row) => row.target_key === `p:${product.lastInsertRowid}`);
    assert.ok(hit, 'expected product-level zero-stock bucket');
    assert.strictEqual(hit.variant_id, null);
  } finally {
    db.prepare('DELETE FROM low_stock_alert_states WHERE product_id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(category.lastInsertRowid);
  }
});

test('effectiveOutOfStockProducts excludes products with only active backorder variants', () => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `backorder-out-cat-${suffix}`,
    `backorder-out-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold)
    VALUES (?, ?, ?, 1000, 1, 5)
  `).run(category.lastInsertRowid, `Backorder out ${suffix}`, `backorder-out-${suffix}`);
  const variant = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
    VALUES (?, ?, 1000, 1, 1)
  `).run(product.lastInsertRowid, `Manual variant ${suffix}`);
  try {
    db.prepare(`
      INSERT INTO low_stock_alert_states (
        target_key, target_type, product_id, variant_id, last_alert_at
      )
      VALUES (?, 'product', ?, NULL, CURRENT_TIMESTAMP)
    `).run(`p:${product.lastInsertRowid}`, product.lastInsertRowid);

    const rows = freshQuery().effectiveOutOfStockProducts();
    assert.strictEqual(rows.some((row) => row.id === product.lastInsertRowid), false);
  } finally {
    db.prepare('DELETE FROM low_stock_alert_states WHERE product_id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM product_variants WHERE id = ?').run(variant.lastInsertRowid);
    db.prepare('DELETE FROM products WHERE id = ?').run(product.lastInsertRowid);
    db.prepare('DELETE FROM categories WHERE id = ?').run(category.lastInsertRowid);
  }
});

test('clearRecoveredLowStockStates resets out-of-stock marker when stock returns', () => {
  const seed = seedProductWithVariants();
  try {
    db.prepare(`
      INSERT INTO low_stock_alert_states (
        target_key, target_type, product_id, variant_id,
        last_alert_at, out_of_stock_alert_at
      )
      VALUES (?, 'variant', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(`v:${seed.lowVariantId}`, seed.productId, seed.lowVariantId);

    freshQuery().clearRecoveredLowStockStates();

    const state = db.prepare(`
      SELECT last_alert_at, out_of_stock_alert_at
      FROM low_stock_alert_states
      WHERE target_key = ?
    `).get(`v:${seed.lowVariantId}`);
    assert.ok(state.last_alert_at, 'low-stock episode should remain active below threshold');
    assert.strictEqual(state.out_of_stock_alert_at, null);
  } finally {
    cleanup(seed);
  }
});
