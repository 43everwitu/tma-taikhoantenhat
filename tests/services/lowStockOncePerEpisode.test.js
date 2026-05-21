const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function makeFakeBot(sent) {
  return { telegram: { sendMessage: async (...args) => { sent.push(args); } } };
}

function seedLowStockProduct() {
  const slug = 'ep-' + Math.floor(Math.random() * 1e9);
  const cat = db.prepare("INSERT INTO categories (name, slug) VALUES ('ep', ?)").run(slug);
  const p = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, last_low_stock_alert_at)
    VALUES (?, 'Episode', ?, 1000, 1, 5, NULL)
  `).run(cat.lastInsertRowid, slug);
  db.prepare("INSERT INTO stock (product_id, data, is_sold) VALUES (?, 'k', 0)").run(p.lastInsertRowid);
  return { productId: p.lastInsertRowid, categoryId: cat.lastInsertRowid };
}

function cleanup({ productId, categoryId }) {
  db.prepare("DELETE FROM stock WHERE product_id = ?").run(productId);
  db.prepare("DELETE FROM products WHERE id = ?").run(productId);
  db.prepare("DELETE FROM categories WHERE id = ?").run(categoryId);
}

function loadServiceFresh(fakeBot) {
  delete require.cache[require.resolve('../../src/services/adminNotifyService')];
  delete require.cache[require.resolve('../../src/services/notificationService')];
  delete require.cache[require.resolve('../../src/services/lowStockQuery')];
  const adminNotify = require('../../src/services/adminNotifyService');
  const { NotificationService } = require('../../src/services/notificationService');
  db.prepare("INSERT INTO settings (key, value) VALUES ('notify_admin_low_stock','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_chat_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_thread_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  adminNotify.init(fakeBot);
  adminNotify.invalidateCache();
  return new NotificationService(fakeBot);
}

function sentForProduct(sent, productId) {
  const marker = `<code>${productId}</code>`;
  return sent.filter(args => String(args[1] || '').includes(marker));
}

test('no re-alert after 24h while stock still low', async () => {
  const seeded = seedLowStockProduct();
  const sent = [];
  const svc = loadServiceFresh(makeFakeBot(sent));
  try {
    // First tick — alerts (transition NULL → NOW).
    await svc.checkLowStock();
    assert.strictEqual(sentForProduct(sent, seeded.productId).length, 1);

    // Backdate marker to 25h ago (past the old 24h throttle window) — stock is still low.
    db.prepare(
      "UPDATE products SET last_low_stock_alert_at = datetime('now','-25 hours') WHERE id = ?"
    ).run(seeded.productId);

    // Second tick — must NOT re-alert. Old behavior would have re-alerted here.
    await svc.checkLowStock();
    assert.strictEqual(
      sentForProduct(sent, seeded.productId).length,
      1,
      'Re-alerted after 24h while still low — should suppress until stock replenished'
    );
  } finally {
    cleanup(seeded);
  }
});

test('self-heal resets marker when stock rises above threshold without notifyStockReplenished', async () => {
  const seeded = seedLowStockProduct();
  const sent = [];
  const svc = loadServiceFresh(makeFakeBot(sent));
  try {
    // First tick — alerts and stamps marker.
    await svc.checkLowStock();
    assert.strictEqual(sentForProduct(sent, seeded.productId).length, 1);
    const stamped = db.prepare(
      'SELECT last_low_stock_alert_at FROM products WHERE id = ?'
    ).get(seeded.productId).last_low_stock_alert_at;
    assert.ok(stamped, 'marker should be set after first alert');

    // Simulate stock rising above threshold via a code path that does NOT call
    // notifyStockReplenished — e.g., an order cancel returning reserved keys,
    // or a manual SQL insert. We just bulk-insert 10 more stock rows.
    for (let i = 0; i < 10; i++) {
      db.prepare("INSERT INTO stock (product_id, data, is_sold) VALUES (?, ?, 0)")
        .run(seeded.productId, `k${i}`);
    }

    // Next tick — self-heal should NULL the marker (stock now > threshold).
    await svc.checkLowStock();
    const cleared = db.prepare(
      'SELECT last_low_stock_alert_at FROM products WHERE id = ?'
    ).get(seeded.productId).last_low_stock_alert_at;
    assert.strictEqual(
      cleared,
      null,
      'self-heal pass should NULL the marker once stock is above threshold'
    );

    // Now drop back to low stock — should alert again (new episode).
    // Use 'k_%' (≥1 char after 'k') so we delete the bulk rows k0..k9 but
    // leave the seed row data='k' in place (otherwise stock_count drops to 0
    // and the `stock_count > 0` filter excludes the product from the alert).
    db.prepare("DELETE FROM stock WHERE product_id = ? AND data LIKE 'k_%'")
      .run(seeded.productId);
    await svc.checkLowStock();
    assert.strictEqual(
      sentForProduct(sent, seeded.productId).length,
      2,
      'second episode should re-alert after self-heal cleared the marker'
    );
  } finally {
    cleanup(seeded);
  }
});
