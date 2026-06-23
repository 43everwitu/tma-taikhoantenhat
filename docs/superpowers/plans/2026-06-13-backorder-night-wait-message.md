# Backorder Night Wait Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Mini App paid-backorder card show a 9:00 morning handling message outside `09:00-22:30` GMT+7.

**Architecture:** Put the time-window decision in a small backend helper so the source of truth is server-side and independent of the customer's device timezone. `GET /customer/orders/:id/status` returns `backorderWaitMode` for paid backorder orders, and the Mini App page renders the existing daytime copy or the new night copy based on that field.

**Tech Stack:** Node.js, Express, SQLite, Node built-in test runner, Next.js App Router, React client component.

---

## File Structure

- Create `src/utils/backorderWaitWindow.js`: pure backend helper for `Asia/Ho_Chi_Minh` business-hour mode.
- Create `tests/utils/backorderWaitWindow.test.js`: boundary tests for `08:59`, `09:00`, `22:30`, `22:31` GMT+7.
- Modify `src/api/routes/customer.js`: import helper and return `backorderWaitMode` only for backorder orders.
- Modify `tests/api/customer-order-status-backorder.test.js`: assert the status API exposes the new field for backorder orders and omits it for non-backorder orders.
- Modify `web/src/app/(miniapp)/don-hang/[id]/page.tsx`: add frontend type and render night copy for `backorderWaitMode === 'after_hours'`.

## Task 1: Backend Time Window Helper

**Files:**
- Create: `src/utils/backorderWaitWindow.js`
- Create: `tests/utils/backorderWaitWindow.test.js`

- [ ] **Step 1: Write the failing helper test**

Create `tests/utils/backorderWaitWindow.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');

const { getBackorderWaitMode } = require('../../src/utils/backorderWaitWindow');

test('getBackorderWaitMode uses after-hours before 09:00 GMT+7', () => {
  assert.strictEqual(
    getBackorderWaitMode(new Date('2026-06-13T01:59:00.000Z')),
    'after_hours',
  );
});

test('getBackorderWaitMode starts business hours at exactly 09:00 GMT+7', () => {
  assert.strictEqual(
    getBackorderWaitMode(new Date('2026-06-13T02:00:00.000Z')),
    'business_hours',
  );
});

test('getBackorderWaitMode keeps business hours through exactly 22:30 GMT+7', () => {
  assert.strictEqual(
    getBackorderWaitMode(new Date('2026-06-13T15:30:00.000Z')),
    'business_hours',
  );
});

test('getBackorderWaitMode switches to after-hours at 22:31 GMT+7', () => {
  assert.strictEqual(
    getBackorderWaitMode(new Date('2026-06-13T15:31:00.000Z')),
    'after_hours',
  );
});
```

- [ ] **Step 2: Run the helper test and verify it fails**

Run:

```bash
node --test tests/utils/backorderWaitWindow.test.js
```

Expected: FAIL with `Cannot find module '../../src/utils/backorderWaitWindow'`.

- [ ] **Step 3: Add the helper**

Create `src/utils/backorderWaitWindow.js`:

```js
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const BUSINESS_START_MINUTES = 9 * 60;
const BUSINESS_END_MINUTES = 22 * 60 + 30;

function getTimePartsInVietnam(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: VIETNAM_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);

  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return { hour: 9, minute: 0 };
  }

  return { hour, minute };
}

function getBackorderWaitMode(date = new Date()) {
  const { hour, minute } = getTimePartsInVietnam(date);
  const minutes = hour * 60 + minute;
  return minutes >= BUSINESS_START_MINUTES && minutes <= BUSINESS_END_MINUTES
    ? 'business_hours'
    : 'after_hours';
}

module.exports = {
  getBackorderWaitMode,
};
```

- [ ] **Step 4: Run the helper test and verify it passes**

Run:

```bash
node --test tests/utils/backorderWaitWindow.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/utils/backorderWaitWindow.js tests/utils/backorderWaitWindow.test.js
git commit -m "feat: add backorder wait time window helper"
```

Expected: commit contains only the helper and its test.

## Task 2: Add Backorder Wait Mode To Customer Status API

**Files:**
- Modify: `src/api/routes/customer.js`
- Modify: `tests/api/customer-order-status-backorder.test.js`

- [ ] **Step 1: Add failing API assertions**

In `tests/api/customer-order-status-backorder.test.js`, update the backorder test to assert the new field exists and is one of the two allowed modes:

```js
test('GET /customer/orders/:id/status marks paid backorder variant orders', async (t) => {
  const fixture = createPaidOrderFixture(true);
  t.after(() => cleanupFixture(fixture));

  const res = await requestJson(makeApp(), 'GET', `/customer/orders/${fixture.orderId}/status`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.status, 'paid');
  assert.strictEqual(res.json.data.isBackorder, true);
  assert.match(res.json.data.backorderWaitMode, /^(business_hours|after_hours)$/);
});
```

Update the non-backorder test to assert the field is absent:

```js
test('GET /customer/orders/:id/status marks paid non-backorder variant orders', async (t) => {
  const fixture = createPaidOrderFixture(false);
  t.after(() => cleanupFixture(fixture));

  const res = await requestJson(makeApp(), 'GET', `/customer/orders/${fixture.orderId}/status`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.status, 'paid');
  assert.strictEqual(res.json.data.isBackorder, false);
  assert.strictEqual(Object.hasOwn(res.json.data, 'backorderWaitMode'), false);
});
```

- [ ] **Step 2: Run API tests and verify they fail**

Run:

```bash
node --test tests/api/customer-order-status-backorder.test.js
```

Expected: FAIL because `backorderWaitMode` is missing from the backorder response.

- [ ] **Step 3: Import the helper in the customer route**

In `src/api/routes/customer.js`, add this near the other imports:

```js
const { getBackorderWaitMode } = require('../../utils/backorderWaitWindow');
```

- [ ] **Step 4: Compute the response field**

Inside `router.get('/orders/:id/status', ...)`, after the `variant` lookup, add:

```js
  const isBackorder = !!variant?.is_backorder;
  const backorderWaitMode = isBackorder ? getBackorderWaitMode() : undefined;
```

Then replace this response field:

```js
    isBackorder: !!variant?.is_backorder,
```

with:

```js
    isBackorder,
    backorderWaitMode,
```

Because `JSON.stringify` omits `undefined`, non-backorder responses will not include `backorderWaitMode`.

- [ ] **Step 5: Run API tests and helper tests**

Run:

```bash
node --test tests/utils/backorderWaitWindow.test.js tests/api/customer-order-status-backorder.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/api/routes/customer.js tests/api/customer-order-status-backorder.test.js
git commit -m "feat: expose backorder wait mode"
```

Expected: commit contains only the customer route and API test.

## Task 3: Render Night Message In Mini App Order Card

**Files:**
- Modify: `web/src/app/(miniapp)/don-hang/[id]/page.tsx`

- [ ] **Step 1: Update the frontend response type**

In `web/src/app/(miniapp)/don-hang/[id]/page.tsx`, update `OrderStatus`:

```ts
interface OrderStatus {
  id: string
  status: 'pending' | 'paid' | 'delivered' | 'cancelled' | 'expired'
  totalPrice: number; paymentCode: string; qrUrl: string; bankName: string; expiresAt: string
  accountNumber?: string; accountName?: string
  productName: string; quantity: number
  isBackorder?: boolean
  backorderWaitMode?: 'business_hours' | 'after_hours'
  accounts?: string[]; usageInstructions?: string | null
}
```

- [ ] **Step 2: Add the render branch for after-hours backorders**

Replace the current `order.isBackorder ? (...) : (...)` block with:

```tsx
          {order.isBackorder ? (
            order.backorderWaitMode === 'after_hours' ? (
              <>
                <p className="text-sm font-medium">Đơn hàng sẽ được xử lý lúc 9:00 sáng.</p>
                <p className="text-xs opacity-80 mt-1">Shop sẽ thông báo ngay khi đơn hoàn thành.</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Thanh toán đã được ghi nhận.</p>
                <p className="text-xs opacity-80 mt-1">
                  Shop sẽ xử lý đơn hàng và thông báo khi hoàn thành. Thời gian dự kiến: 30-60 phút, hoặc theo mô tả sản phẩm.
                </p>
                <p className="text-xs opacity-80 mt-2">
                  Cần hỗ trợ? Liên hệ{' '}
                  <a href="https://t.me/taikhoantenhat" target="_blank" rel="noopener noreferrer" className="font-semibold underline underline-offset-2">
                    @taikhoantenhat
                  </a>
                </p>
              </>
            )
          ) : (
            <>
              <p className="text-sm font-medium">Đang xử lý đơn hàng…</p>
              <p className="text-xs opacity-80 mt-1">Key sẽ giao trong giây lát.</p>
            </>
          )}
```

This preserves the daytime backorder copy and the non-backorder paid copy exactly.

- [ ] **Step 3: Run frontend lint**

Run:

```bash
cd web && npm run lint
```

Expected: PASS, or only pre-existing lint issues unrelated to `web/src/app/(miniapp)/don-hang/[id]/page.tsx`.

- [ ] **Step 4: Run focused backend tests again**

Run:

```bash
node --test tests/utils/backorderWaitWindow.test.js tests/api/customer-order-status-backorder.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add web/src/app/'(miniapp)'/don-hang/'[id]'/page.tsx
git commit -m "feat: show night backorder wait message"
```

Expected: commit contains only the Mini App order detail page.

## Task 4: Final Verification

**Files:**
- Verify: `src/utils/backorderWaitWindow.js`
- Verify: `src/api/routes/customer.js`
- Verify: `web/src/app/(miniapp)/don-hang/[id]/page.tsx`

- [ ] **Step 1: Run all targeted tests**

Run:

```bash
node --test tests/utils/backorderWaitWindow.test.js tests/api/customer-order-status-backorder.test.js
```

Expected: PASS.

- [ ] **Step 2: Run web lint**

Run:

```bash
cd web && npm run lint
```

Expected: PASS, or only pre-existing lint issues unrelated to this feature.

- [ ] **Step 3: Inspect final diff**

Run:

```bash
git diff -- src/utils/backorderWaitWindow.js tests/utils/backorderWaitWindow.test.js src/api/routes/customer.js tests/api/customer-order-status-backorder.test.js web/src/app/'(miniapp)'/don-hang/'[id]'/page.tsx
```

Expected: diff only covers:

- backend helper for `business_hours` / `after_hours`
- API field `backorderWaitMode`
- tests for precise GMT+7 boundaries
- Mini App copy switch for paid backorder cards

- [ ] **Step 4: Confirm no bot template changes**

Run:

```bash
git diff -- src/database/seeds/message-templates.json src/services/paymentPoller.js
```

Expected: no changes from this feature. The Telegram bot `bot.backorder_wait` message is out of scope.
