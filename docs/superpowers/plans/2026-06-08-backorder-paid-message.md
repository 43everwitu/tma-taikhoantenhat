# Backorder Paid Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chi hien thong bao cho xu ly thu cong trong TMA voi don hang co bien the backorder.

**Architecture:** Backend bo sung field `isBackorder` vao API `GET /customer/orders/:id/status` dua tren `orders.variant_id` va `product_variants.is_backorder`. Frontend miniapp dung field nay de doi noi dung card `paid` chi cho backorder, con don `paid` khac giu noi dung cu.

**Tech Stack:** Node.js, Express, SQLite, Next.js App Router, React client component, node:test.

---

### Task 1: API Order Status Backorder Flag

**Files:**
- Test: `tests/api/customer-order-status-backorder.test.js`
- Modify: `src/api/routes/customer.js`

- [ ] **Step 1: Write the failing test**

Them test mount router customer truc tiep, tao hai order `paid`: mot order co variant `is_backorder = 1`, mot order co variant `is_backorder = 0`. Goi `GET /customer/orders/:id/status` va assert `data.isBackorder` lan luot la `true` va `false`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/api/customer-order-status-backorder.test.js`

Expected: FAIL vi response hien tai chua co `data.isBackorder`.

- [ ] **Step 3: Write minimal implementation**

Trong `src/api/routes/customer.js`, sau khi lay `product`, truy van `product_variants.is_backorder` neu `order.variant_id` ton tai:

```js
  const variant = order.variant_id
    ? db.prepare('SELECT is_backorder FROM product_variants WHERE id = ?').get(order.variant_id)
    : null;
```

Them vao response:

```js
    isBackorder: !!variant?.is_backorder,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/api/customer-order-status-backorder.test.js`

Expected: PASS.

### Task 2: Miniapp Paid Card Copy

**Files:**
- Modify: `web/src/app/(miniapp)/don-hang/[id]/page.tsx`

- [ ] **Step 1: Update frontend type**

Them field `isBackorder?: boolean` vao interface `OrderStatus`.

- [ ] **Step 2: Render approved content only for backorder**

Trong block `order.status === 'paid'`, giu icon va card hien co. Neu `order.isBackorder` la `true`, hien:

```tsx
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
```

Neu `order.isBackorder` khong true, giu hai dong cu.

- [ ] **Step 3: Verify web code**

Run: `cd web && npm run lint`

Expected: PASS hoac chi bao loi san co khong lien quan den file vua sua.

### Task 3: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Re-run focused backend test**

Run: `node --test tests/api/customer-order-status-backorder.test.js`

Expected: PASS.

- [ ] **Step 2: Inspect changed files**

Run: `git diff -- src/api/routes/customer.js web/src/app/\\(miniapp\\)/don-hang/\\[id\\]/page.tsx tests/api/customer-order-status-backorder.test.js docs/superpowers/plans/2026-06-08-backorder-paid-message.md`

Expected: Chi co thay doi lien quan den flag backorder va noi dung card paid.
