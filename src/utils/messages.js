const { formatPrice } = require('./keyboard');
const { toTelegramHtml } = require('./richHtml');
const messageTemplateService = require('../services/messageTemplateService');

const messages = {
    welcome: ({ name, username, balance }) =>
        messageTemplateService.render('welcome', {
            name: name || 'bạn',
            username: username || '',
            balance: new Intl.NumberFormat('vi-VN').format(balance || 0),
        }),

    productHeader:
        '👇 👇 👇  Chọn sản phẩm bạn muốn mua bên dưới:',

    selectQuantity: (product) => {
        const stock = product.display_stock || product.stock_count;
        const desc = (product.long_description && product.long_description.trim())
            || (product.description && product.description.trim())
            || '';
        return (
            `📦 <b>${escapeHtml(product.name)}</b>\n` +
            (desc ? `\n${richifyText(desc)}\n\n` : '\n') +
            (product.promotion ? `🎁 <b>${richifyText(product.promotion)}</b>\n\n` : '') +
            `💰 Giá: ${formatPrice(product.price)}/cái\n` +
            `📊 Còn lại: ${stock} sản phẩm\n\n` +
            `Chọn số lượng muốn mua:`
        );
    },

    contactOnly: (product) =>
        `📦 <b>${escapeHtml(product.name)}</b>\n\n` +
        `💰 Giá: ${formatPrice(product.price)}\n` +
        (product.promotion ? `🎁 ${richifyText(product.promotion)}\n` : '') +
        `\n💬 Sản phẩm này cần liên hệ trực tiếp để mua.\n` +
        `Bấm nút bên dưới để xem thông tin liên hệ.`,

    noStock:
        '❌ Rất tiếc, sản phẩm đã hết hàng. Vui lòng thử lại sau.',
};

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Render an admin-authored field for Telegram. Inputs may already contain
 * Telegram-safe HTML (b/i/u/s/a/tg-spoiler/code/pre/br) — those tags survive.
 * Plain text and bare URLs get auto-linked. Disallowed tags are stripped.
 */
function richifyText(s) {
  if (!s) return '';
  return toTelegramHtml(s);
}

/**
 * Format delivered keys as plain escaped text. Telegram HTML mode auto-linkifies
 * bare URLs (m.me/..., zalo.me/...) when they are NOT inside <code>/<pre>/<a>.
 */
function formatKeysForTelegram(accounts) {
  return accounts.map((k) => escapeHtml(k)).join('\n');
}

/**
 * Build admin-facing HTML block from encrypted order.input_value (JSON field map).
 * Returns empty string when there is no customer input.
 */
function buildCustomerInputBlock(inputValueEncrypted) {
  if (!inputValueEncrypted) return '';
  try {
    const { decryptString } = require('./secrets');
    const raw = decryptString(inputValueEncrypted);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Object.keys(parsed).length === 0) return '';
    const lines = [];
    for (const [label, value] of Object.entries(parsed)) {
      if (!value) continue;
      const labelless = !label || /^__field_\d+$/.test(label);
      const isSecret = /password|pass|mật khẩu|m[aậ]t kh[aẩ]u/i.test(label);
      const shown = isSecret ? '••••••' : escapeHtml(String(value));
      lines.push(labelless ? shown : `<b>${escapeHtml(label)}:</b> ${shown}`);
    }
    if (lines.length === 0) return '';
    return '\n\n📋 <b>Thông tin KH:</b>\n' + lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * Plain-text customer input for spoilers / group channel (no HTML).
 */
function formatCustomerInputPlain(inputValueEncrypted) {
  if (!inputValueEncrypted) return null;
  try {
    const { decryptString } = require('./secrets');
    const raw = decryptString(inputValueEncrypted);
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return String(raw);
    const lines = [];
    for (const [label, value] of Object.entries(parsed)) {
      if (!value) continue;
      const labelless = !label || /^__field_\d+$/.test(label);
      const isSecret = /password|pass|mật khẩu|m[aậ]t kh[aẩ]u/i.test(label);
      const shown = isSecret ? '••••••' : String(value);
      lines.push(labelless ? shown : `${label}: ${shown}`);
    }
    return lines.length > 0 ? lines.join('\n') : null;
  } catch {
    return null;
  }
}

/**
 * Decide whether to send keys inline vs as a .txt file attachment.
 * Telegram message body limit is 4096 chars; the delivery_keys template
 * adds ~300 chars of chrome. Budget ~3000 chars of raw key data before
 * falling back to a file. Single very long keys (>2000 chars) also go to
 * file regardless of count.
 */
function shouldSendAsFile(accounts) {
  const total = accounts.reduce((acc, k) => acc + k.length + 1, 0);
  return total > 3000 || accounts.some(k => k.length > 2000);
}

module.exports = messages;
module.exports.escapeHtml = escapeHtml;
module.exports.richifyText = richifyText;
module.exports.formatKeysForTelegram = formatKeysForTelegram;
module.exports.buildCustomerInputBlock = buildCustomerInputBlock;
module.exports.formatCustomerInputPlain = formatCustomerInputPlain;
module.exports.shouldSendAsFile = shouldSendAsFile;
