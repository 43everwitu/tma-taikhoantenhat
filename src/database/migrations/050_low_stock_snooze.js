function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'products', 'low_stock_snoozed_until')) {
    db.exec(`ALTER TABLE products ADD COLUMN low_stock_snoozed_until DATETIME`);
  }
}

module.exports = { up };
