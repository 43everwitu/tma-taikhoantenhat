# Admin Archive Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách sản phẩm đã xoá/archive khỏi danh sách sản phẩm đang quản lý, đồng thời giữ danh mục public click được trong TMA.

**Architecture:** Thêm cờ `products.is_archived` để phân biệt “tắt bán” với “đã xoá/archive”. API admin products mặc định trả sản phẩm chưa archive, có `?view=archived` cho tab lưu trữ; public API vẫn chỉ trả sản phẩm active chưa archive và category có slug hợp lệ.

**Tech Stack:** Express, better-sqlite3 migrations, Node test runner, Next.js admin UI, React Query.

---

### Task 1: Backend Archive Flag

**Files:**
- Create: `src/database/migrations/045_product_archive_flag.js`
- Modify: `src/api/routes/admin/products.js`
- Test: `tests/api/admin-products-archive-view.test.js`

- [ ] Write a failing test showing `GET /admin/products` hides archived products by default and `GET /admin/products?view=archived` returns them.
- [ ] Add `products.is_archived INTEGER DEFAULT 0` and index `(is_archived, is_active, sort_order)`.
- [ ] Update product delete/archive to set `is_archived = 1`.
- [ ] Update admin product list filtering for `active`, `archived`, and `all`.
- [ ] Run backend tests for archive and delete.

### Task 2: Public Safety

**Files:**
- Modify: `src/api/routes/public.js`
- Test: `tests/api/public-categories.test.js`

- [ ] Ensure public product/category queries only use products with `is_archived = 0`.
- [ ] Keep category output limited to categories with valid slug and at least one visible product.
- [ ] Run public category tests.

### Task 3: Admin Products UI Tabs

**Files:**
- Modify: `web/src/app/(admin)/admin/products/page.tsx`

- [ ] Change admin category dropdown source from `/categories` to `/admin/categories`.
- [ ] Add tabs `Đang hoạt động` and `Đã lưu trữ`.
- [ ] Include tab value in React Query key and `/admin/products?view=...`.
- [ ] Disable destructive/bulk reorder assumptions for archived rows where needed.
- [ ] Run `npm run build:web`.
