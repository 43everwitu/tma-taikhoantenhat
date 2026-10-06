function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function addColumn(db, table, column, definition) {
  if (!hasColumn(db, table, column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function up(db) {
  addColumn(db, 'users', 'account_status', "TEXT NOT NULL DEFAULT 'active'");
  addColumn(db, 'users', 'ban_reason', 'TEXT');
  addColumn(db, 'users', 'banned_at', 'DATETIME');
  addColumn(db, 'users', 'banned_by', 'INTEGER');

  addColumn(db, 'orders', 'requires_manual_review', 'INTEGER NOT NULL DEFAULT 0');
  addColumn(db, 'orders', 'manual_review_reason', 'TEXT');

  db.prepare(`
    UPDATE users
    SET account_status = 'active'
    WHERE account_status IS NULL OR account_status = ''
  `).run();
}

module.exports = { up };
