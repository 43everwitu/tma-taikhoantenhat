const userService = require('../services/userService');
const messageTemplateService = require('../services/messageTemplateService');
const { formatPrice } = require('../utils/keyboard');

module.exports = (bot) => {
    bot.command('balance', (ctx) => {
        const user = userService.findOrCreate(ctx.from);
        ctx.replyWithHTML(
            messageTemplateService.render('cmd_balance', {
                balance: formatPrice(user.balance).replace(/đ$/, ''),
            })
        );
    });
};
