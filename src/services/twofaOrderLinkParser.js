const ALLOWED_ORDER_HOSTS = new Set([
  'order.taikhoantenhat.com',
  'order.godstudy.me',
  'order.subhub.vn',
]);

function parseDeliveredKeys(value) {
  try {
    const keys = JSON.parse(value || '[]');
    return Array.isArray(keys) ? keys.filter(key => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

function extractTwofaOrderLinks(values) {
  const links = [];
  const seenUurls = new Set();

  for (const value of values || []) {
    if (typeof value !== 'string') continue;
    for (const match of value.matchAll(/https:\/\/[^\s<>"']+/g)) {
      let parsed;
      try {
        parsed = new URL(match[0]);
      } catch {
        continue;
      }
      if (parsed.protocol !== 'https:' || parsed.port || !ALLOWED_ORDER_HOSTS.has(parsed.hostname)) {
        continue;
      }
      if (!/^\/[^/]+$/.test(parsed.pathname)) continue;

      let uurl;
      try {
        uurl = decodeURIComponent(parsed.pathname.slice(1));
      } catch {
        continue;
      }
      if (!uurl || uurl.includes('/') || seenUurls.has(uurl)) continue;

      seenUurls.add(uurl);
      links.push({
        uurl,
        host: parsed.hostname,
        orderUrl: `${parsed.origin}${parsed.pathname}`,
      });
    }
  }
  return links;
}

module.exports = {
  extractTwofaOrderLinks,
  parseDeliveredKeys,
};
