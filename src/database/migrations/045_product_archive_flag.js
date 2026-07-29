function hasColumn(db, table, column) {
  const cols = db.pragma(`table_info(${table})`);
  return cols.some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'products', 'is_archived')) {
    db.exec(`ALTER TABLE products ADD COLUMN is_archived INTEGER DEFAULT 0`);
  }
  db.exec(`
    UPDATE products
    SET is_archived = 1
    WHERE COALESCE(is_archived, 0) = 0
      AND is_active = 0
      AND (
        id IN (
          SELECT entity_id
          FROM audit_log
          WHERE action = 'product.delete'
            AND entity_type = 'product'
            AND details LIKE '%"archived":true%'
        )
        OR EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.product_id = products.id
        )
        OR EXISTS (
          SELECT 1
          FROM stock s
          WHERE s.product_id = products.id
            AND s.is_sold = 1
        )
      )
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_archive_active
    ON products(is_archived, is_active, sort_order)
  `);
}

module.exports = { up };
