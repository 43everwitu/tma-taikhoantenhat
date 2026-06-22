function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some((row) => row.name === column);
}

function addColumn(db, table, column, definition) {
  if (hasColumn(db, table, column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

function up(db) {
  addColumn(db, 'transactions', 'bank_transaction_at', 'DATETIME');
  addColumn(db, 'transactions', 'match_reason', 'TEXT');
  addColumn(db, 'transactions', 'candidate_order_ids_json', 'TEXT');
}

module.exports = { up };
