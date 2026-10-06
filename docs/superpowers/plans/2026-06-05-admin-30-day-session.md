# Admin 30-Day Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin full session lasts 30 days by default, can be changed via `.env`, and invalid admin tokens send the user back to login.

**Architecture:** Backend keeps the current JWT bearer-token model but moves full admin TTL into `config.ADMIN_TOKEN_EXPIRY`. Frontend keeps localStorage admin token storage and adds a central 401 handler in `apiFetch` for `/admin/*` calls.

**Tech Stack:** Node.js, Express, jose JWT, Next.js App Router, TypeScript, Node built-in test runner.

---

### Task 1: Backend Admin JWT Expiry

**Files:**
- Create: `tests/services/adminAuthExpiry.test.js`
- Modify: `src/config.js`
- Modify: `src/services/authService.js`
- Modify: `.env.example`

- [ ] **Step 1: Write failing expiry tests**

Add `tests/services/adminAuthExpiry.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');

async function decodeJwt(token) {
  const { decodeJwt } = await import('jose');
  return decodeJwt(token);
}

function reloadAuthService(expiry) {
  if (expiry === undefined) delete process.env.ADMIN_TOKEN_EXPIRY;
  else process.env.ADMIN_TOKEN_EXPIRY = expiry;
  process.env.JWT_SECRET = 'test-secret-for-admin-expiry-tests-must-be-long';

  delete require.cache[require.resolve('../../src/config')];
  delete require.cache[require.resolve('../../src/services/authService')];
  return require('../../src/services/authService');
}

test('full admin token defaults to 30 days', async () => {
  const authService = reloadAuthService(undefined);
  const token = await authService.issueFullAdminToken({ id: -9001, role: 'admin', username: 'expiry-default' });
  const payload = await decodeJwt(token);

  assert.strictEqual(payload.exp - payload.iat, 30 * 24 * 60 * 60);
});

test('full admin token uses ADMIN_TOKEN_EXPIRY from env', async () => {
  const authService = reloadAuthService('7d');
  const token = await authService.issueFullAdminToken({ id: -9002, role: 'admin', username: 'expiry-custom' });
  const payload = await decodeJwt(token);

  assert.strictEqual(payload.exp - payload.iat, 7 * 24 * 60 * 60);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/services/adminAuthExpiry.test.js`

Expected: FAIL because current admin full token TTL is `24h`.

- [ ] **Step 3: Add config value**

In `src/config.js`, under auth config:

```js
ADMIN_TOKEN_EXPIRY: process.env.ADMIN_TOKEN_EXPIRY || '30d',
```

- [ ] **Step 4: Use config in full admin token issuance**

In `src/services/authService.js`, remove the hard-coded `ADMIN_TOKEN_EXPIRY = '24h'` constant and use `config.ADMIN_TOKEN_EXPIRY` in:

- `adminLogin()` direct full token branch
- `verifyAdminTwoFactor()`
- `issueFullAdminToken()`

Keep `CHALLENGE_TOKEN_EXPIRY = '5m'` and `ENROLL_TOKEN_EXPIRY = '15m'` unchanged.

- [ ] **Step 5: Document env variable**

In `.env.example`, add near auth:

```env
# Full admin JWT session lifetime. jose accepts values like 12h, 7d, 30d.
ADMIN_TOKEN_EXPIRY=30d
```

- [ ] **Step 6: Run expiry test to verify it passes**

Run: `node --test tests/services/adminAuthExpiry.test.js`

Expected: PASS.

### Task 2: Admin Frontend Auto Logout on 401

**Files:**
- Modify: `web/src/lib/api.ts`
- Modify: `web/src/components/admin/ImageUploader.tsx`

- [ ] **Step 1: Add central admin auth failure handler**

In `web/src/lib/api.ts`, add a small helper near token functions:

```ts
export function handleAdminUnauthorized() {
  if (typeof window === 'undefined') return
  clearAdminToken()
  if (window.location.pathname !== '/admin/login') {
    window.location.assign('/admin/login')
  }
}
```

- [ ] **Step 2: Call handler from apiFetch**

In `apiFetch`, after parsing JSON and before throwing the existing API error, add:

```ts
if (isAdmin && res.status === 401) {
  handleAdminUnauthorized()
}
```

Keep the current thrown error behavior after the handler.

- [ ] **Step 3: Reuse handler for admin image upload**

In `web/src/components/admin/ImageUploader.tsx`, import `handleAdminUnauthorized` and call it when upload returns 401:

```ts
if (res.status === 401) {
  handleAdminUnauthorized()
}
```

Keep existing upload error display after this check.

- [ ] **Step 4: Build frontend**

Run: `npm run build:web`

Expected: PASS. If sandbox blocks Google Fonts, rerun the same command with network approval.

### Task 3: Final Verification

**Files:**
- Read-only verification across changed files.

- [ ] **Step 1: Run focused backend test**

Run: `node --test tests/services/adminAuthExpiry.test.js`

Expected: PASS.

- [ ] **Step 2: Run frontend build**

Run: `npm run build:web`

Expected: PASS.

- [ ] **Step 3: Inspect auth expiry references**

Run: `grep -R "ADMIN_TOKEN_EXPIRY\\|CHALLENGE_TOKEN_EXPIRY\\|ENROLL_TOKEN_EXPIRY" -n src .env.example tests/services/adminAuthExpiry.test.js`

Expected: full admin token references use config/default 30d, while challenge and enroll TTLs remain short.
