const { Telegraf, session } = require('telegraf');
const config = require('../config');

function createBot() {
  if (!config.BOT_TOKEN || config.BOT_TOKEN === 'your_bot_token_here') {
    console.error('❌ BOT_TOKEN chưa được cấu hình! Hãy cập nhật file .env');
    process.exit(1);
  }

  const bot = new Telegraf(config.BOT_TOKEN);
  bot.use(session());

  bot.catch((err, ctx) => {
    console.error(`❌ Error for ${ctx.updateType}:`, err.message);
    try { ctx.reply('❌ Đã xảy ra lỗi. Vui lòng thử lại sau.'); } catch {}
  });

  // Two real commands: entry point + identity utility.
  require('../commands/start')(bot);
  require('../commands/myid')(bot);

  // Fallback: any other input nudges the user back to the Mini App.
  require('./fallback')(bot);

  // Replace the menu — only /start and /myid show in the slash UI.
  const COMMANDS = [
    { command: 'start', description: 'Mở cửa hàng' },
    { command: 'myid',  description: 'Lấy ID của bạn' },
  ];
  (async () => {
    try {
      await bot.telegram.deleteMyCommands();
      await bot.telegram.setMyCommands(COMMANDS);
      console.log(`📋 Telegram bot menu updated (${COMMANDS.length} commands)`);
    } catch (err) {
      console.error('⚠️ setMyCommands failed:', err.message);
    }
  })();

  return bot;
}

module.exports = { createBot };
