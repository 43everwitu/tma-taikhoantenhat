// Posts a structured order notification card to a Telegram group/topic.
// Settings:
//   order_channel_chat_id   - chat id âm của group/channel Telegram.
//   order_channel_thread_id - message_thread_id nếu group bật forum topic.
// Fallback env cũ: ORDER_CHANNEL_CHAT_ID / ORDER_CHANNEL_THREAD_ID.
//
// Backorder / no-stock cards store message_id on the order row. When keys are
// later supplied (manual or auto deliver), the existing card is edited in place.

const messageTemplateService = require('./messageTemplateService');
const { formatCustomerInputForChannel } = require('../utils/messages');
const telegramApiClient = require('./telegramApiClient');

let bot = null;

function init(b) { bot = b; }

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildCard({ order, product, variant, keys, customerInfo }) {
  const totalSpoiler = `<b>${escapeHtml(order.total_price.toLocaleString('vi-VN') + 'đ')}</b>`;
  const paymentCode = order.payment_code || String(order.id);

  const customerLine = customerInfo
    ? `\n📋 <b>Thông tin KH</b>:\n<tg-spoiler>${customerInfo}</tg-spoiler>`
    : '';

  const productLine = `${escapeHtml(product.name)}${variant ? ` — ${escapeHtml(variant.name)}` : ''}`;

  let keysBlock;
  if (keys && keys.length > 0) {
    const spoilered = keys.map((k) => `<tg-spoiler>${escapeHtml(k)}</tg-spoiler>`).join('\n');
    keysBlock = `🔑 <b>License Keys (${keys.length})</b> — tap để xem:\n${spoilered}`;
  } else {
    keysBlock = '⚠️ <i>Đơn đặt trước cần xử lý thủ công — chưa có key.</i>';
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

function getStoredChannelMessage(orderId) {
  const db = require('../database');
  const row = db.prepare(
    'SELECT order_channel_chat_id, order_channel_message_id FROM orders WHERE id = ?'
  ).get(orderId);
  if (!row?.order_channel_chat_id || !row?.order_channel_message_id) return null;
  return {
    chatId: row.order_channel_chat_id,
    messageId: row.order_channel_message_id,
  };
}

function saveChannelMessage(orderId, chatId, messageId) {
  const db = require('../database');
  db.prepare(`
    UPDATE orders
       SET order_channel_chat_id = ?, order_channel_message_id = ?
     WHERE id = ?
  `).run(String(chatId), messageId, orderId);
}

function clearChannelMessage(orderId) {
  const db = require('../database');
  db.prepare(`
    UPDATE orders
       SET order_channel_chat_id = NULL, order_channel_message_id = NULL
     WHERE id = ?
  `).run(orderId);
}

function settingValue(key) {
  const db = require('../database');
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value ? String(row.value).trim() : '';
}

function parseThreadId(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function resolveOrderChannelTarget() {
  const chatId = settingValue('order_channel_chat_id') || process.env.ORDER_CHANNEL_CHAT_ID || '';
  const threadRaw = settingValue('order_channel_thread_id') || process.env.ORDER_CHANNEL_THREAD_ID || '';
  return {
    chatId: String(chatId).trim(),
    threadId: parseThreadId(threadRaw),
  };
}

function setTelegramRequestForTest(fn) {
  telegramApiClient.setTelegramRequestForTest(fn);
}

async function postOrderCard({ order, product, variant, keys }) {
  if (!bot && !process.env.BOT_TOKEN) return;
  const { chatId, threadId } = resolveOrderChannelTarget();
  if (!chatId) return;

  const customerInfo = formatCustomerInputForChannel(order.input_value);
  const text = buildCard({ order, product, variant, keys, customerInfo });
  const sendOpts = {
    parse_mode: 'HTML',
    message_thread_id: threadId,
    disable_web_page_preview: true,
  };
  const editOpts = {
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  const stored = getStoredChannelMessage(order.id);
  const isFulfillment = keys && keys.length > 0;

  if (stored && isFulfillment) {
    try {
      await telegramApiClient.editMessageText(stored.chatId, stored.messageId, text, editOpts);
      return;
    } catch (err) {
      console.warn(`orderChannelService edit failed for order ${order.id}, sending new:`, err.message || err);
      clearChannelMessage(order.id);
    }
  }

  try {
    const msg = await telegramApiClient.sendMessage(chatId, text, sendOpts);
    saveChannelMessage(order.id, chatId, msg.message_id);
  } catch (err) {
    console.error('orderChannelService failed:', err.message || err);
  }
}

module.exports = {
  init,
  postOrderCard,
  buildCard,
  resolveOrderChannelTarget,
  setTelegramRequestForTest,
};
