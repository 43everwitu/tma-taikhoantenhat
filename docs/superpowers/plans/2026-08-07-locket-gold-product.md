# Nâng cấp Locket Gold chính chủ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo sản phẩm nâng cấp Locket Gold chính chủ trên iOS, yêu cầu link hồ sơ Locket, giao thủ công với giá 179.000đ/12 tháng.

**Architecture:** Dùng Sharp tạo ảnh WebP 900x900 từ ảnh Locket Gold do người dùng cung cấp và SVG layout cố định. Upsert trực tiếp vào runtime `data/shop.db` theo slug trong một transaction, sau đó kiểm tra dữ liệu nội bộ và public API bằng truy vấn chỉ đọc.

**Tech Stack:** Node.js 22, better-sqlite3, Sharp, SQLite, WebP.

## Global Constraints

- Runtime DB là `data/shop.db`; không dùng `data/db.sqlite`.
- Không gửi Telegram notification hoặc broadcast.
- Không stage hoặc commit `data/shop.db`, backup DB hoặc `data/uploads/`.
- Sản phẩm dùng `is_active=1`, `is_archived=0`, danh mục `Giải trí`.
- Biến thể dùng `is_backorder=1`, `requires_input=1`, `default_duration_days=365`.
- Checkout chỉ yêu cầu link hồ sơ dạng `locket.cam/username`; không yêu cầu email, mật khẩu hoặc iCloud.
- Ảnh đầu ra hiện hành là `data/uploads/products-inline/nang-cap-locket-gold-chinh-chu-cover-v2.webp`, đúng 900x900 và có logo phủ gần toàn bộ chiều ngang tile.

---

### Task 1: Tạo ảnh cover Locket Gold

**Files:**
- Create: `data/uploads/products-inline/nang-cap-locket-gold-chinh-chu-cover-v2.webp`
- Temporary: `/tmp/locket-gold-source.jpg`
- Temporary: `/tmp/create-locket-gold-product.js`

**Interfaces:**
- Consumes: ảnh Locket Gold nguồn đã tải về `/tmp/locket-gold-source.jpg`.
- Produces: ảnh WebP 900x900 dùng tại URL `/uploads/products-inline/nang-cap-locket-gold-chinh-chu-cover-v2.webp`.

- [ ] **Step 1: Kiểm tra ảnh nguồn**

Run:

```bash
file /tmp/locket-gold-source.jpg
```

Expected: file ảnh JPEG hợp lệ, kích thước 800x418.

- [ ] **Step 2: Tạo cover bằng Sharp**

Tạo script tạm dùng SVG cho gradient vàng, tiêu đề `Nâng cấp Locket Gold`, badge `iOS`, app tile chứa ảnh thật đã trim, dòng phụ `Nâng cấp chính chủ`, footer `179K | 12 tháng` và watermark `taikhoantenhat.com`. Composite ảnh nguồn vào giữa tile theo chế độ `contain`, không crop, rồi xuất WebP quality 90.

- [ ] **Step 3: Kiểm tra ảnh**

Run:

```bash
file data/uploads/products-inline/nang-cap-locket-gold-chinh-chu-cover-v2.webp
```

Expected: `Web/P image` với kích thước `900x900`.

Mở ảnh bằng `view_image` và xác nhận hình không crop, nội dung không tràn, độ tương phản đủ tốt trên mobile.

### Task 2: Upsert sản phẩm và biến thể

**Files:**
- Modify runtime data: `data/shop.db`
- Temporary: `/tmp/create-locket-gold-product.js`

**Interfaces:**
- Consumes: ảnh URL `/uploads/products-inline/nang-cap-locket-gold-chinh-chu-cover-v2.webp`.
- Produces: product slug `nang-cap-locket-gold-chinh-chu` và một biến thể active.

- [ ] **Step 1: Kiểm tra dữ liệu test trước khi ghi DB**

Run:

```bash
node scripts/purge-test-data.js
```

Expected: mọi target count bằng `0`.

- [ ] **Step 2: Upsert trong transaction**

Script phải:

1. Tìm category `Giải trí`; chỉ tạo nếu chưa tồn tại.
2. Upsert product theo slug `nang-cap-locket-gold-chinh-chu` với giá `179000`, nội dung đã duyệt, ảnh versioned, `is_active=1`, `is_archived=0`, `contact_only=0`, giữ nguyên `created_at` khi update và dùng `CURRENT_TIMESTAMP` khi insert.
3. Upsert biến thể `Nâng cấp Locket Gold 12 tháng - iOS` với giá `179000`, `sort_order=0`, `is_active=1`, `requires_input=1`, `is_backorder=1`, `default_duration_days=365`.
4. Lưu một trường input bắt buộc có label `Link hồ sơ Locket`, placeholder `locket.cam/username` và kiểu `text`.
5. Ẩn các biến thể active khác của cùng sản phẩm.
6. Không tạo stock và không gọi notification service.

- [ ] **Step 3: Chạy upsert hai lần**

Run:

```bash
node /tmp/create-locket-gold-product.js
node /tmp/create-locket-gold-product.js
```

Expected: cùng một product ID và variant ID ở cả hai lần, không tạo bản ghi trùng.

### Task 3: Xác minh và dọn tác vụ

**Files:**
- Verify: `data/shop.db`
- Verify: `data/uploads/products-inline/nang-cap-locket-gold-chinh-chu-cover-v2.webp`

**Interfaces:**
- Consumes: dữ liệu Task 1 và Task 2.
- Produces: bằng chứng sản phẩm sẵn sàng hiển thị trên cửa hàng.

- [ ] **Step 1: Kiểm tra product, variant và stock**

Truy vấn phải xác nhận:

```text
product.price = 179000
product.category = Giải trí
product.image_url = /uploads/products-inline/nang-cap-locket-gold-chinh-chu-cover-v2.webp
product.is_active = 1
product.is_archived = 0
variant.price = 179000
variant.is_backorder = 1
variant.requires_input = 1
variant.default_duration_days = 365
variant.input_fields_json chứa locket.cam/username
stockCount = 0
```

- [ ] **Step 2: Kiểm tra public API**

Expected:

```json
{
  "priceMin": 179000,
  "priceMax": 179000,
  "hasBackorder": true,
  "category": "Giải trí"
}
```

Đồng thời xác nhận biến thể public yêu cầu customer input và hướng dẫn không yêu cầu email, mật khẩu hoặc iCloud.

- [ ] **Step 3: Chạy purge dry-run sau thay đổi**

Run:

```bash
node scripts/purge-test-data.js
```

Expected: mọi target count vẫn bằng `0`; không chạy `--apply` khi không có dữ liệu test.

- [ ] **Step 4: Kiểm tra Git hygiene**

Run:

```bash
git status --short -- data/shop.db data/uploads/products-inline/nang-cap-locket-gold-chinh-chu-cover-v2.webp
```

Expected: DB và ảnh không được stage. Không commit runtime artifact.
