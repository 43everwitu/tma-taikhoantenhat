const NUDGE_TEXT =
  'Mọi tính năng đã chuyển vào Mini App.\nBấm nút bên dưới để mở cửa hàng.';
const { openShopButton } = require('../utils/miniAppButton');

async function handleFallback(ctx) {
  await ctx.reply(NUDGE_TEXT, {
    reply_markup: {
      inline_keyboard: [[openShopButton('Mở cửa hàng', { botUsername: ctx.botInfo?.username })]],
    },
  });
}

module.exports = (bot) => {
  // Match any text/command that wasn't already handled by /start.
  bot.on('text', handleFallback);
  // Stale callback queries from old inline buttons — answer + nudge.
  bot.on('callback_query', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch {}
    await handleFallback(ctx);
  });
};

module.exports.handleFallback = handleFallback;
