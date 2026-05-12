const variantService = {
  listByProduct(db, productId, { includeInactive = false } = {}) {
    const where = includeInactive ? '' : ' AND is_active = 1';
    return db.prepare(
      `SELECT id, product_id, name, description, price, sort_order, is_active,
              requires_input, input_label, input_placeholder, input_type, created_at, updated_at
         FROM product_variants
        WHERE product_id = ?${where}
        ORDER BY sort_order ASC, id ASC`
    ).all(productId);
  },

  getById(db, variantId) {
    return db.prepare(
      `SELECT id, product_id, name, description, price, sort_order, is_active,
              requires_input, input_label, input_placeholder, input_type
         FROM product_variants
        WHERE id = ?`
    ).get(variantId) || null;
  },

  create(db, { productId, name, description = null, price, sortOrder = 0,
               requiresInput = false, inputLabel = null, inputPlaceholder = null,
               inputType = 'text' }) {
    const r = db.prepare(
      `INSERT INTO product_variants
         (product_id, name, description, price, sort_order, requires_input, input_label, input_placeholder, input_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(productId, name, description, price, sortOrder,
          requiresInput ? 1 : 0, inputLabel, inputPlaceholder, inputType);
    return { id: r.lastInsertRowid };
  },

  update(db, productId, variantId, fields) {
    const map = {
      name: 'name', description: 'description', price: 'price',
      sortOrder: 'sort_order', isActive: 'is_active',
      requiresInput: 'requires_input', inputLabel: 'input_label',
      inputPlaceholder: 'input_placeholder',
      inputType: 'input_type',
    };
    const sets = [];
    const params = [];
    for (const [jsKey, sqlKey] of Object.entries(map)) {
      if (fields[jsKey] === undefined) continue;
      sets.push(`${sqlKey} = ?`);
      const v = fields[jsKey];
      params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
    if (sets.length === 0) return { changes: 0 };
    sets.push(`updated_at = CURRENT_TIMESTAMP`);
    params.push(productId, variantId);
    const r = db.prepare(
      `UPDATE product_variants SET ${sets.join(', ')} WHERE product_id = ? AND id = ?`
    ).run(...params);
    return { changes: r.changes };
  },

  softDelete(db, productId, variantId) {
    const r = db.prepare(
      `UPDATE product_variants SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND id = ?`
    ).run(productId, variantId);
    return { changes: r.changes };
  },

  reorder(db, productId, items) {
    const stmt = db.prepare(
      `UPDATE product_variants SET sort_order = ?, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = ? AND id = ?`
    );
    const tx = db.transaction((rows) => {
      for (const { id, sortOrder } of rows) stmt.run(sortOrder, productId, id);
    });
    tx(items);
  },

  countAvailableStock(db, productId, variantId) {
    return db.prepare(
      `SELECT COUNT(*) AS c FROM stock
        WHERE product_id = ? AND variant_id = ?
          AND is_sold = 0 AND reserved_for_order_id IS NULL`
    ).get(productId, variantId).c;
  },
};

module.exports = variantService;
