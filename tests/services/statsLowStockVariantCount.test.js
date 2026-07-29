const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function seedVariantLowStockProduct() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const cat = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(`stats-cat-${suffix}`, `stats-cat-${suffix}`);
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, last_low_stock_alert_at)
    VALUES (?, ?, ?, 1000, 1, 5, NULL)
  `).run(cat.lastInsertRowid, `Stats Low ${suffix}`, `stats-low-${suffix}`);
  const low = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
    VALUES (?, 'Low Variant', 1000, 1, 0)
  `).run(product.lastInsertRowid);
  const healthy = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, is_active, is_backorder)
    VALUES (?, 'Healthy Variant', 1000, 1, 0)
  `).run(product.lastInsertRowid);

  const insertStock = db.prepare(`
    INSERT INTO stock (product_id, variant_id, data, is_sold)
    VALUES (?, ?, ?, 0)
  `);
  for (let i = 0; i < 3; i++) insertStock.run(product.lastInsertRowid, low.lastInsertRowid, `low-${suffix}-${i}`);
  for (let i = 0; i < 10; i++) insertStock.run(product.lastInsertRowid, healthy.lastInsertRowid, `healthy-${suffix}-${i}`);

  return {
    categoryId: cat.lastInsertRowid,
    productId: product.lastInsertRowid,
    lowVariantId: low.lastInsertRowid,
    healthyVariantId: healthy.lastInsertRowid,
  };
}

function cleanup(seed) {
  db.prepare('DELETE FROM low_stock_alert_states WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM product_variants WHERE product_id = ?').run(seed.productId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
}

test('dashboard lowStockCount counts low-stock variant buckets, not product total stock', () => {
  const statsService = require('../../src/services/statsService');
  const before = statsService.getDashboardStats().lowStockCount;
  const seed = seedVariantLowStockProduct();
  try {
    const after = statsService.getDashboardStats().lowStockCount;
    assert.strictEqual(after, before + 1);
  } finally {
    cleanup(seed);
  }
});
