const userService = require('../services/userService');
const messageTemplateService = require('../services/messageTemplateService');

const ORDER_PAYLOAD = /^order_(\d{1,12})$/;

function resolveDeepLink(payload) {
    const base = (process.env.MINIAPP_URL || '').replace(/\/$/, '');
    const m = ORDER_PAYLOAD.exec(payload || '');
    if (m) return `${base}/don-hang/${m[1]}`;
    return process.env.MINIAPP_URL;
}

async function handleStart(ctx) {
    const user = userService.findOrCreate(ctx.from);

    const name = user.full_name || ctx.from?.first_name || ctx.from?.username || 'bạn';
    const username = user.username || ctx.from?.username || '';
    const balance = user.balance ?? 0;

    const text = messageTemplateService.render('welcome', {
        name,
        username,
        balance: String(balance),
    });

    const url = resolveDeepLink(ctx.startPayload);

    await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[
                { text: 'Mở cửa hàng', web_app: { url } },
            ]],
        },
    });
}

module.exports = (bot) => {
    bot.start(handleStart);
};
module.exports.handleStart = handleStart;
