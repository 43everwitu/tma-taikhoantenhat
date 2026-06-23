const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { up } = require('../../src/database/migrations/054_memo_less_payment_matching');

test('migration thêm metadata đối chiếu giao dịch và có thể chạy lặp lại', () => {
  const db = new Database(':memory:');

  try {
    db.exec(`
      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT
      )
    `);

    up(db);
    up(db);

    const columns = new Map(
      db.prepare('PRAGMA table_info(transactions)').all()
        .map((column) => [column.name, column.type])
    );

    assert.equal(columns.get('bank_transaction_at'), 'DATETIME');
    assert.equal(columns.get('match_reason'), 'TEXT');
    assert.equal(columns.get('candidate_order_ids_json'), 'TEXT');
  } finally {
    db.close();
  }
});
