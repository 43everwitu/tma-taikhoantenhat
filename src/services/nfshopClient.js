const config = require('../config');

// kind: 'transient' (retry later) | 'conflict' (409, e.g. no live cookie) | 'rejected' (do not retry)
class NfshopError extends Error {
  constructor(message, { status = null, kind = 'rejected' } = {}) {
    super(message);
    this.name = 'NfshopError';
    this.status = status;
    this.kind = kind;
  }
}

function createClient({
  baseUrl = config.NFSHOP_API_URL,
  apiKey = config.NFSHOP_API_KEY,
  fetchImpl = (...args) => fetch(...args),
  timeoutMs = config.NFSHOP_TIMEOUT_MS,
  retries = 2,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const root = String(baseUrl || '').replace(/\/+$/, '');

  async function request(method, path, body) {
    if (!root || !apiKey) throw new NfshopError('nfshop is not configured', { kind: 'rejected' });
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt) await sleep(500 * attempt);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${root}${path}`, {
          method,
          headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        if (res.ok) return data;
        const message = (data && data.error) || `HTTP ${res.status}`;
        if (res.status >= 500) {
          lastErr = new NfshopError(message, { status: res.status, kind: 'transient' });
          continue;
        }
        if (res.status === 409) throw new NfshopError(message, { status: 409, kind: 'conflict' });
        throw new NfshopError(message, { status: res.status, kind: 'rejected' });
      } catch (err) {
        if (err instanceof NfshopError && err.kind !== 'transient') throw err;
        if (err instanceof NfshopError) { lastErr = err; continue; }
        // Never forward err.message: it can echo request details.
        const reason = err && err.name === 'AbortError' ? 'timeout' : 'network error';
        lastErr = new NfshopError(`nfshop request failed: ${reason}`, { kind: 'transient' });
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }

  return {
    createOrder: ({ packageId, validDays, linkQuota, reference }) => request('POST', '/api/v1/orders', {
      package_id: packageId,
      valid_days: validDays,
      ...(linkQuota != null ? { link_quota: linkQuota } : {}),
      external_reference: reference,
    }),
    extendOrder: (orderId, { days, addLinks, reference }) => request('POST', `/api/v1/orders/${orderId}/extend`, {
      ...(days != null ? { days } : {}),
      ...(addLinks != null ? { add_links: addLinks } : {}),
      reference,
    }),
    getOrder: (orderId) => request('GET', `/api/v1/orders/${orderId}`),
    revokeOrder: (orderId) => request('DELETE', `/api/v1/orders/${orderId}`),
    orderUrl: (publicId) => `${root}/o/${publicId}`,
  };
}

let defaultClient = null;
function getClient() {
  if (!defaultClient) defaultClient = createClient();
  return defaultClient;
}

module.exports = { createClient, getClient, NfshopError };
