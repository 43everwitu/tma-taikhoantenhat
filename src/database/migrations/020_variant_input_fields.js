function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function up(db) {
  if (!hasColumn(db, 'product_variants', 'input_fields_json')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN input_fields_json TEXT`);
  }
  const rows = db.prepare(`
    SELECT id, requires_input, input_label, input_placeholder, input_type
      FROM product_variants
     WHERE requires_input = 1 AND (input_fields_json IS NULL OR input_fields_json = '')
  `).all();
  const upd = db.prepare(`UPDATE product_variants SET input_fields_json = ? WHERE id = ?`);
  for (const r of rows) {
    const field = {
      label: r.input_label || 'Thông tin',
      placeholder: r.input_placeholder || '',
      type: r.input_type || 'text',
      required: true,
    };
    upd.run(JSON.stringify([field]), r.id);
  }
}

module.exports = { up };
