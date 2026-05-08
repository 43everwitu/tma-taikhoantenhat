const config = require('../config');
const db = require('../database');
const orderService = require('../services/orderService');
const userService = require('../services/userService');
const auditService = require('../services/auditService');
const messageTemplateService = require('../services/messageTemplateService');
const { formatPrice } = require('../utils/keyboard');

module.exports = (bot) => {
    bot.command('refund', async (ctx) => {
        if (ctx.from.id !== config.ADMIN_ID) {
            return ctx.reply('⛔ Bạn không có quyền sử dụng lệnh này.');
        }

        const text = ctx.message.text.trim();
        const match = text.match(/^\/refund(?:@\w+)?\s+(\d+)(?:\s+(.+))?$/);
        if (!match) {
            return ctx.reply(
                'Cách dùng: /refund <mã đơn> [lý do]\n' +
                'Ví dụ: /refund 100123 hết hàng'
            );
        }

        const orderId = parseInt(match[1]);
        const reason = (match[2] || '').trim() || 'Không nêu lý do';

        const order = orderService.getById(orderId);
        if (!order) return ctx.reply('❌ Không tìm thấy đơn hàng này.');
        if (order.status === 'refunded') return ctx.reply('⚠️ Đơn này đã được hoàn tiền trước đó.');
        if (order.status === 'cancelled') return ctx.reply('⚠️ Đơn đã hủy — không cần hoàn tiền.');

        const refundAmount = order.total_price;

        const tx = db.transaction(() => {
            userService.addBalance(order.user_id, refundAmount);
            db.prepare("UPDATE orders SET status = 'refunded', notes = ? WHERE id = ?")
                .run(`Refund: ${reason}`, orderId);
            db.prepare(`
                INSERT INTO notifications (user_id, type, title, body, channel, sent_telegram, sent_web)
                VALUES (?, 'refund', 'Hoàn tiền đơn hàng', ?, 'all', 0, 1)
            `).run(order.user_id,
                `↩️ Đơn #${orderId} đã được hoàn ${formatPrice(refundAmount)} vào ví. Lý do: ${reason}.`);
        });
        tx();

        // Sentinel admin id 0 marks Telegram-bot-side admin (vs web admin id).
        auditService.log(0, 'order.refund', 'order', orderId,
            { amount: refundAmount, reason, by_telegram: ctx.from.id }, null);

        // Notify customer in Telegram
        try {
            const refundedUser = userService.get(order.user_id);
            await bot.telegram.sendMessage(order.user_id,
                messageTemplateService.render('refund', {
                    orderCode: orderId,
                    amount: formatPrice(refundAmount).replace(/đ$/, ''),
                    reason,
                    newBalance: formatPrice(refundedUser ? refundedUser.balance : 0).replace(/đ$/, ''),
                }),
                { parse_mode: 'HTML' });
        } catch (err) {
            console.error('Refund notify customer failed:', err.message);
        }

        ctx.reply(`✅ Đã hoàn ${formatPrice(refundAmount)} cho user ${order.user_id} (đơn #${orderId}).`);
    });
};
