const messages = require('../utils/messages');

module.exports = (bot) => {
  bot.command('hotro', (ctx) => ctx.reply(messages.supportContact));
};
