# Payment Poller Vietnam Timezone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automatic MBBank polling use the Vietnam banking date and run the production Node processes with `TZ=Asia/Ho_Chi_Minh`.

**Architecture:** Keep the existing poller flow intact and replace only the date source used for the MBBank request. Add process-level timezone configuration in PM2 and `.env.example` so logs, process-local date behavior, and SQLite localtime modifiers use the Vietnam timezone without relying on OS timezone changes. SQLite `datetime('now')` and `CURRENT_TIMESTAMP` remain UTC.

**Tech Stack:** Node.js 22, built-in `Intl.DateTimeFormat`, PM2 ecosystem config, Node built-in test runner (`node --test`).

---

## File Structure

- Modify `src/services/paymentPoller.js`: add a small Vietnam-date helper and use it in `_fetchTransactions()`.
- Temporarily modify `tests/services/paymentPollerLateRecovery.test.js`: add one boundary test during implementation, run it, then remove it before final commit per operator request.
- Modify `ecosystem.config.cjs`: set `TZ=Asia/Ho_Chi_Minh` for `taikhoantenhat-api` and `taikhoantenhat-web`.
- Modify `.env.example`: document `TZ=Asia/Ho_Chi_Minh` in runtime env.

## Task 1: Poller Uses Vietnam Date For MBBank Requests

**Files:**
- Modify: `src/services/paymentPoller.js`
- Temporarily modify: `tests/services/paymentPollerLateRecovery.test.js`

- [ ] **Step 1: Add the temporary failing boundary test**

Append a focused temporary boundary test to `tests/services/paymentPollerLateRecovery.test.js`:

```js
test('temporary boundary test: poller queries MBBank using Vietnam calendar date', async (t) => {
  const poller = new PaymentPoller(db, makeBot());
  let requestBody = null;
  const realFetch = global.fetch;
  const RealDate = global.Date;
  const boundaryUtcTimestamp = '<a UTC evening timestamp that is already the next calendar day in Vietnam>';

  class FakeDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) return new RealDate(boundaryUtcTimestamp);
      return new RealDate(...args);
    }

    static now() {
      return new RealDate(boundaryUtcTimestamp).getTime();
    }

    static parse(value) {
      return RealDate.parse(value);
    }

    static UTC(...args) {
      return RealDate.UTC(...args);
    }
  }

  t.after(() => {
    global.fetch = realFetch;
    global.Date = RealDate;
  });

  global.Date = FakeDate;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ success: true, results: [] }),
    };
  };

  await poller._fetchTransactions(1000);

  assert.strictEqual(requestBody.from_date, '2026-06-13');
  assert.strictEqual(requestBody.to_date, '2026-06-13');
});
```

- [ ] **Step 2: Run the temporary test and verify it fails**

Run:

```bash
node --test tests/services/paymentPollerLateRecovery.test.js
```

Expected: FAIL on the temporary test because current code sends `2026-06-12` from `toISOString()`.

- [ ] **Step 3: Add Vietnam date helper**

In `src/services/paymentPoller.js`, add these constants/functions after the regex constants and before `normalizeCode()`:

```js
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

function formatDateInTimeZone(date = new Date(), timeZone = VIETNAM_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  return `${parts.year}-${parts.month}-${parts.day}`;
}
```

Change `_fetchTransactions()` from:

```js
const today = new Date().toISOString().split('T')[0];
```

to:

```js
const today = formatDateInTimeZone();
```

Keep the module export as `module.exports = { PaymentPoller };`. Do not export the helper unless a permanent test later requires it.

- [ ] **Step 4: Run the temporary boundary test and verify it passes**

Run:

```bash
node --test tests/services/paymentPollerLateRecovery.test.js
```

Expected: PASS.

- [ ] **Step 5: Remove the temporary test**

Delete only the temporary boundary test block from `tests/services/paymentPollerLateRecovery.test.js`.

- [ ] **Step 6: Run existing payment tests after deleting the temporary test**

Run:

```bash
node --test tests/services/paymentPollerLateRecovery.test.js tests/services/orderRecovery.test.js
```

Expected: PASS. This proves existing late-payment recovery still works after the one-off boundary test is removed.

- [ ] **Step 7: Commit Task 1**

Stage only the code file. Do not stage the temporary test because it must be deleted before commit.

```bash
git add src/services/paymentPoller.js
git commit -m "fix: use vietnam date for mbbank polling"
```

Expected: commit includes `src/services/paymentPoller.js` only.

## Task 2: Set Runtime Timezone In PM2 And Env Example

**Files:**
- Modify: `ecosystem.config.cjs`
- Modify: `.env.example`

- [ ] **Step 1: Add timezone to `.env.example`**

In `.env.example`, under the API server and web env section after `NODE_ENV=development`, add:

```dotenv
# Runtime timezone for logs, local Date behavior, and SQLite localtime modifiers.
# SQLite datetime('now')/CURRENT_TIMESTAMP remain UTC.
TZ=Asia/Ho_Chi_Minh
```

- [ ] **Step 2: Add timezone to the API PM2 process**

In `ecosystem.config.cjs`, change the `taikhoantenhat-api` `env` block from:

```js
env: {
  NODE_ENV: 'production',
},
```

to:

```js
env: {
  NODE_ENV: 'production',
  TZ: 'Asia/Ho_Chi_Minh',
},
```

- [ ] **Step 3: Add timezone to the web PM2 process**

In `ecosystem.config.cjs`, change the `taikhoantenhat-web` `env` block from:

```js
env: {
  NODE_ENV: 'production',
  PORT: String(WEB_PORT),
  API_BACKEND_URL,
},
```

to:

```js
env: {
  NODE_ENV: 'production',
  TZ: 'Asia/Ho_Chi_Minh',
  PORT: String(WEB_PORT),
  API_BACKEND_URL,
},
```

- [ ] **Step 4: Validate PM2 config syntax**

Run:

```bash
node -e "require('./ecosystem.config.cjs'); console.log('ecosystem ok')"
```

Expected:

```text
ecosystem ok
```

- [ ] **Step 5: Commit Task 2**

Stage only the runtime config docs/files:

```bash
git add ecosystem.config.cjs .env.example
git commit -m "chore: set vietnam timezone for pm2 runtime"
```

Expected: commit includes only `ecosystem.config.cjs` and `.env.example`.

## Task 3: Final Verification And Working Tree Hygiene

**Files:**
- Verify: `src/services/paymentPoller.js`
- Verify: `ecosystem.config.cjs`
- Verify: `.env.example`
- Verify: `tests/services/paymentPollerLateRecovery.test.js`

- [ ] **Step 1: Confirm no temporary test remains**

Run:

```bash
rg -n "temporary boundary test|boundaryUtcTimestamp" tests/services/paymentPollerLateRecovery.test.js
```

Expected: no matches and exit code `1`.

- [ ] **Step 2: Confirm poller no longer derives the banking date from UTC ISO**

Run:

```bash
rg -n "toISOString\\(\\).*split\\('T'\\)|toISOString\\(\\).*slice\\(0, 10\\)" src/services/paymentPoller.js
```

Expected: no matches and exit code `1`.

- [ ] **Step 3: Run payment-related tests**

Run:

```bash
node --test tests/services/paymentPollerLateRecovery.test.js tests/services/orderRecovery.test.js tests/services/pollerInterval.test.js
```

Expected: PASS.

- [ ] **Step 4: Validate PM2 config again**

Run:

```bash
node -e "const cfg=require('./ecosystem.config.cjs'); const api=cfg.apps.find(a=>a.name==='taikhoantenhat-api'); const web=cfg.apps.find(a=>a.name==='taikhoantenhat-web'); if (api.env.TZ !== 'Asia/Ho_Chi_Minh' || web.env.TZ !== 'Asia/Ho_Chi_Minh') throw new Error('missing TZ'); console.log('pm2 tz ok')"
```

Expected:

```text
pm2 tz ok
```

- [ ] **Step 5: Confirm only intended files were committed**

Run:

```bash
git show --name-only --oneline HEAD~1..HEAD
```

Expected: recent implementation commits should include only:

```text
src/services/paymentPoller.js
ecosystem.config.cjs
.env.example
```

Do not revert unrelated dirty working tree files.
