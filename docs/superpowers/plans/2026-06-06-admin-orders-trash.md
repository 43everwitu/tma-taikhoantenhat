# Admin Orders Trash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép admin chọn nhiều đơn để xóa mềm, ẩn khỏi danh sách chính, xem trong tab "Đã xóa", khôi phục trong 30 ngày và tự dọn vĩnh viễn sau 30 ngày.

**Architecture:** Thêm cột `orders.deleted_at` và `orders.deleted_by` để xóa mềm mà không đổi `orders.status`. Route admin orders mặc định lọc `deleted_at IS NULL`; tab "Đã xóa" dùng `view=deleted`. Service chịu trách nhiệm bulk soft-delete, bulk restore trong 30 ngày và hard-delete sau 30 ngày.

**Tech Stack:** Node.js/Express, better-sqlite3 migrations, Next.js admin UI, React Query, `ResponsiveTable` selection.

---

### Task 1: Database + Order Service

**Files:**
- Create: `src/database/migrations/047_order_soft_delete.js`
- Modify: `src/services/orderService.js`
- Test: `tests/services/orderSoftDelete.test.js`

- [ ] **Step 1: Write failing service tests**

Create `tests/services/orderSoftDelete.test.js` covering:
- `softDeleteOrders([id], adminId)` sets `deleted_at` and `deleted_by` without changing `status`.
- `restoreDeletedOrders([id])` clears delete columns for a recent deleted order.
- `restoreDeletedOrders([id])` refuses rows where `deleted_at <= datetime('now', '-30 days')`.
- `cleanupDeletedOrders(30)` hard-deletes rows older than 30 days and nulls `transactions.matched_order_id`.

- [ ] **Step 2: Run service test and verify failure**

Run: `node --test tests/services/orderSoftDelete.test.js`

Expected: FAIL because service methods and DB columns do not exist.

- [ ] **Step 3: Add migration**

Add `deleted_at DATETIME`, `deleted_by INTEGER`, index `idx_orders_deleted_at`, and index `idx_orders_visible_status_created`.

- [ ] **Step 4: Implement service methods**

Add:
- `softDeleteOrders(orderIds, adminId)`
- `restoreDeletedOrders(orderIds)`
- `cleanupDeletedOrders(days = 30)`

Also update `cleanupExpiredOrders()` so it does not hard-delete rows already soft-deleted.

- [ ] **Step 5: Run service test and verify pass**

Run: `node --test tests/services/orderSoftDelete.test.js`

Expected: PASS.

### Task 2: Admin Orders API

**Files:**
- Modify: `src/api/routes/admin/orders.js`
- Test: `tests/api/admin-orders-soft-delete.test.js`

- [ ] **Step 1: Write failing API tests**

Create `tests/api/admin-orders-soft-delete.test.js` covering:
- Default `GET /admin/orders` excludes soft-deleted orders.
- `GET /admin/orders?view=deleted` returns soft-deleted orders.
- `POST /admin/orders/bulk-delete` soft-deletes selected ids and writes audit.
- `POST /admin/orders/bulk-restore` restores selected ids and writes audit.

- [ ] **Step 2: Run API test and verify failure**

Run: `node tests/api/admin-orders-soft-delete.test.js`

Expected: FAIL before route implementation.

- [ ] **Step 3: Implement API**

Add `view` query handling:
- default/active: `o.deleted_at IS NULL`
- deleted: `o.deleted_at IS NOT NULL`

Add endpoints:
- `POST /admin/orders/bulk-delete` with body `{ ids: string[] }`
- `POST /admin/orders/bulk-restore` with body `{ ids: string[] }`

Include `deletedAt` and `deletedBy` in `shapeOrder()`.

- [ ] **Step 4: Run API test and verify pass**

Run: `node tests/api/admin-orders-soft-delete.test.js`

Expected: PASS.

### Task 3: Admin Orders UI

**Files:**
- Modify: `web/src/app/(admin)/admin/orders/page.tsx`

- [ ] **Step 1: Add UI state**

Add `orderView: 'active' | 'deleted'`, `selectedIds`, and selection helpers.

- [ ] **Step 2: Query by tab**

Include `view=deleted` only on deleted tab and include `orderView` in React Query key.

- [ ] **Step 3: Use ResponsiveTable selection**

Pass `selectable`, `selectedIds`, `onToggleRow`, and `onToggleAll` to `ResponsiveTable`.

- [ ] **Step 4: Add bulk toolbar**

Active tab: show "Xóa" and "Bỏ chọn".

Deleted tab: show "Khôi phục" and "Bỏ chọn".

- [ ] **Step 5: Adjust row actions**

Deleted tab: show only "Khôi phục".

Active tab: keep existing actions.

### Task 4: Verification + Runtime

**Files:**
- No new source files.

- [ ] **Step 1: Syntax checks**

Run:
- `node --check src/api/routes/admin/orders.js`
- `node --check src/services/orderService.js`

- [ ] **Step 2: Focused tests**

Run:
- `node --test tests/services/orderSoftDelete.test.js`
- `node tests/api/admin-orders-soft-delete.test.js`
- `node tests/api/admin-orders-expired-confirm.test.js`

- [ ] **Step 3: Frontend build**

Run: `npm run build:web`

- [ ] **Step 4: Restart production apps**

Run:
- `pm2 restart taikhoantenhat-api --update-env`
- `pm2 restart taikhoantenhat-web --update-env`

- [ ] **Step 5: Smoke check**

Run:
- `curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3200/api/v1/health`
- `curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3201/admin/orders`

Expected: both return `200`.
