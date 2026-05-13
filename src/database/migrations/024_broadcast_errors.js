function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function up(db) {
  if (!hasColumn(db, 'announcements', 'error_details')) {
    db.exec(`ALTER TABLE announcements ADD COLUMN error_details TEXT`);
  }
}

module.exports = { up };
