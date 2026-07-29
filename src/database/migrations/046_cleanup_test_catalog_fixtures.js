function up(db) {
  db.exec(`
    CREATE TEMP TABLE IF NOT EXISTS tmp_test_catalog_product_ids (id INTEGER PRIMARY KEY);

    INSERT OR IGNORE INTO tmp_test_catalog_product_ids (id)
    SELECT DISTINCT p.id
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.product_id = p.id)
      AND (
        p.slug LIKE 'archive-view-product-%'
        OR p.slug LIKE 'variant-summary-product-%'
        OR p.slug LIKE 'variant-names-product-%'
        OR p.slug LIKE 'public-product-%'
        OR p.slug LIKE 'variant-cache-product-%'
        OR p.name LIKE 'ARCHIVE_VIEW_PRODUCT_%'
        OR p.name LIKE 'Variant summary %'
        OR p.name LIKE 'Variant names %'
        OR p.name LIKE 'PUBLIC_PRODUCT_%'
        OR c.slug LIKE 'archive-view-cat-%'
        OR c.slug LIKE 'variant-summary-%'
        OR c.slug LIKE 'variant-names-%'
        OR c.slug LIKE 'public-empty-%'
        OR c.slug LIKE 'public-archived-%'
        OR c.name LIKE 'ARCHIVE_VIEW_CAT_%'
        OR c.name LIKE 'variant-summary-%'
        OR c.name LIKE 'variant-names-%'
        OR c.name LIKE 'PUBLIC_CAT_%'
      );

    DELETE FROM product_follows WHERE product_id IN (SELECT id FROM tmp_test_catalog_product_ids);
    DELETE FROM stock WHERE product_id IN (SELECT id FROM tmp_test_catalog_product_ids);
    DELETE FROM product_variants WHERE product_id IN (SELECT id FROM tmp_test_catalog_product_ids);
    DELETE FROM audit_log
    WHERE entity_type = 'product'
      AND entity_id IN (SELECT id FROM tmp_test_catalog_product_ids);
    DELETE FROM products WHERE id IN (SELECT id FROM tmp_test_catalog_product_ids);

    DELETE FROM categories
    WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.category_id = categories.id)
      AND (
        slug LIKE 'archive-view-cat-%'
        OR slug LIKE 'variant-summary-%'
        OR slug LIKE 'variant-names-%'
        OR slug LIKE 'public-empty-%'
        OR slug LIKE 'public-archived-%'
        OR name LIKE 'ARCHIVE_VIEW_CAT_%'
        OR name LIKE 'variant-summary-%'
        OR name LIKE 'variant-names-%'
        OR name LIKE 'PUBLIC_CAT_%'
      );

    DROP TABLE tmp_test_catalog_product_ids;
  `);
}

module.exports = { up };
