# Miro Edu Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo sản phẩm `Tài khoản Miro Edu` trên TMA với 3 biến thể backorder, nội dung so sánh gói và ảnh 900x900 đúng style catalog hiện có.

**Architecture:** Không thay đổi code runtime. Thực thi bằng dữ liệu trong `data/shop.db` và một asset WebP mới trong `data/uploads/products-inline`; product trỏ tới asset này qua `image_url`. Verification đọc DB trực tiếp và kiểm tra public DTO bằng service/API hiện có nếu server khả dụng.

**Tech Stack:** Node.js, better-sqlite3, SQLite `data/shop.db`, Sharp cho ảnh WebP, HTML mô tả được sanitize theo product description renderer hiện có.

---

### Task 1: Tạo ảnh sản phẩm

**Files:**
- Create: `data/uploads/products-inline/miro-edu-cover-original.webp`

- [ ] **Step 1: Xác nhận Sharp khả dụng**

Run: `node -e "require('sharp'); console.log('sharp ok')"`
Expected: `sharp ok`

- [ ] **Step 2: Tạo ảnh 900x900 bằng SVG render qua Sharp**

Tạo asset có nền gradient đậm, tiêu đề `Tài khoản Miro Edu`, badge `EDU`, tile/logo Miro ở giữa và footer `12M | 24M | Vĩnh viễn`.

- [ ] **Step 3: Kiểm tra file ảnh**

Run: `file data/uploads/products-inline/miro-edu-cover-original.webp`
Expected: Web/P image, 900x900.

### Task 2: Upsert product và variants

**Files:**
- Modify runtime data only: `data/shop.db`

- [ ] **Step 1: Dry-run purge dữ liệu test theo quy định repo**

Run: `node scripts/purge-test-data.js`
Expected: in counts; nếu có target > 0 thì chạy `node scripts/purge-test-data.js --apply` trước khi tạo sản phẩm.

- [ ] **Step 2: Upsert category/product**

Tìm category `Học tập`; nếu chưa có thì tạo. Upsert product theo slug `tai-khoan-miro-edu`, active, featured, price `149000`, image `/uploads/products-inline/miro-edu-cover-original.webp`, không broadcast.

- [ ] **Step 3: Replace 3 variants**

Xóa variants cũ của product Miro Edu nếu có và tạo lại:

- `Miro Edu cấp riêng 12 tháng`, `149000`, `365`, `is_backorder=1`, `requires_input=0`
- `Miro Edu cấp riêng 24 tháng`, `249000`, `730`, `is_backorder=1`, `requires_input=0`
- `Miro Edu vĩnh viễn - bảo hành 3 năm`, `349000`, `1095`, `is_backorder=1`, `requires_input=0`

### Task 3: Verification

**Files:**
- Read-only checks against `data/shop.db` and generated image.

- [ ] **Step 1: Kiểm tra DB**

Run a Node query verifying product fields and variants.
Expected: category `Học tập`, featured active product, 3 variants, all backorder, no required input.

- [ ] **Step 2: Kiểm tra public product shape**

Use route/service query or direct SQL to verify `long_description`, `description`, `image_url`, and variants exist for slug `tai-khoan-miro-edu`.

- [ ] **Step 3: Chạy diff hygiene**

Run: `git status --short docs/superpowers/plans/2026-06-30-miro-edu-product.md data/uploads/products-inline/miro-edu-cover-original.webp data/shop.db`
Expected: plan file tracked/untracked as intended, image and DB modified locally; do not stage DB.
