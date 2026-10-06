const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

const orderExpiryService = require('../../src/services/orderExpiryService');

function seedDeliveredOrder({ soldOffset = '-10 days', durationDays = 30, reminderDays = 3 } = {}) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 893_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run('key_expiry_reminder_days', String(reminderDays));
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Expiry User ${suffix}`);
  const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
    `expiry-cat-${suffix}`,
    `expiry-cat-${suffix}`,
  );
  const product = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, ?, ?, 1000, 1)
  `).run(category.lastInsertRowid, `Expiry product ${suffix}`, `expiry-product-${suffix}`);
  const order = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source, delivered_at, delivered_keys_json)
    VALUES (?, ?, 1, 1000, ?, 'delivered', 'telegram', datetime('now'), ?)
  `).run(userId, product.lastInsertRowid, `PNS_EXPIRY_${suffix}`, JSON.stringify([`key-${suffix}`]));
  const stock = db.prepare(`
    INSERT INTO stock (product_id, data, duration_days, is_sold, sold_to, sold_at)
    VALUES (?, ?, ?, 1, ?, datetime('now', ?))
  `).run(product.lastInsertRowid, `key-${suffix}`, durationDays, userId, soldOffset);

  return {
    userId,
    categoryId: category.lastInsertRowid,
    productId: product.lastInsertRowid,
    productSlug: `expiry-product-${suffix}`,
    orderId: order.lastInsertRowid,
    stockId: stock.lastInsertRowid,
  };
}

function cleanup(seed) {
  const hasRenewalLogs = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'renewal_reminder_logs'").get();
  if (hasRenewalLogs) db.prepare('DELETE FROM renewal_reminder_logs WHERE stock_id = ?').run(seed.stockId);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(seed.userId);
  db.prepare('DELETE FROM stock WHERE id = ?').run(seed.stockId);
  db.prepare('DELETE FROM orders WHERE id = ?').run(seed.orderId);
  db.prepare('DELETE FROM products WHERE id = ?').run(seed.productId);
  db.prepare('DELETE FROM categories WHERE id = ?').run(seed.categoryId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(seed.userId);
}

test('getKeyLifecycleForOrder marks delivered key as active before reminder window', () => {
  const seed = seedDeliveredOrder({ soldOffset: '-10 days', durationDays: 30, reminderDays: 3 });
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(seed.orderId);
    const lifecycle = orderExpiryService.getKeyLifecycleForOrder(order);

    assert.strictEqual(lifecycle.status, 'active');
    assert.strictEqual(lifecycle.statusLabel, 'Đang hoạt động');
    assert.ok(lifecycle.remainingDays > 3);
    assert.strictEqual(lifecycle.renewUrl, `/san-pham/${seed.productSlug}?renewFromOrderId=${seed.orderId}`);
    assert.strictEqual(lifecycle.orderUrl, `/don-hang/${seed.orderId}`);
    assert.strictEqual(lifecycle.progressPercent > 0, true);
  } finally {
    cleanup(seed);
  }
});

test('getKeyLifecycleForOrder marks delivered key as expiring soon inside reminder window', () => {
  const seed = seedDeliveredOrder({ soldOffset: '-27 days', durationDays: 30, reminderDays: 3 });
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(seed.orderId);
    const lifecycle = orderExpiryService.getKeyLifecycleForOrder(order);

    assert.strictEqual(lifecycle.status, 'expiring_soon');
    assert.strictEqual(lifecycle.statusLabel, 'Sắp hết hạn');
    assert.ok(lifecycle.remainingDays >= 0 && lifecycle.remainingDays <= 3);
  } finally {
    cleanup(seed);
  }
});

test('getKeyLifecycleForOrder marks renewalReminderSent only after a sent renewal log for the order', () => {
  const seed = seedDeliveredOrder({ soldOffset: '-27 days', durationDays: 30, reminderDays: 3 });
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(seed.orderId);
    const before = orderExpiryService.getKeyLifecycleForOrder(order);
    assert.strictEqual(before.renewalReminderSent, false);

    db.prepare(`
      INSERT INTO renewal_reminder_logs (
        stock_id, order_id, user_id, product_id, product_name, expiry_date,
        days_before_expiry, telegram_sent, status
      ) VALUES (?, ?, ?, ?, 'Expiry product', DATE('now', '+3 days'), 3, 1, 'sent')
    `).run(seed.stockId, seed.orderId, seed.userId, seed.productId);

    const after = orderExpiryService.getKeyLifecycleForOrder(order);
    assert.strictEqual(after.renewalReminderSent, true);
  } finally {
    cleanup(seed);
  }
});

test('getKeyLifecycleForOrder marks delivered key as expired after expiry date', () => {
  const seed = seedDeliveredOrder({ soldOffset: '-31 days', durationDays: 30, reminderDays: 3 });
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(seed.orderId);
    const lifecycle = orderExpiryService.getKeyLifecycleForOrder(order);

    assert.strictEqual(lifecycle.status, 'expired');
    assert.strictEqual(lifecycle.statusLabel, 'Đã hết hạn');
    assert.ok(lifecycle.remainingDays < 0);
    assert.strictEqual(lifecycle.progressPercent, 100);
  } finally {
    cleanup(seed);
  }
});

test('getKeyLifecycleForOrder returns null when delivered stock has no duration', () => {
  const seed = seedDeliveredOrder({ soldOffset: '-10 days', durationDays: null, reminderDays: 3 });
  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(seed.orderId);
    const lifecycle = orderExpiryService.getKeyLifecycleForOrder(order);

    assert.strictEqual(lifecycle, null);
  } finally {
    cleanup(seed);
  }
});

test('getKeyLifecycleForOrder ignores older sold keys outside the order snapshot', () => {
  const seed = seedDeliveredOrder({ soldOffset: '0 days', durationDays: 90, reminderDays: 3 });
  const oldStock = db.prepare(`
    INSERT INTO stock (product_id, data, duration_days, is_sold, sold_to, sold_at)
    VALUES (?, ?, 7, 1, ?, datetime('now', '-11 days'))
  `).run(seed.productId, `old-key-${seed.orderId}`, seed.userId);

  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(seed.orderId);
    const lifecycle = orderExpiryService.getKeyLifecycleForOrder(order);
    const expectedExpiry = db.prepare("SELECT DATE('now', '+90 days') AS d").get().d;

    assert.strictEqual(lifecycle.expiryDate, expectedExpiry);
    assert.strictEqual(lifecycle.durationDays, 90);
    assert.strictEqual(lifecycle.status, 'active');
  } finally {
    db.prepare('DELETE FROM stock WHERE id = ?').run(oldStock.lastInsertRowid);
    cleanup(seed);
  }
});

test('getKeyLifecycleForOrder uses this order\'s own key when duplicate-data repeat purchase exists', () => {
  const seed = seedDeliveredOrder({ soldOffset: '-40 days', durationDays: 30, reminderDays: 3 });
  // Repeat purchase of the same instructional-text product: the new stock row
  // shares the exact same `data` text as the older, already-expired one
  // (e.g. a static "accept this invite" instruction reused per repurchase).
  const sameTextKey = db.prepare('SELECT data FROM stock WHERE id = ?').get(seed.stockId).data;
  const newOrder = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source, delivered_at, delivered_keys_json)
    VALUES (?, ?, 1, 1000, ?, 'delivered', 'telegram', datetime('now'), ?)
  `).run(seed.userId, seed.productId, `PNS_REPEAT_${seed.orderId}`, JSON.stringify([sameTextKey]));
  const newStock = db.prepare(`
    INSERT INTO stock (product_id, data, duration_days, is_sold, sold_to, sold_at)
    VALUES (?, ?, 30, 1, ?, datetime('now'))
  `).run(seed.productId, sameTextKey, seed.userId);

  try {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(newOrder.lastInsertRowid);
    const lifecycle = orderExpiryService.getKeyLifecycleForOrder(order);
    const expectedExpiry = db.prepare("SELECT DATE('now', '+30 days') AS d").get().d;

    assert.strictEqual(lifecycle.status, 'active');
    assert.strictEqual(lifecycle.expiryDate, expectedExpiry);
  } finally {
    db.prepare('DELETE FROM stock WHERE id = ?').run(newStock.lastInsertRowid);
    db.prepare('DELETE FROM orders WHERE id = ?').run(newOrder.lastInsertRowid);
    cleanup(seed);
  }
});

test('findDeliveredOrderForStock matches the order snapshot instead of the latest order', () => {
  const seed = seedDeliveredOrder({ soldOffset: '-20 days', durationDays: 30, reminderDays: 3 });
  const newerKey = `newer-key-${seed.orderId}`;
  const newerOrder = db.prepare(`
    INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source, delivered_at, delivered_keys_json)
    VALUES (?, ?, 1, 1000, ?, 'delivered', 'telegram', datetime('now'), ?)
  `).run(seed.userId, seed.productId, `PNS_NEWER_${seed.orderId}`, JSON.stringify([newerKey]));
  const newerStock = db.prepare(`
    INSERT INTO stock (product_id, data, duration_days, is_sold, sold_to, sold_at)
    VALUES (?, ?, 90, 1, ?, datetime('now'))
  `).run(seed.productId, newerKey, seed.userId);

  try {
    const oldStock = db.prepare('SELECT * FROM stock WHERE id = ?').get(seed.stockId);
    const matchedOrder = orderExpiryService.findDeliveredOrderForStock(oldStock);

    assert.strictEqual(matchedOrder.id, seed.orderId);
  } finally {
    db.prepare('DELETE FROM stock WHERE id = ?').run(newerStock.lastInsertRowid);
    db.prepare('DELETE FROM orders WHERE id = ?').run(newerOrder.lastInsertRowid);
    cleanup(seed);
  }
});
