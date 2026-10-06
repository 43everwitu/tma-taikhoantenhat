const assert = require('node:assert');
const test = require('node:test');
const { createClient, NfshopError } = require('../../src/services/nfshopClient');

function res(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) };
}
function make(responses, extra = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const client = createClient({
    baseUrl: 'https://nf.example/', apiKey: 'k-secret-123', fetchImpl, retries: 2, sleep: async () => {}, timeoutMs: 1000, ...extra,
  });
  return { client, calls };
}

test('createOrder posts JSON with api key header', async () => {
  const { client, calls } = make([res(201, { id: 5, public_id: 'abc' })]);
  const order = await client.createOrder({ packageId: 3, validDays: 7, linkQuota: 2, reference: 'tma-1' });
  assert.strictEqual(order.public_id, 'abc');
  assert.strictEqual(calls[0].url, 'https://nf.example/api/v1/orders');
  assert.strictEqual(calls[0].init.method, 'POST');
  assert.strictEqual(calls[0].init.headers['X-API-Key'], 'k-secret-123');
  assert.deepStrictEqual(JSON.parse(calls[0].init.body), { package_id: 3, valid_days: 7, link_quota: 2, external_reference: 'tma-1' });
});

test('createOrder omits link_quota when not provided', async () => {
  const { client, calls } = make([res(201, { id: 5, public_id: 'abc' })]);
  await client.createOrder({ packageId: 3, validDays: 30, reference: 'tma-2' });
  assert.ok(!('link_quota' in JSON.parse(calls[0].init.body)));
});

test('extendOrder posts to extend path', async () => {
  const { client, calls } = make([res(200, { id: 5 })]);
  await client.extendOrder(5, { days: 30, reference: 'tma-3' });
  assert.strictEqual(calls[0].url, 'https://nf.example/api/v1/orders/5/extend');
  assert.deepStrictEqual(JSON.parse(calls[0].init.body), { days: 30, reference: 'tma-3' });
});

test('5xx is retried then succeeds', async () => {
  const { client, calls } = make([res(503, { error: 'busy' }), res(502, {}), res(200, { id: 1 })]);
  assert.deepStrictEqual(await client.getOrder(1), { id: 1 });
  assert.strictEqual(calls.length, 3);
});

test('5xx beyond retries throws transient', async () => {
  const { client, calls } = make([res(500, {}), res(500, {}), res(500, {})]);
  await assert.rejects(() => client.getOrder(1), (e) => e instanceof NfshopError && e.kind === 'transient' && e.status === 500);
  assert.strictEqual(calls.length, 3);
});

test('network error and timeout are transient', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const { client } = make([new Error('ECONNRESET'), abort, new Error('ECONNRESET')]);
  await assert.rejects(() => client.getOrder(1), (e) => e.kind === 'transient');
});

test('409 is conflict and not retried; 4xx is rejected and not retried', async () => {
  let { client, calls } = make([res(409, { error: 'Không còn cookie live để cấp đơn.' })]);
  await assert.rejects(() => client.createOrder({ packageId: 1, validDays: 7, reference: 'r' }), (e) => e.kind === 'conflict' && e.status === 409);
  assert.strictEqual(calls.length, 1);
  ({ client, calls } = make([res(400, { error: 'bad' })]));
  await assert.rejects(() => client.createOrder({ packageId: 1, validDays: 7, reference: 'r' }), (e) => e.kind === 'rejected' && e.status === 400 && e.message === 'bad');
  assert.strictEqual(calls.length, 1);
});

test('missing config is rejected without calling fetch; errors never contain the api key', async () => {
  const { client, calls } = make([], { apiKey: '' });
  await assert.rejects(() => client.getOrder(1), (e) => e.kind === 'rejected');
  assert.strictEqual(calls.length, 0);
  const { client: c2 } = make([new Error('boom k-secret-123'), new Error('boom k-secret-123'), new Error('boom k-secret-123')]);
  await assert.rejects(() => c2.getOrder(1), (e) => !e.message.includes('k-secret-123'));
});

test('orderUrl strips trailing slash', () => {
  const { client } = make([]);
  assert.strictEqual(client.orderUrl('abc'), 'https://nf.example/o/abc');
});
