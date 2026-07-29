import assert from 'node:assert';
import test from 'node:test';

test('required miniapp auth waits for an inflight token request', async () => {
  const auth = await import('../../web/src/lib/miniappAuth.ts');
  auth.clearAuth();

  let resolveFetch;
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { Telegram: { WebApp: { initData: 'tg-init-data' } } };
  globalThis.fetch = async () => {
    fetchCalls += 1;
    await new Promise((resolve) => { resolveFetch = resolve; });
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          token: 'customer-jwt',
          user: { telegramId: 123, username: null, fullName: 'Test User', balance: 0 },
        },
      }),
    };
  };

  try {
    const first = auth.getMiniAppToken('tg-init-data');
    const required = auth.requireMiniAppToken();
    resolveFetch();

    assert.strictEqual(await first, 'customer-jwt');
    assert.strictEqual(await required, 'customer-jwt');
    assert.strictEqual(fetchCalls, 1);
  } finally {
    auth.clearAuth();
    globalThis.fetch = originalFetch;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
