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
 * Format a list of delivered keys for Telegram. Each key wrapped in <pre> code
 * block so the customer can long-press → copy without text being mangled by
 * autoformatters. No numbered prefix.
 */
const URL_RE_KEYS = /https?:\/\/[^\s<>"']+/g;

function linkifyEscaped(s) {
  // Tokenise around URLs, escape each side, wrap URLs in <a>. Telegram HTML
  // requires URLs OUTSIDE <pre>/<code> to render as clickable links.
  const parts = [];
  let lastIdx = 0;
  let m;
  URL_RE_KEYS.lastIndex = 0;
  while ((m = URL_RE_KEYS.exec(s)) !== null) {
    if (m.index > lastIdx) parts.push(escapeHtml(s.slice(lastIdx, m.index)));
    const u = m[0];
    parts.push(`<a href="${escapeHtml(u)}">${escapeHtml(u)}</a>`);
    lastIdx = m.index + u.length;
  }
  if (lastIdx < s.length) parts.push(escapeHtml(s.slice(lastIdx)));
  return parts.join('');
}

function formatKeysForTelegram(accounts) {
  // Keys with URLs render mixed text + clickable <a> links (no <pre> wrap
  // since Telegram won't render anchors inside pre/code). Plain keys get
  // <code> so they're monospaced + long-press-copy-friendly.
  return accounts.map(k => {
    URL_RE_KEYS.lastIndex = 0;
    if (URL_RE_KEYS.test(k)) {
      return linkifyEscaped(k);
    }
    return `<code>${escapeHtml(k)}</code>`;
  }).join('\n');
}

/**
 * Decide whether to send keys inline vs as a .txt file attachment.
 * Telegram message body limit is 4096 chars; the delivery_keys template
 * adds ~300 chars of chrome, and formatKeysForTelegram wraps each key in
 * <pre>...</pre> (+~12 chars/key). Budget ~3000 chars of raw key data
 * before falling back to a file. Single very long keys (>2000 chars) also
 * go to file regardless of count.
 */
function shouldSendAsFile(accounts) {
  const total = accounts.reduce((acc, k) => acc + k.length + 1, 0);
  return total > 3000 || accounts.some(k => k.length > 2000);
}

module.exports = messages;
module.exports.escapeHtml = escapeHtml;
module.exports.richifyText = richifyText;
module.exports.formatKeysForTelegram = formatKeysForTelegram;
module.exports.shouldSendAsFile = shouldSendAsFile;
