/**
 * Migration 004: Fix orders sqlite_sequence
 *
 * Migration 003 used INSERT OR REPLACE on sqlite_sequence, which has no UNIQUE
 * constraint on `name` — so a duplicate row can exist. SQLite then picks the
 * lower seq for AUTOINCREMENT, defeating the reseed.
 *
 * This migration removes ALL `orders` rows from sqlite_sequence and sets a
 * single seed = 100000 so the next inserted order id is 100001.
 */

function up(db) {
  // sqlite_sequence is auto-created by SQLite once any AUTOINCREMENT row
  // is inserted. By migration 004 it always exists.

  // Remove any duplicate rows for `orders`
  db.prepare(`DELETE FROM sqlite_sequence WHERE name = 'orders'`).run();

  // Determine seed: must be ≥ MAX(orders.id), and at least 100000
  const maxRow = db.prepare(`SELECT MAX(id) as m FROM orders`).get();
  const maxId = (maxRow && maxRow.m) || 0;
  const seed = Math.max(100000, maxId);

  db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES ('orders', ?)`).run(seed);
}

module.exports = { up };
