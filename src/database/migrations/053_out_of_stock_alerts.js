function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some((row) => row.name === column);
}

function up(db) {
  if (!hasColumn(db, 'low_stock_alert_states', 'out_of_stock_alert_at')) {
    db.exec('ALTER TABLE low_stock_alert_states ADD COLUMN out_of_stock_alert_at DATETIME');
  }

  const body = "🔴 <b>Hết hàng</b>\n\n{{productEmoji}} <b>{{productName}}</b>{{variantLine}}\n🆔 ID: <code>{{productId}}</code>\n📦 Còn lại: <b>0</b>{{stockUrlBlock}}";
  const variables = JSON.stringify([
    'productEmoji',
    'productName',
    'productId',
    'variantLine',
    'variantName',
    'variantId',
    'targetType',
    'targetKey',
    'stockUrlBlock',
  ]);

  db.prepare(`
    INSERT INTO message_templates (
      key, channel, label, variables, body, default_body, is_enabled
    ) VALUES (
      'admin.out_of_stock', 'admin', 'Admin — sản phẩm hết hàng',
      ?, ?, ?, 1
    )
    ON CONFLICT(key) DO NOTHING
  `).run(variables, body, body);
}

module.exports = { up };
