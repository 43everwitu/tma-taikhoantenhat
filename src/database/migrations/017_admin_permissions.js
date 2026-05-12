function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'admins', 'permissions')) {
    db.exec(`ALTER TABLE admins ADD COLUMN permissions TEXT`);
  }
}

module.exports = { up };
