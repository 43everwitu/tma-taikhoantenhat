function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some((row) => row.name === column);
}

function up(db) {
  if (!hasColumn(db, 'users', 'telegram_unreachable_at')) {
    db.exec('ALTER TABLE users ADD COLUMN telegram_unreachable_at DATETIME');
  }
}

module.exports = { up };
