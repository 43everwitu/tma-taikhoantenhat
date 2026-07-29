function up(db) {
  db.exec(`
    UPDATE products
    SET created_at = COALESCE(
      (
        SELECT MIN(a.created_at)
        FROM audit_log a
        WHERE a.entity_type = 'product'
          AND a.entity_id = products.id
          AND a.action = 'product.create'
      ),
      (
        SELECT MIN(v.created_at)
        FROM product_variants v
        WHERE v.product_id = products.id
      ),
      (
        SELECT MIN(s.added_at)
        FROM stock s
        WHERE s.product_id = products.id
      ),
      (
        SELECT MIN(o.created_at)
        FROM orders o
        WHERE o.product_id = products.id
      ),
      updated_at,
      CURRENT_TIMESTAMP
    )
    WHERE created_at IS NULL OR TRIM(created_at) = '';

    CREATE TRIGGER IF NOT EXISTS products_fill_created_at_after_insert
    AFTER INSERT ON products
    FOR EACH ROW
    WHEN NEW.created_at IS NULL OR TRIM(NEW.created_at) = ''
    BEGIN
      UPDATE products
      SET created_at = CURRENT_TIMESTAMP
      WHERE id = NEW.id;
    END;
  `);
}

module.exports = { up };
