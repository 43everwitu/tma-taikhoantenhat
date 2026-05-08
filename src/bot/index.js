const { Telegraf, session } = require('telegraf');
const config = require('../config');

function createBot() {
  if (!config.BOT_TOKEN || config.BOT_TOKEN === 'your_bot_token_here') {
    console.error('❌ BOT_TOKEN chưa được cấu hình! Hãy cập nhật file .env');
    process.exit(1);
  }

  const bot = new Telegraf(config.BOT_TOKEN);

  // Enable session for admin stock input
  bot.use(session());

  // Error handler
  bot.catch((err, ctx) => {
    console.error(`❌ Error for ${ctx.updateType}:`, err.message);
    try {
      ctx.reply('❌ Đã xảy ra lỗi. Vui lòng thử lại sau.');
    } catch (e) {
      // ignore
    }
  });

  // Register commands
  require('../commands/start')(bot);
  require('../commands/info')(bot);
  require('../commands/products')(bot);
  require('../commands/nap')(bot);
  require('../commands/balance')(bot);
  require('../commands/orders')(bot);
  require('../commands/website')(bot);
  require('../commands/support')(bot);
  require('../commands/myid')(bot);
  require('../commands/refund')(bot); // admin-only, gated inside

  // Register handlers
  require('../handlers/productSelect')(bot);
  require('../handlers/quantitySelect')(bot);
  require('../handlers/paymentConfirm')(bot);
  require('../handlers/adminActions')(bot);

  // Set bot commands for menu. /products + /refund are registered above as
  // handler-level aliases / admin-only commands but omitted from the menu UI.
  // Wrap in async IIFE + log so a 401/network failure surfaces instead of
  // silently leaving the old menu in place.
  const COMMANDS = [
    { command: 'start', description: '🔄 Bắt đầu / Khởi động lại' },
    { command: 'info', description: '👤 Thông tin tài khoản' },
    { command: 'menu', description: '📦 Danh sách sản phẩm' },
    { command: 'balance', description: '💼 Xem số dư ví' },
    { command: 'nap', description: '💰 Nạp số dư' },
    { command: 'orders', description: '📋 Đơn hàng (lọc · hủy · chi tiết)' },
    { command: 'website', description: '🌐 Website mua hàng' },
    { command: 'support', description: '🆘 Hỗ trợ' },
    { command: 'myid', description: '🆔 Lấy ID của bạn' },
  ];
  (async () => {
    try {
      // Replace the default-scope menu. Wipe-then-set guarantees Telegram
      // doesn't merge stale entries from a previous setMyCommands call.
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
