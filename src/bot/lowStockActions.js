const db = require('../database');

module.exports = (bot) => {
  bot.action(/^lowstock_done:(?:(p|v):)?(\d+)$/, async (ctx) => {
    const targetType = ctx.match?.[1] === 'v' ? 'variant' : 'product';
    const targetId = Number(ctx.match?.[2] ?? ctx.match?.[1]);

    if (targetType === 'variant' && Number.isInteger(targetId) && targetId > 0) {
      const variant = db.prepare(`
        SELECT id, product_id
        FROM product_variants
        WHERE id = ?
      `).get(targetId);
      if (variant) {
        db.prepare(`
          INSERT INTO low_stock_alert_states (
            target_key, target_type, product_id, variant_id, snoozed_until, updated_at
          )
          VALUES (?, 'variant', ?, ?, datetime('now', '+24 hours'), CURRENT_TIMESTAMP)
          ON CONFLICT(target_key) DO UPDATE SET
            snoozed_until = datetime('now', '+24 hours'),
            updated_at = CURRENT_TIMESTAMP
        `).run(`v:${variant.id}`, variant.product_id, variant.id);
      }
    } else if (Number.isInteger(targetId) && targetId > 0) {
      db.prepare(`
        UPDATE products
        SET low_stock_snoozed_until = datetime('now', '+24 hours')
        WHERE id = ?
      `).run(targetId);
      db.prepare(`
        INSERT INTO low_stock_alert_states (
          target_key, target_type, product_id, variant_id, snoozed_until, updated_at
        )
        VALUES (?, 'product', ?, NULL, datetime('now', '+24 hours'), CURRENT_TIMESTAMP)
        ON CONFLICT(target_key) DO UPDATE SET
          snoozed_until = datetime('now', '+24 hours'),
          updated_at = CURRENT_TIMESTAMP
      `).run(`p:${targetId}`, targetId);
    }

    try {
      await ctx.deleteMessage();
    } catch (err) {
      console.error('lowStockActions deleteMessage failed:', err.message || err);
    }

    try {
      await ctx.answerCbQuery('Đã ẩn cảnh báo tồn kho 24h');
    } catch {}
  });

  bot.action(/^outstock_done:(p|v):(\d+)$/, async (ctx) => {
    try {
      await ctx.deleteMessage();
    } catch (err) {
      console.error('lowStockActions outstock deleteMessage failed:', err.message || err);
    }

    try {
      await ctx.answerCbQuery('Đã xóa cảnh báo. Hệ thống sẽ tự nhận biết khi có stock mới.');
    } catch {}
  });
};
