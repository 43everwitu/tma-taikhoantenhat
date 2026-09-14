const ORDER_PAYLOAD = /^order_(\d{1,12})$/;
const PRODUCT_PAYLOAD = /^product_([a-zA-Z0-9-]{1,200})$/;

function configuredMiniAppUrl() {
  return (process.env.MINIAPP_URL || '').trim();
}

function payloadPath(payload) {
  const orderMatch = ORDER_PAYLOAD.exec(payload || '');
  if (orderMatch) return `/don-hang/${orderMatch[1]}`;
  const productMatch = PRODUCT_PAYLOAD.exec(payload || '');
  if (productMatch) return `/san-pham/${productMatch[1]}`;
  return null;
}

function buildMiniAppUrl(payload = '') {
  const base = configuredMiniAppUrl();
  if (!base) return '';

  const path = payloadPath(payload);
  if (!path) return base;

  try {
    const url = new URL(base);
    url.pathname = path;
    return url.toString();
  } catch {
    return base.replace(/\/+$/, '') + path;
  }
}

function buildStartLink(botUsername, payload = '') {
  const param = payloadPath(payload) ? payload : '';
  if (!botUsername) return configuredMiniAppUrl();
  return `https://t.me/${botUsername}?startapp${param ? `=${param}` : ''}`;
}

function openShopButton(text = 'Mở cửa hàng', options = {}) {
  if (options.preferStartLink && options.botUsername) {
    return { text, url: buildStartLink(options.botUsername, options.payload || '') };
  }

  const url = buildMiniAppUrl(options.payload || '');
  if (url) return { text, web_app: { url } };

  const fallback = buildStartLink(options.botUsername, options.payload || '');
  return { text, url: fallback };
}

module.exports = {
  buildMiniAppUrl,
  buildStartLink,
  openShopButton,
};
