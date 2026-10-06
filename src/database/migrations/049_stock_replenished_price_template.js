function up(db) {
  const updates = [
    [
      'bot.stock_replenished',
      ['productEmoji', 'productName', 'productPrice', 'stockCount'],
      '🔔 <b>{{productName}} đã có hàng!</b>\nGiá: <b>{{productPrice}}</b>\nSố lượng trong kho: <b>{{stockCount}}</b>',
    ],
    [
      'web.stock_replenished',
      ['productEmoji', 'productName', 'productPrice', 'stockCount'],
      '{{productEmoji}} {{productName}} đã có hàng trở lại. Giá: {{productPrice}}. Còn {{stockCount}} sản phẩm.',
    ],
  ];

  const stmt = db.prepare(`
    UPDATE message_templates
    SET variables = ?, body = ?, default_body = ?, updated_at = CURRENT_TIMESTAMP
    WHERE key = ?
  `);
  for (const [key, variables, body] of updates) {
    stmt.run(JSON.stringify(variables), body, body, key);
  }
}

module.exports = { up };
