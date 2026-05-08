const userService = require('../services/userService');
const messageTemplateService = require('../services/messageTemplateService');
const { formatPrice } = require('../utils/keyboard');

module.exports = (bot) => {
    bot.command('info', (ctx) => {
        const user = userService.findOrCreate(ctx.from);
        ctx.replyWithHTML(
            messageTemplateService.render('cmd_account_info', {
                id: user.telegram_id,
                name: user.full_name || 'onii-chan',
                balance: formatPrice(user.balance).replace(/đ$/, ''),
                joinedAt: user.created_at,
            })
        );
    });
};
