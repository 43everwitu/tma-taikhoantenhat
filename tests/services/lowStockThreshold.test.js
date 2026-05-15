const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const { effectiveLowStockProducts } = require('../../src/services/lowStockQuery');

function seedProduct(threshold) {
  const slug = 't-' + Math.floor(Math.random() * 1e9);
  const cat = db.prepare("INSERT INTO categories (name, slug) VALUES ('t', ?)").run(slug);
  const r = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, last_low_stock_alert_at)
    VALUES (?, 'Test', ?, 1000, 1, ?, NULL)
  `).run(cat.lastInsertRowid, slug, threshold);
  return r.lastInsertRowid;
}

function addStock(productId, count) {
  const stmt = db.prepare("INSERT INTO stock (product_id, data, is_sold) VALUES (?, ?, 0)");
  for (let i = 0; i < count; i++) stmt.run(productId, `k${i}-${productId}`);
}

test('product with NULL threshold uses settings default (3) — appears when stock <= 3', () => {
  db.prepare("UPDATE settings SET value='3' WHERE key='low_stock_alert_threshold'").run();
  const id = seedProduct(null);
  addStock(id, 2);
  const rows = effectiveLowStockProducts();
  const hit = rows.find(r => r.id === id);
  assert.ok(hit, 'expected product in list');
  assert.strictEqual(hit.effective_threshold, 3);
  assert.strictEqual(hit.stock_count, 2);
});

test('product with explicit threshold=10 keeps its own value', () => {
  db.prepare("UPDATE settings SET value='3' WHERE key='low_stock_alert_threshold'").run();
  const id = seedProduct(10);
  addStock(id, 5);
  const rows = effectiveLowStockProducts();
  const hit = rows.find(r => r.id === id);
  assert.ok(hit, 'expected product in list');
  assert.strictEqual(hit.effective_threshold, 10);
});

test('product with stock=0 excluded even when threshold would match', () => {
  const id = seedProduct(5);
  // no stock added
  const rows = effectiveLowStockProducts();
  assert.strictEqual(rows.find(r => r.id === id), undefined);
});
