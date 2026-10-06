const assert = require('node:assert');
const test = require('node:test');
const Database = require('better-sqlite3');
const { listForUser, parseInboxQuery } = require('../../src/services/notificationInboxService');

// In-memory DB: tests in this repo otherwise run against the live shop.db.
function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, type TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT 't', body TEXT NOT NULL DEFAULT 'b', data TEXT,
      is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

function add(db, userId, type, minutesAgo, isRead = 0) {
  return db.prepare("INSERT INTO notifications (user_id, type, is_read, created_at) VALUES (?, ?, ?, datetime('now', ?))")
    .run(userId, type, isRead, `-${minutesAgo} minutes`).lastInsertRowid;
}

test('parseInboxQuery keeps only safe type names and understands unread', () => {
  assert.deepStrictEqual(parseInboxQuery({}), { types: [], unreadOnly: false });
  assert.deepStrictEqual(parseInboxQuery({ type: 'renewal_reminder, stock_alert', unread: '1' }), {
    types: ['renewal_reminder', 'stock_alert'], unreadOnly: true,
  });
  assert.deepStrictEqual(parseInboxQuery({ type: "x'; DROP TABLE notifications;--,ok_type" }).types, ['ok_type']);
  assert.strictEqual(parseInboxQuery({ unread: 'true' }).unreadOnly, true);
  assert.strictEqual(parseInboxQuery({ unread: '0' }).unreadOnly, false);
  assert.ok(parseInboxQuery({ type: Array.from({ length: 30 }, (_, i) => `t${i}`.replace(/\d/g, 'a')).join(',') }).types.length <= 8);
});

test('without filters returns the newest rows of every type for that user only', () => {
  const db = makeDb();
  add(db, 1, 'stock_alert', 5); add(db, 1, 'renewal_reminder', 10); add(db, 2, 'stock_alert', 1);
  const rows = listForUser(1, {}, db);
  assert.deepStrictEqual(rows.map((r) => r.type), ['stock_alert', 'renewal_reminder']);
});

test('type filter keeps older renewal reminders visible behind many newer bulk rows', () => {
  const db = makeDb();
  const old = add(db, 1, 'renewal_reminder', 1000);
  for (let i = 0; i < 60; i++) add(db, 1, 'stock_alert', i + 1);
  assert.ok(!listForUser(1, {}, db).some((r) => r.id === old), 'unfiltered top-50 hides it (the original bug)');
  assert.deepStrictEqual(listForUser(1, { types: ['renewal_reminder'] }, db).map((r) => r.id), [old]);
});

test('unreadOnly drops read rows, limit caps the result and newest comes first', () => {
  const db = makeDb();
  const read = add(db, 1, 'stock_alert', 1, 1);
  const a = add(db, 1, 'stock_alert', 3); const b = add(db, 1, 'stock_alert', 2);
  assert.deepStrictEqual(listForUser(1, { unreadOnly: true }, db).map((r) => r.id), [b, a]);
  assert.ok(!listForUser(1, { unreadOnly: true }, db).some((r) => r.id === read));
  assert.strictEqual(listForUser(1, { limit: 1 }, db).length, 1);
});
