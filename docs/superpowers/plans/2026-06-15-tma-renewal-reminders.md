# TMA Renewal Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add delivered key/license lifecycle visibility in TMA, create TMA notifications when renewal reminders are sent, and expose an admin "Gia hạn" log page.

**Architecture:** A new backend helper computes `keyLifecycle` from sold `stock` rows and is reused by customer APIs and reminder logging. The existing `keyExpiryReminderService` remains the scheduler and dedupe owner, but now writes a durable audit row and web notification after Telegram reminder delivery. Admin reads the audit table through a small route and a read-only dashboard page.

**Tech Stack:** Node.js/Express, SQLite/better-sqlite3 migrations, Next.js App Router, React Query, Node built-in test runner.

---

## File Structure

- Create `src/services/orderExpiryService.js`: centralizes key lifecycle calculation, reminder URLs, and best-effort order lookup for sold stock.
- Create `src/database/migrations/051_renewal_reminder_logs.js`: creates `renewal_reminder_logs`.
- Modify `src/services/keyExpiryReminderService.js`: creates web notifications and log rows.
- Modify `src/api/routes/customer.js`: returns `keyLifecycle` in `/orders/my` and `/orders/:id/status`.
- Create `src/api/routes/admin/renewals.js`: paginated read-only reminder log API.
- Modify `src/api/routes/admin/index.js`: mounts `/admin/renewals`.
- Modify `web/src/app/(miniapp)/don-hang/page.tsx`: renders lifecycle status in order list.
- Modify `web/src/app/(miniapp)/don-hang/[id]/page.tsx`: renders progress bar and lifecycle actions.
- Modify `web/src/app/(miniapp)/page.tsx`: renders renewal notification cards from `/notifications/my`.
- Create `web/src/app/(admin)/admin/renewals/page.tsx`: admin log page.
- Modify `web/src/components/AdminSidebar.tsx`: adds "Gia hạn" nav item.
- Test `tests/services/orderExpiryService.test.js`: lifecycle status and URL shaping.
- Test `tests/services/keyExpiryReminderService.test.js`: reminder creates notifications and logs.
- Test `tests/api/customer-order-key-lifecycle.test.js`: customer APIs include lifecycle.
- Test `tests/api/admin-renewals.test.js`: admin route returns log rows.

## Tasks

### Task 1: Backend lifecycle helper

**Files:**
- Create: `tests/services/orderExpiryService.test.js`
- Create: `src/services/orderExpiryService.js`

- [ ] **Step 1: Write failing service tests**

Test active, soon, expired, and no-duration rows. Assert `renewUrl` is `/san-pham/<slug>?renewFromOrderId=<orderId>`.

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/services/orderExpiryService.test.js`

Expected: FAIL because `src/services/orderExpiryService.js` does not exist.

- [ ] **Step 3: Implement minimal helper**

Implement:

- `getReminderDays()`
- `getKeyLifecycleForOrder(order)`
- `decorateOrdersWithLifecycle(orders)`
- `findDeliveredOrderForStock(row)`
- date math using SQLite `DATE(...)` to match existing service behavior.

- [ ] **Step 4: Run service tests**

Run: `node --test tests/services/orderExpiryService.test.js`

Expected: PASS.

### Task 2: Customer API lifecycle metadata

**Files:**
- Create: `tests/api/customer-order-key-lifecycle.test.js`
- Modify: `src/api/routes/customer.js`

- [ ] **Step 1: Write failing API tests**

Create delivered order fixtures with sold stock duration. Assert:

- `/orders/my` returns `keyLifecycle.statusLabel`.
- `/orders/:id/status` returns `keyLifecycle.startDate`, `expiryDate`, `remainingDays`, `progressPercent`, `renewUrl`, `orderUrl`.

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/api/customer-order-key-lifecycle.test.js`

Expected: FAIL because APIs do not return `keyLifecycle`.

- [ ] **Step 3: Wire helper into customer routes**

Use `orderExpiryService.decorateOrdersWithLifecycle()` for `/orders/my` and `orderExpiryService.getKeyLifecycleForOrder(order)` for `/orders/:id/status`.

- [ ] **Step 4: Run API tests**

Run: `node --test tests/api/customer-order-key-lifecycle.test.js`

Expected: PASS.

### Task 3: Reminder logs and web notification

**Files:**
- Create: `src/database/migrations/051_renewal_reminder_logs.js`
- Create: `tests/services/keyExpiryReminderService.test.js`
- Modify: `src/services/keyExpiryReminderService.js`

- [ ] **Step 1: Write failing reminder tests**

Seed a sold stock row due for reminder, stub bot `telegram.sendMessage`, run `sweep()`, assert:

- `notifications` contains a `renewal_reminder` row with action URLs in `data`.
- `renewal_reminder_logs` contains a sent row.
- `stock.reminder_sent_at` is set.

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/services/keyExpiryReminderService.test.js`

Expected: FAIL because the log table and notification creation are missing.

- [ ] **Step 3: Add migration and reminder logging**

Create `renewal_reminder_logs`. Update sweep to:

- calculate lifecycle for due stock
- send Telegram
- insert web notification
- insert log row for `sent`, `skipped`, or `failed`
- preserve current dedupe behavior.

- [ ] **Step 4: Run reminder tests**

Run: `node --test tests/services/keyExpiryReminderService.test.js`

Expected: PASS.

### Task 4: Admin renewal log API

**Files:**
- Create: `src/api/routes/admin/renewals.js`
- Create: `tests/api/admin-renewals.test.js`
- Modify: `src/api/routes/admin/index.js`

- [ ] **Step 1: Write failing admin API test**

Insert log rows and call `/admin/renewals`. Assert response includes `items`, `total`, and shaped fields.

- [ ] **Step 2: Run test to verify RED**

Run: `node --test tests/api/admin-renewals.test.js`

Expected: FAIL because route is not mounted.

- [ ] **Step 3: Implement route**

Add `GET /admin/renewals` with `page`, `limit`, `status`, and `q` filters.

- [ ] **Step 4: Run admin API test**

Run: `node --test tests/api/admin-renewals.test.js`

Expected: PASS.

### Task 5: TMA lifecycle UI and admin page

**Files:**
- Modify: `web/src/app/(miniapp)/don-hang/page.tsx`
- Modify: `web/src/app/(miniapp)/don-hang/[id]/page.tsx`
- Modify: `web/src/app/(miniapp)/page.tsx`
- Create: `web/src/app/(admin)/admin/renewals/page.tsx`
- Modify: `web/src/components/AdminSidebar.tsx`

- [ ] **Step 1: Add TypeScript types**

Add `KeyLifecycle` to both TMA order pages and admin renewal row types.

- [ ] **Step 2: Render TMA order list status**

For delivered orders with `keyLifecycle`, show lifecycle label and status-specific pill class while preserving existing order status for non-delivered orders.

- [ ] **Step 3: Render TMA detail progress**

Add a compact card under the order summary showing start date, remaining days, expiry date, progress bar, and `Gia hạn ngay` / `Xem đơn` actions.

- [ ] **Step 4: Render admin renewals page**

Build a read-only table matching existing admin card/table style and add sidebar nav item.

- [ ] **Step 5: Render TMA renewal notification cards**

Read `/notifications/my`, filter `renewal_reminder`, and show the latest cards above announcements with `Gia hạn ngay` and `Xem đơn`.

- [ ] **Step 6: Verify web types/lint**

Run:

```bash
cd web && npx tsc --noEmit --pretty false
cd web && npx eslint src/app/\\(miniapp\\)/page.tsx src/app/\\(miniapp\\)/don-hang/page.tsx src/app/\\(miniapp\\)/don-hang/\\[id\\]/page.tsx src/app/\\(admin\\)/admin/renewals/page.tsx src/components/AdminSidebar.tsx
```

Expected: both commands exit 0.

### Task 6: Final verification

**Files:** no new files.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
node --test tests/services/orderExpiryService.test.js tests/services/keyExpiryReminderService.test.js tests/api/customer-order-key-lifecycle.test.js tests/api/admin-renewals.test.js
```

Expected: PASS.

- [ ] **Step 2: Run existing relevant regression tests**

Run:

```bash
node --test tests/api/customer-order-status-backorder.test.js tests/services/orderFulfillmentBackorderChannelOnly.test.js
```

Expected: PASS.

- [ ] **Step 3: Inspect changed files**

Run: `git diff --stat`

Expected: changes are limited to renewal reminder backend, TMA UI, admin UI, docs, and focused tests.
