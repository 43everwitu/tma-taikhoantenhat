function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some((c) => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'product_variants', 'contact_only')) {
    db.exec('ALTER TABLE product_variants ADD COLUMN contact_only INTEGER');
  }
}

module.exports = { up };
