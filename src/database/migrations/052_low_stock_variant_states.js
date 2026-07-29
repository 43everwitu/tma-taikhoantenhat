function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS low_stock_alert_states (
      target_key TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      product_id INTEGER NOT NULL,
      variant_id INTEGER,
      last_alert_at DATETIME,
      snoozed_until DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (variant_id) REFERENCES product_variants(id)
    );
    CREATE INDEX IF NOT EXISTS idx_low_stock_alert_states_product
      ON low_stock_alert_states(product_id);
    CREATE INDEX IF NOT EXISTS idx_low_stock_alert_states_variant
      ON low_stock_alert_states(variant_id);
  `);

  const row = db.prepare("SELECT body FROM message_templates WHERE key = 'admin.low_stock'").get();
  if (row && !String(row.body || '').includes('{{variantLine}}')) {
    const body = "⚠️ <b>Tồn kho thấp</b>\n\n{{productEmoji}} <b>{{productName}}</b>{{variantLine}}\n🆔 ID: <code>{{productId}}</code>\n📦 Còn lại: <b>{{stockCount}}</b> / ngưỡng {{threshold}}{{stockUrlBlock}}";
    db.prepare(`
      UPDATE message_templates
      SET body = ?, default_body = ?, variables = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE key = 'admin.low_stock'
    `).run(
      body,
      body,
      JSON.stringify(['productEmoji', 'productName', 'productId', 'variantLine', 'variantName', 'variantId', 'targetType', 'targetKey', 'stockCount', 'threshold', 'stockUrlBlock'])
    );
  }
}

module.exports = { up };
