// Posts a structured order notification card to a Telegram group/topic.
// Env:
//   ORDER_CHANNEL_CHAT_ID   - chat id (negative for supergroups, e.g. -1003865156744)
//   ORDER_CHANNEL_THREAD_ID - optional message_thread_id for forum topics (e.g. 2)
// No-op if ORDER_CHANNEL_CHAT_ID is unset.

const messageTemplateService = require('./messageTemplateService');

let bot = null;

function init(b) { bot = b; }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function decryptInput(encrypted) {
  if (!encrypted) return null;
  try {
    const { decryptString } = require('../utils/secrets');
    return decryptString(encrypted);
  } catch {
    return null;
  }
}

function buildCard({ order, product, variant, keys, customerInfo }) {
  const totalSpoiler = `<tg-spoiler>${escapeHtml(order.total_price.toLocaleString('vi-VN') + 'đ')}</tg-spoiler>`;
  const paymentCode = order.payment_code || String(order.id);

  // Customer-supplied input is potentially sensitive (emails, etc.) — wrap
  // in spoiler so it's tap-to-reveal. Empty line when no input.
  const customerLine = customerInfo
    ? `\n📧 <b>Thông tin KH</b>: <tg-spoiler>${escapeHtml(customerInfo)}</tg-spoiler>`
    : '';

  // productLine includes optional variant suffix; trusted-as-HTML because the
  // template var is marked trusted (productLine is in TRUSTED_VARS).
  const productLine = `${escapeHtml(product.name)}${variant ? ` — ${escapeHtml(variant.name)}` : ''}`;

  let keysBlock;
  if (keys && keys.length > 0) {
    const spoilered = keys.map((k) => `<tg-spoiler>${escapeHtml(k)}</tg-spoiler>`).join('\n');
    keysBlock = `🔑 <b>License Keys (${keys.length})</b> — tap để xem:\n${spoilered}`;
  } else {
    keysBlock = '⚠️ <i>Đơn cần xử lý thủ công — chưa có key.</i>';
  }

  return messageTemplateService.render('group.order_card', {
    orderCode: order.id,
    paymentCode,
    productLine,
    quantity: order.quantity,
    totalSpoiler,
    customerLine,
    keysBlock,
  });
}

async function postOrderCard({ order, product, variant, keys }) {
  if (!bot) return;
  const chatId = process.env.ORDER_CHANNEL_CHAT_ID;
  if (!chatId) return;
  const threadId = process.env.ORDER_CHANNEL_THREAD_ID
    ? parseInt(process.env.ORDER_CHANNEL_THREAD_ID, 10)
    : undefined;

  const customerInfo = decryptInput(order.input_value);
  const text = buildCard({ order, product, variant, keys, customerInfo });

  try {
    await bot.telegram.sendMessage(chatId, text, {
      parse_mode: 'HTML',
      message_thread_id: threadId,
      disable_web_page_preview: true,
    });
  } catch (err) {
    console.error(`orderChannelService failed:`, err.message || err);
  }
}

module.exports = { init, postOrderCard };
