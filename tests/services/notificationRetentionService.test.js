const assert = require('node:assert');
const test = require('node:test');
const Database = require('better-sqlite3');
const { purgeOld, BULK_TYPES, RETENTION_DAYS } = require('../../src/services/notificationRetentionService');

// Uses an in-memory DB on purpose: tests in this repo otherwise run against the
// live data/shop.db and purging there would delete real customers' rows.
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function add(db, type, daysAgo, count = 1) {
  const stmt = db.prepare("INSERT INTO notifications (user_id, type, title, body, created_at) VALUES (1, ?, 't', 'b', datetime('now', ?))");
  for (let i = 0; i < count; i++) stmt.run(type, `-${daysAgo} days`);
}

const countBy = (db, type) => db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE type = ?').get(type).c;

test('purges only old bulk-type rows and keeps personal types and recent rows', () => {
  const db = makeDb();
  add(db, 'stock_alert', 40, 3);
  add(db, 'stock_alert', 5, 2);
  add(db, 'announcement', 31, 2);
  add(db, 'product_new', 90);
  add(db, 'order_update', 400, 2);
  add(db, 'renewal_reminder', 400);

  const removed = purgeOld(db);

  assert.strictEqual(removed, 3 + 2 + 1);
  assert.strictEqual(countBy(db, 'stock_alert'), 2);
  assert.strictEqual(countBy(db, 'announcement'), 0);
  assert.strictEqual(countBy(db, 'product_new'), 0);
  assert.strictEqual(countBy(db, 'order_update'), 2);
  assert.strictEqual(countBy(db, 'renewal_reminder'), 1);
});

test('rows exactly at the boundary are kept and the cutoff is configurable', () => {
  const db = makeDb();
  add(db, 'stock_alert', RETENTION_DAYS - 1);
  add(db, 'stock_alert', 10);
  add(db, 'stock_alert', 2);
  assert.strictEqual(purgeOld(db), 0);
  assert.strictEqual(purgeOld(db, { days: 7 }), 2);
  assert.strictEqual(countBy(db, 'stock_alert'), 1);
});

test('deletes in batches until nothing old is left', () => {
  const db = makeDb();
  add(db, 'stock_alert', 60, 25);
  add(db, 'stock_alert', 1, 4);
  assert.strictEqual(purgeOld(db, { batchSize: 10 }), 25);
  assert.strictEqual(countBy(db, 'stock_alert'), 4);
});

test('running on an empty or already clean table is a no-op', () => {
  const db = makeDb();
  assert.strictEqual(purgeOld(db), 0);
  add(db, 'stock_alert', 1);
  assert.strictEqual(purgeOld(db), 0);
});

test('bulk types cover the fan-out notification kinds', () => {
  for (const type of ['stock_alert', 'announcement', 'product_new', 'product_updated']) assert.ok(BULK_TYPES.includes(type), type);
  assert.ok(!BULK_TYPES.includes('order_update'));
});
