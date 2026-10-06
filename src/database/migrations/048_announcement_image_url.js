function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function up(db) {
  if (!hasColumn(db, 'announcements', 'image_url')) {
    db.exec('ALTER TABLE announcements ADD COLUMN image_url TEXT');
  }
}

module.exports = { up };
