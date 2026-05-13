const userService = require('../services/userService');
const messageTemplateService = require('../services/messageTemplateService');

const ORDER_PAYLOAD = /^order_(\d{1,12})$/;

// Build a t.me deeplink that opens the bot's chat menu Mini App.
// Inline `web_app:` buttons require BotFather domain registration; t.me/<bot>?startapp
// works without setting any domain — Telegram launches the configured chat menu
// button URL with `tgWebAppStartParam=<payload>` as a query so the frontend can
// route deep links (e.g. order_<id> → /don-hang/<id>).
function buildStartLink(botUsername, payload) {
    if (!botUsername) return process.env.MINIAPP_URL;
    const m = ORDER_PAYLOAD.exec(payload || '');
    const param = m ? `order_${m[1]}` : '';
    return `https://t.me/${botUsername}?startapp${param ? `=${param}` : ''}`;
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

    const url = buildStartLink(ctx.botInfo?.username, ctx.startPayload);

    await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [[
                { text: 'Mở cửa hàng', url },
            ]],
        },
    });
}

module.exports = (bot) => {
    bot.start(handleStart);
};
module.exports.handleStart = handleStart;
