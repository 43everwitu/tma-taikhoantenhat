// Posts a structured order notification card to a Telegram group/topic.
// Env:
//   ORDER_CHANNEL_CHAT_ID   - chat id (negative for supergroups, e.g. -1003865156744)
//   ORDER_CHANNEL_THREAD_ID - optional message_thread_id for forum topics (e.g. 2)
// No-op if ORDER_CHANNEL_CHAT_ID is unset.

let bot = null;

function init(b) { bot = b; }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function spoiler(s) {
  return `<tg-spoiler>${escapeHtml(s)}</tg-spoiler>`;
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
  const divider = '─────────────';
  const lines = [];
  lines.push(`📥 <b>Order #${order.id} Notification</b>`);
  lines.push(divider);
  lines.push(`💰 <b>Thanh toán</b>: ${order.total_price.toLocaleString('vi-VN')}đ`);
  lines.push(`🧾 <b>Mã đơn</b>: <code>${escapeHtml(order.payment_code || String(order.id))}</code>`);
  if (customerInfo) {
    // Customer-supplied input is potentially sensitive (emails, etc.) — wrap
    // in spoiler so it's tap-to-reveal.
    lines.push(`📧 <b>Thông tin KH</b>: ${spoiler(customerInfo)}`);
  }
  lines.push(`📦 <b>Sản phẩm</b>: ${escapeHtml(product.name)}${variant ? ` — ${escapeHtml(variant.name)}` : ''} ×${order.quantity}`);
  lines.push(divider);
  if (keys && keys.length > 0) {
    lines.push(`🔑 <b>License Keys (${keys.length})</b> — tap để xem:`);
    for (const k of keys) lines.push(spoiler(k));
  } else {
    lines.push('⚠️ <i>Đơn cần xử lý thủ công — chưa có key.</i>');
  }
  return lines.join('\n');
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
