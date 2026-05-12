const { normalizeTables } = require('../../src/utils/normalizeTables');

function migrateNormalizeTables(db) {
  const rows = db.prepare('SELECT id, description, long_description FROM products').all();
  const update = db.prepare('UPDATE products SET description = ?, long_description = ? WHERE id = ?');

  let rowsChanged = 0;
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const newDesc = normalizeTables(r.description || '');
      const newLong = normalizeTables(r.long_description || '');
      if (newDesc !== (r.description || '') || newLong !== (r.long_description || '')) {
        update.run(newDesc, newLong, r.id);
        rowsChanged++;
      }
    }
  });
  tx(rows);

  return { rowsScanned: rows.length, rowsChanged };
}

module.exports = { migrateNormalizeTables };
