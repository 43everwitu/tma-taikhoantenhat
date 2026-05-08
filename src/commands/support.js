const config = require('../config');
const messageTemplateService = require('../services/messageTemplateService');

module.exports = (bot) => {
    function send(ctx) {
        ctx.replyWithHTML(
            messageTemplateService.render('cmd_support', {
                contact: config.SUPPORT_CONTACT,
            })
        );
    }
    bot.command('support', send);
    bot.hears('🆘 Hỗ trợ', send);
};
