# Admin Cancelled Order Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho phép admin đưa đơn đã hủy về trạng thái đang xử lý hoặc giao thủ công có dữ liệu giao hàng.

**Architecture:** `orderService` sở hữu chuyển trạng thái nguyên tử `cancelled → paid`. Route admin cung cấp endpoint restore riêng và mở rộng manual delivery cho đơn hủy; UI chỉ điều phối hai lựa chọn, không tự suy diễn lifecycle.

**Tech Stack:** Node.js 22, Express, better-sqlite3, Zod, Next.js 16, React 19, TanStack Query, Node test runner.

## Global Constraints

- Không thêm status DB mới; dùng `paid` cho **Đang xử lý**.
- Không cho đổi trực tiếp `cancelled → delivered` khi chưa nhập nội dung/key.
- Không gửi Telegram broadcast; manual delivery chỉ gửi đúng khách của đơn.
- Không ghi hoặc stage `data/shop.db`, backup DB, uploads hay artifact test.
- Giữ nguyên các thay đổi có sẵn trong working tree.

---

### Task 1: Lifecycle khôi phục đơn hủy

**Files:**
- Modify: `src/services/orderService.js`
- Create: `tests/services/orderCancelledRecovery.test.js`

**Interfaces:**
- Produces: `orderService.restoreCancelledToPaid(orderId)` trả `{ success, order?, error?, code? }`.
- Guarantees: chỉ cập nhật khi status hiện tại là `cancelled`; `paid_at` dùng `COALESCE`.

- [ ] **Step 1: Viết test thất bại**

Tạo fixture riêng và kiểm tra:

```js
const result = orderService.restoreCancelledToPaid(orderId);
assert.strictEqual(result.success, true);
assert.strictEqual(updated.status, 'paid');
assert.strictEqual(updated.paid_at, originalPaidAt);
```

Thêm case đơn `pending` bị từ chối và không đổi dữ liệu.

- [ ] **Step 2: Chạy test để xác nhận RED**

Run:

```bash
node --test tests/services/orderCancelledRecovery.test.js
```

Expected: FAIL vì `restoreCancelledToPaid` chưa tồn tại.

- [ ] **Step 3: Cài đặt tối thiểu**

Thêm transaction:

```js
UPDATE orders
SET status = 'paid',
    paid_at = COALESCE(paid_at, CURRENT_TIMESTAMP),
    delivered_at = NULL,
    delivered_keys_json = NULL
WHERE id = ? AND status = 'cancelled'
```

Phân biệt `NOT_FOUND` và `INVALID_STATE` khi không có row được cập nhật, sau đó
publish event `order.status`.

- [ ] **Step 4: Chạy test để xác nhận GREEN**

Run:

```bash
node --test tests/services/orderCancelledRecovery.test.js
```

Expected: PASS.

### Task 2: API restore và manual delivery

**Files:**
- Modify: `src/api/routes/admin/orders.js`
- Create: `tests/api/admin-orders-cancelled-recovery.test.js`

**Interfaces:**
- Consumes: `orderService.restoreCancelledToPaid(orderId)`.
- Produces: `POST /admin/orders/:id/restore` với body `{ status: 'paid' }`.
- Extends: `POST /admin/orders/:id/manual-deliver` nhận thêm status `cancelled`.

- [ ] **Step 1: Viết test API thất bại**

Kiểm tra restore thành công, restore đơn không phải `cancelled` trả `409`, và
manual delivery đơn `cancelled` lưu snapshot:

```js
assert.strictEqual(response.status, 200);
assert.deepStrictEqual(JSON.parse(updated.delivered_keys_json), ['manual-key']);
assert.strictEqual(updated.status, 'delivered');
```

- [ ] **Step 2: Chạy test để xác nhận RED**

Run:

```bash
node --test tests/api/admin-orders-cancelled-recovery.test.js
```

Expected: FAIL do route restore chưa tồn tại và manual delivery từ chối
`cancelled`.

- [ ] **Step 3: Cài đặt route**

Thêm Zod body chỉ chấp nhận `status: z.literal('paid')`, middleware
`requirePermission('orders.write')`, gọi service và ghi audit
`order.restore_status`.

Trong manual delivery, nếu đơn là `cancelled`, gọi restore service trước khi
chạy phần ghi delivered hiện có. Nếu khôi phục thất bại, trả `409`.

- [ ] **Step 4: Chạy test API**

Run:

```bash
node --test tests/api/admin-orders-cancelled-recovery.test.js tests/api/admin-orders-expired-confirm.test.js
```

Expected: PASS.

### Task 3: UI khôi phục trong admin/orders

**Files:**
- Modify: `web/src/app/(admin)/admin/orders/page.tsx`
- Create: `tests/web/adminCancelledOrderRecovery.test.mjs`

**Interfaces:**
- Consumes: `POST /admin/orders/:id/restore`.
- Reuses: state và modal giao thủ công hiện có qua `setManualOrderId`.

- [ ] **Step 1: Viết test source-contract thất bại**

Kiểm tra component có mutation restore, action cho `cancelled`, lựa chọn
`paid`, và nhánh delivered mở manual modal.

- [ ] **Step 2: Chạy test để xác nhận RED**

Run:

```bash
node --test tests/web/adminCancelledOrderRecovery.test.mjs
```

Expected: FAIL vì UI chưa có mutation/hộp chọn khôi phục.

- [ ] **Step 3: Cài đặt UI tối thiểu**

Thêm state đơn đang khôi phục, mutation restore, modal ba nút và action
**Khôi phục** cho row `cancelled`. Đổi label admin của `paid` thành
**Đang xử lý**.

- [ ] **Step 4: Chạy test và lint**

Run:

```bash
node --test tests/web/adminCancelledOrderRecovery.test.mjs
cd web && npx eslint 'src/app/(admin)/admin/orders/page.tsx'
```

Expected: PASS và ESLint không có lỗi.

### Task 4: Xác minh toàn bộ và dọn dữ liệu test

**Files:**
- Verify only.

**Interfaces:**
- Consumes: toàn bộ thay đổi từ Task 1-3.
- Produces: bằng chứng test/build và DB không còn fixture.

- [ ] **Step 1: Chạy test tập trung**

```bash
node --test \
  tests/services/orderCancelledRecovery.test.js \
  tests/api/admin-orders-cancelled-recovery.test.js \
  tests/api/admin-orders-expired-confirm.test.js \
  tests/web/adminCancelledOrderRecovery.test.mjs
```

- [ ] **Step 2: Chạy production build**

```bash
cd web && npm run build
```

- [ ] **Step 3: Chạy quy trình purge bắt buộc**

```bash
node scripts/purge-test-data.js
node scripts/purge-test-data.js --apply
```

Kiểm tra counts trước khi apply; không stage DB hoặc backup.

- [ ] **Step 4: Kiểm tra diff**

```bash
git diff --check
git status --short
```

Xác nhận chỉ các source/test/docs thuộc scope mới được xem là kết quả của task;
không hoàn tác các thay đổi tồn tại trước.
