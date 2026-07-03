const userService = require('../services/userService');
const messageTemplateService = require('../services/messageTemplateService');
const { escapeHtml } = require('../utils/messages');
const { openShopButton } = require('../utils/miniAppButton');
const {
    manageNotificationsButton,
    notificationStatusLine,
} = require('./notificationPreferences');

async function handleStart(ctx) {
    const user = userService.findOrCreate(ctx.from);

    const name = user.full_name || ctx.from?.first_name || ctx.from?.username || 'bạn';
    const username = user.username || ctx.from?.username || '';
    const db = require('../database');
    const supportRow = db.prepare(`SELECT value FROM settings WHERE key = 'support_contact'`).get();
    const supportContact = supportRow?.value || process.env.SUPPORT_CONTACT || '@admin';

    const welcomeText = messageTemplateService.renderIfEnabled('welcome', {
        name,
        username,
        supportContact,
    });
    const fallbackText = `Xin chào ${escapeHtml(name)}.\nMở cửa hàng bằng nút bên dưới.`;
    const text = `${welcomeText || fallbackText}\n\n${notificationStatusLine(user)}`;

    await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    openShopButton('Mở cửa hàng', {
                        botUsername: ctx.botInfo?.username,
                        payload: ctx.startPayload,
                        preferStartLink: true,
                    }),
                ],
                [manageNotificationsButton()],
            ],
        },
    });
}

module.exports = (bot) => {
    bot.start(handleStart);
};
module.exports.handleStart = handleStart;
