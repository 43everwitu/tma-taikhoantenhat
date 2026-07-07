# Admin Stock Keys Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tối ưu trang `/admin/stock/keys` để quản trị được cả key đã bán, hiển thị order/customer và sửa/xóa từng key qua endpoint riêng.

**Architecture:** Backend mở rộng list response và thêm endpoint item-level `/admin/stock/items/:itemId` cho all-keys page. Endpoint cũ theo product giữ nguyên để không đổi trang kho theo sản phẩm. Frontend chuyển single edit từ inline input sang modal/drawer local trong page.

**Tech Stack:** Express, zod v4, better-sqlite3, Node test runner, Next 16 App Router, React Query.

---

## File Map

- Modify: `src/api/routes/admin/stock.js` - mở rộng query list, thêm item-level edit/delete.
- Create: `tests/api/admin-stock-items.test.js` - regression tests cho sold key list/edit/delete.
- Modify: `web/src/app/(admin)/admin/stock/keys/page.tsx` - UI compact, copy icon, edit modal, sold order/customer display.

## Task 1: Backend Regression Tests

- [ ] **Step 1: Create failing tests**

Create `tests/api/admin-stock-items.test.js` with route runner for `src/api/routes/admin/stock.js`. Seed two products, variants, user, delivered order, and sold stock.

Required assertions:

- `GET /admin/stock?sold=true&q=<stock value>` returns `soldOrder.id`, `soldOrder.paymentCode`, `soldCustomer.telegramId`, `soldCustomer.fullName`.
- `PATCH /admin/stock/items/:itemId` returns 200 for sold stock, updates `stock.data`, `stock.product_id`, `stock.variant_id`, `stock.duration_days`, and leaves `orders.delivered_keys_json` equal to the old value.
- `DELETE /admin/stock/items/:itemId` returns 200 for sold stock, removes stock row, and leaves `orders.delivered_keys_json` unchanged.

- [ ] **Step 2: Verify red**

Run:

```bash
node --test tests/api/admin-stock-items.test.js
```

Expected: fails because `/admin/stock/items/:itemId` is not implemented and list response lacks sold order/customer fields.

## Task 2: Backend Implementation

- [ ] **Step 1: Extend `GET /admin/stock`**

Add joins/subqueries to include sold customer and matched delivered order. Keep filters/pagination intact.

- [ ] **Step 2: Add `PATCH /admin/stock/items/:itemId`**

Validate content/product/variant/duration. Allow sold rows. Audit before/after. Publish stock changes for affected product ids. Do not touch `orders`.

- [ ] **Step 3: Add `DELETE /admin/stock/items/:itemId`**

Allow sold rows. Audit with sold metadata. Publish stock change. Do not touch `orders`.

- [ ] **Step 4: Verify green**

Run:

```bash
node --test tests/api/admin-stock-items.test.js
```

Expected: all tests pass.

## Task 3: Frontend UI

- [ ] **Step 1: Update row types**

Extend `KeyRow` with `soldOrder` and `soldCustomer`.

- [ ] **Step 2: Replace click-to-copy**

Render selectable key text and a separate copy icon button using `Copy` from `@/lib/icons`.

- [ ] **Step 3: Add edit modal/drawer**

Modal state stores current row and draft fields. Product select loads variants for draft product. Submit calls `PATCH /admin/stock/items/:itemId`.

- [ ] **Step 4: Enable sold single actions**

Remove `if (row.sold) return —` from row actions. Delete calls `/admin/stock/items/:itemId` and uses stronger confirm for sold keys. Keep bulk selection restricted to unsold rows.

- [ ] **Step 5: Compact table columns**

Group product/variant, status/time, and sold order/customer into readable cells. Keep mobile card rendering via existing `ResponsiveTable`.

- [ ] **Step 6: Verify build**

Run:

```bash
cd web && npm run build
```

Expected: build exits 0.

## Task 4: Final Verification

- [ ] **Step 1: API regression**

Run:

```bash
node --test tests/api/admin-stock-items.test.js
```

- [ ] **Step 2: Syntax checks**

Run:

```bash
node --check src/api/routes/admin/stock.js tests/api/admin-stock-items.test.js
```

- [ ] **Step 3: Diff hygiene**

Run:

```bash
git diff --check
git diff -- docs/superpowers/specs/2026-07-07-admin-stock-keys-optimization-design.md docs/superpowers/plans/2026-07-07-admin-stock-keys-optimization.md src/api/routes/admin/stock.js tests/api/admin-stock-items.test.js web/src/app/\(admin\)/admin/stock/keys/page.tsx
```

Expected: no whitespace errors; diff only contains scoped files.
