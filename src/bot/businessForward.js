const config = require('../config');
const { signPayload } = require('../services/twofaIntegrationAuth');

// Customers routinely split one thought across several rapid messages.
// Forwarding each fragment as its own RAG turn burns through checkScope's
// spam threshold and gets each fragment answered out of context. Buffer per
// (business_connection_id, chat) and forward once as a single combined turn
// after a short quiet period instead.
const pendingByKey = new Map();

async function forwardCombined(key) {
  const entry = pendingByKey.get(key);
  if (!entry) return;
  pendingByKey.delete(key);

  const { ctx, texts, latestBusinessMessage, latestUpdateId } = entry;
  const rawBody = Buffer.from(JSON.stringify({
    update_id: latestUpdateId,
    message: { ...latestBusinessMessage, text: texts.join('\n'), is_staff_reply: false },
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

    const body = await res.json().catch(() => null);
    if (body?.skipped) return; // RAG deliberately stayed silent (gated/handoff/no_text)

    const businessConnectionId = latestBusinessMessage.business_connection_id;
    const chatId = latestBusinessMessage.chat.id;

    if (body?.qrUrl) {
      await ctx.telegram.sendPhoto(chatId, body.qrUrl, {
        caption: body.reply || undefined,
        business_connection_id: businessConnectionId,
      });
    } else if (body?.reply) {
      await ctx.telegram.sendMessage(chatId, body.reply, {
        business_connection_id: businessConnectionId,
      });
    }
  } catch (err) {
    console.error('[rag-business-forward] failed:', err.message);
  }
}

// Telegram Business messages (customer -> the connected personal account)
// arrive as a distinct update type from regular bot messages — see
// docs/superpowers/specs (Telegram Business option) for why this is a
// separate forwarder from fallback.js rather than reusing it.
async function handleBusinessMessage(ctx) {
  if (!config.RAG_BUSINESS_FORWARD_ENABLED) return;

  const businessMessage = ctx.update.business_message;
  if (!businessMessage) return;
  // Non-text business messages (photos, stickers, ...) aren't something
  // this buffer can meaningfully coalesce with text fragments — leave them
  // alone (RAG-side image support is separate, unsolved work).
  if (typeof businessMessage.text !== 'string') return;

  const key = `${businessMessage.business_connection_id}:${businessMessage.chat.id}`;
  const existing = pendingByKey.get(key);
  if (existing) clearTimeout(existing.timer);

  const entry = {
    ctx,
    texts: existing ? [...existing.texts, businessMessage.text] : [businessMessage.text],
    latestBusinessMessage: businessMessage,
    latestUpdateId: ctx.update.update_id,
  };
  entry.timer = setTimeout(() => forwardCombined(key), config.RAG_BUSINESS_DEBOUNCE_MS);
  pendingByKey.set(key, entry);
}

module.exports = (bot) => {
  bot.on('business_message', handleBusinessMessage);
};

module.exports.handleBusinessMessage = handleBusinessMessage;
