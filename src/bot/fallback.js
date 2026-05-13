const NUDGE_TEXT =
  'Mọi tính năng đã chuyển vào Mini App.\nBấm nút bên dưới để mở cửa hàng.';

async function handleFallback(ctx) {
  const username = ctx.botInfo?.username;
  const url = username ? `https://t.me/${username}?startapp` : process.env.MINIAPP_URL;
  await ctx.reply(NUDGE_TEXT, {
    reply_markup: {
      inline_keyboard: [[{ text: 'Mở cửa hàng', url }]],
    },
  });
}

module.exports = (bot) => {
  // Match any text/command that wasn't already handled by /start or /myid.
  bot.on('text', handleFallback);
  // Stale callback queries from old inline buttons — answer + nudge.
  bot.on('callback_query', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch {}
    await handleFallback(ctx);
  });
};

module.exports.handleFallback = handleFallback;
