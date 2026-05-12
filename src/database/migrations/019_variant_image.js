function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'product_variants', 'image_url')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN image_url TEXT`);
  }
}

module.exports = { up };
