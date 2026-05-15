const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function makeFakeBot(sent) {
  return { telegram: { sendMessage: async (...args) => { sent.push(args); } } };
}

test('checkLowStock sends only once per product within 24h', async () => {
  // Fresh module load + wire fake bot through adminNotifyService.
  delete require.cache[require.resolve('../../src/services/adminNotifyService')];
  delete require.cache[require.resolve('../../src/services/notificationService')];
  const adminNotify = require('../../src/services/adminNotifyService');
  const { NotificationService } = require('../../src/services/notificationService');

  // Ensure low-stock alert is enabled (default-on but settings row may exist).
  db.prepare("INSERT INTO settings (key, value) VALUES ('notify_admin_low_stock','true') ON CONFLICT(key) DO UPDATE SET value='true'").run();
  // Ensure no chat override (so adminNotifyService falls back to ADMIN_ID and goes through bot.telegram.sendMessage).
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_chat_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();
  db.prepare("INSERT INTO settings (key, value) VALUES ('low_stock_thread_id','') ON CONFLICT(key) DO UPDATE SET value=''").run();

  const sent = [];
  const fakeBot = makeFakeBot(sent);
  adminNotify.init(fakeBot);
  adminNotify.invalidateCache();

  // Seed one low-stock product with explicit threshold 5, stock count 1.
  const slug = 'd-' + Math.floor(Math.random() * 1e9);
  const cat = db.prepare("INSERT INTO categories (name, slug) VALUES ('d', ?)").run(slug);
  const p = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active, low_stock_threshold, last_low_stock_alert_at)
    VALUES (?, 'Dedup', ?, 1000, 1, 5, NULL)
  `).run(cat.lastInsertRowid, slug);
  db.prepare("INSERT INTO stock (product_id, data, is_sold) VALUES (?, 'k', 0)").run(p.lastInsertRowid);

  const svc = new NotificationService(fakeBot);
  await svc.checkLowStock();
  await svc.checkLowStock();
  await svc.checkLowStock();

  assert.strictEqual(sent.length, 1, `Expected exactly 1 send, got ${sent.length}`);

  // Cleanup
  db.prepare("DELETE FROM stock WHERE product_id = ?").run(p.lastInsertRowid);
  db.prepare("DELETE FROM products WHERE id = ?").run(p.lastInsertRowid);
  db.prepare("DELETE FROM categories WHERE id = ?").run(cat.lastInsertRowid);
});
