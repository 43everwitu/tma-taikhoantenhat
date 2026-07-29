const { Telegraf, session } = require('telegraf');
const config = require('../config');

function createBot() {
  if (!config.BOT_TOKEN || config.BOT_TOKEN === 'your_bot_token_here') {
    console.error('❌ BOT_TOKEN chưa được cấu hình! Hãy cập nhật file .env');
    process.exit(1);
  }

  const bot = new Telegraf(config.BOT_TOKEN);
  bot.use(session());
  bot.use(async (ctx, next) => {
    const telegramId = ctx.from?.id;
    if (telegramId) {
      const userModerationService = require('../services/userModerationService');
      if (userModerationService.isBanned(telegramId)) {
        await ctx.reply('Tài khoản của bạn đã bị hạn chế. Vui lòng liên hệ hỗ trợ.');
        return;
      }
    }
    return next();
  });

  bot.catch((err, ctx) => {
    console.error(`❌ Error for ${ctx.updateType}:`, err.message);
    try { ctx.reply('❌ Đã xảy ra lỗi. Vui lòng thử lại sau.'); } catch {}
  });

  // Single real command: the Mini App entry point.
  require('../commands/start')(bot);
  require('../commands/notificationPreferences')(bot);

  require('./lowStockActions')(bot);

  // Fallback: any other input nudges the user back to the Mini App.
  require('./fallback')(bot);

  // Replace the menu — the Mini App entry point and notification toggle show in the slash UI.
  const COMMANDS = [
    { command: 'start', description: 'Mở cửa hàng' },
    { command: 'thongbao', description: 'Bật/tắt thông báo' },
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
