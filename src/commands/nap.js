const paymentService = require('../services/paymentService');
const userService = require('../services/userService');
const topupService = require('../services/topupService');
const { formatPrice } = require('../utils/keyboard');

module.exports = (bot) => {
    bot.command('nap', async (ctx) => {
        const minAmount = topupService.getMinAmount();
        const text = ctx.message.text.split(' ');

        if (text.length < 2 || isNaN(text[1])) {
            return ctx.replyWithHTML(
                '💰 <b>NẠP SỐ DƯ</b>\n\n' +
                'Cách dùng: <code>/nap &lt;số tiền&gt;</code>\n' +
                'Ví dụ: <code>/nap 50000</code>\n\n' +
                `💡 Số tiền tối thiểu: <b>${formatPrice(minAmount)}</b>`
            );
        }

        const amount = parseInt(text[1]);
        if (amount < minAmount) {
            return ctx.reply(`❌ Số tiền tối thiểu là ${formatPrice(minAmount)}`);
        }

        // Ensure user row + capture latest username from this update
        userService.findOrCreate(ctx.from);

        const topup = topupService.create({
            telegram_id: ctx.from.id,
            username: ctx.from.username,
            amount,
        });

        const qrMedia = await paymentService.getQRMedia(amount, topup.memo);
        const noUsernameHint = !ctx.from.username
            ? `\n\n💡 <i>Bạn chưa đặt @username trên Telegram nên đang dùng mã ID. Đặt @username trong cài đặt Telegram để mã ngắn gọn hơn lần sau.</i>`
            : '';

        const qrMsg = await ctx.replyWithPhoto(qrMedia, {
            caption:
                `💰 <b>NẠP SỐ DƯ — ${formatPrice(amount)}</b>\n\n` +
                `Quét mã QR phía trên để chuyển khoản.\n\n` +
                `🏦 Số tiền: <b>${formatPrice(amount)}</b>\n` +
                `📝 Nội dung CK: <code>${topup.memo}</code>\n\n` +
                `⏰ QR hiệu lực trong <b>30 phút</b>\n` +
                `🚫 <b>KHÔNG</b> thay đổi nội dung chuyển khoản — số dư sẽ được cộng tự động.` +
                noUsernameHint,
            parse_mode: 'HTML',
        });

        topupService.setQrMessage(topup.id, qrMsg.chat.id, qrMsg.message_id);

        if (bot._paymentPoller) bot._paymentPoller.ensureRunning();
    });

    // Reply-keyboard button — show usage help (no amount provided).
    bot.hears('💰 Nạp tiền', (ctx) => {
        const minAmount = topupService.getMinAmount();
        return ctx.replyWithHTML(
            '💰 <b>NẠP SỐ DƯ</b>\n\n' +
            'Cách dùng: <code>/nap &lt;số tiền&gt;</code>\n' +
            'Ví dụ: <code>/nap 50000</code>\n\n' +
            `💡 Số tiền tối thiểu: <b>${formatPrice(minAmount)}</b>`
        );
    });
};
