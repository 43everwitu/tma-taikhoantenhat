const userService = require('../services/userService');
const messageTemplateService = require('../services/messageTemplateService');

module.exports = (bot) => {
    bot.start(async (ctx) => {
        // Preserve user-row creation on first contact — needed downstream
        // for balance, orders, and any future profile lookups.
        const user = userService.findOrCreate(ctx.from);

        const name = user.full_name || ctx.from?.first_name || ctx.from?.username || 'bạn';
        const username = user.username || ctx.from?.username || '';
        const balance = user.balance ?? 0;

        const text = messageTemplateService.render('welcome', {
            name,
            username,
            balance: String(balance),
        });

        await ctx.reply(text, {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [[
                    { text: 'Mở cửa hàng', web_app: { url: process.env.MINIAPP_URL } },
                ]],
            },
        });
    });
};
