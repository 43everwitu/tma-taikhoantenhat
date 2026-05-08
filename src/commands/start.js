const userService = require('../services/userService');
const messages = require('../utils/messages');
const { mainMenuKeyboard } = require('../utils/keyboard');

module.exports = (bot) => {
    bot.start((ctx) => {
        const user = userService.findOrCreate(ctx.from);
        const text = messages.welcome({
            name: user.full_name,
            username: user.username,
            balance: user.balance,
        });
        ctx.replyWithHTML(text, mainMenuKeyboard());
    });
};
