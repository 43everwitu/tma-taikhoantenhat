const config = require('../config');
const { signPayload } = require('../services/twofaIntegrationAuth');

const NUDGE_TEXT =
  'Mọi tính năng đã chuyển vào Mini App.\nBấm nút bên dưới để mở cửa hàng.';
const { openShopButton } = require('../utils/miniAppButton');

async function nudgeToMiniApp(ctx) {
  await ctx.reply(NUDGE_TEXT, {
    reply_markup: {
      inline_keyboard: [[openShopButton('Mở cửa hàng', { botUsername: ctx.botInfo?.username })]],
    },
  });
}

async function forwardToRagBot(ctx) {
  // This handler (bot.on('text', ...)) only ever fires for genuine inbound
  // customer messages — Telegraf does not deliver the bot's own outgoing
  // sendMessage calls back through this listener — so is_staff_reply is
  // always false here. Staff-reply/echo detection for RAG-chat-bot's Gate
  // is a separate mechanism, not implemented by this forwarder.
  const rawBody = Buffer.from(JSON.stringify({
    update_id: ctx.update.update_id,
    message: { ...ctx.update.message, is_staff_reply: false },
  }));
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const res = await fetch(config.RAG_BOT_INBOUND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tktn-timestamp': timestamp,
        'x-tktn-signature': signPayload(config.RAG_INTEGRATION_SECRET, timestamp, rawBody),
      },
      body: rawBody,
      signal: AbortSignal.timeout(config.RAG_BOT_FORWARD_TIMEOUT_SECONDS * 1000),
    });
    if (!res.ok) throw new Error(`RAG bot responded ${res.status}`);
  } catch (err) {
    console.error('[rag-forward] failed, falling back to Mini App nudge:', err.message);
    await nudgeToMiniApp(ctx);
  }
}

async function handleFallback(ctx) {
  if (config.RAG_BOT_FORWARD_ENABLED) {
    return forwardToRagBot(ctx);
  }
  return nudgeToMiniApp(ctx);
}

module.exports = (bot) => {
  bot.on('text', handleFallback);
  bot.on('callback_query', async (ctx) => {
    try { await ctx.answerCbQuery(); } catch {}
    await handleFallback(ctx);
  });
};

module.exports.handleFallback = handleFallback;
