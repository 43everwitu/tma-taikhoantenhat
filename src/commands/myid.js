const messageTemplateService = require('../services/messageTemplateService');

module.exports = (bot) => {
    bot.command('myid', (ctx) => {
        ctx.replyWithHTML(
            messageTemplateService.render('cmd_myid', { id: ctx.from.id })
        );
    });
};
