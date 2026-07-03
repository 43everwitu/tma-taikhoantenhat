const ORDER_PAYLOAD = /^order_(\d{1,12})$/;

function configuredMiniAppUrl() {
  return (process.env.MINIAPP_URL || '').trim();
}

function buildMiniAppUrl(payload = '') {
  const base = configuredMiniAppUrl();
  if (!base) return '';

  const match = ORDER_PAYLOAD.exec(payload || '');
  if (!match) return base;

  try {
    const url = new URL(base);
    url.pathname = `/don-hang/${match[1]}`;
    return url.toString();
  } catch {
    return base.replace(/\/+$/, '') + `/don-hang/${match[1]}`;
  }
}

function buildStartLink(botUsername, payload = '') {
  const match = ORDER_PAYLOAD.exec(payload || '');
  const param = match ? `order_${match[1]}` : '';
  if (!botUsername) return configuredMiniAppUrl();
  return `https://t.me/${botUsername}?startapp${param ? `=${param}` : ''}`;
}

function openShopButton(text = 'Mở cửa hàng', options = {}) {
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
