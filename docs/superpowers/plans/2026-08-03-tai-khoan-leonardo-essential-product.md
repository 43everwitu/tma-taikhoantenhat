# Tài khoản Leonardo Essential Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo sản phẩm Tài khoản Leonardo Essential 8.500 credit, giao thủ công với giá 79.000đ/tháng và ảnh cover đồng bộ cửa hàng.

**Architecture:** Dùng Sharp tạo ảnh WebP 900x900 từ logo thật và SVG layout cố định. Upsert trực tiếp vào runtime `data/shop.db` theo slug trong một transaction, sau đó kiểm tra cả dữ liệu nội bộ lẫn public shape bằng truy vấn chỉ đọc.

**Tech Stack:** Node.js 22, better-sqlite3, Sharp, SQLite, WebP.

## Global Constraints

- Runtime DB là `data/shop.db`; không dùng `data/db.sqlite`.
- Không gửi Telegram notification hoặc broadcast.
- Không stage hoặc commit `data/shop.db`, backup DB hoặc `data/uploads/`.
- Sản phẩm dùng `is_active=1`, `is_archived=0`, danh mục `Tiện ích`.
- Biến thể dùng `is_backorder=1`, `requires_input=0`, `default_duration_days=30`.
- Dòng `Định dạng tài khoản: Mail|Pass` chỉ xuất hiện trong hướng dẫn đăng nhập, không xuất hiện trong mô tả ngắn.
- Ảnh đầu ra là `data/uploads/products-inline/tai-khoan-leonardo-essential-cover-v1.webp`, đúng 900x900.

---

### Task 1: Tạo ảnh cover Leonardo Essential

**Files:**
- Create: `data/uploads/products-inline/tai-khoan-leonardo-essential-cover-v1.webp`
- Temporary: `/tmp/leonardo-ai-logo-source.jpg`
- Temporary: `/tmp/create-leonardo-essential-product.js`

**Interfaces:**
- Consumes: logo tại `https://www.bworldonline.com/wp-content/uploads/2024/07/Leonardo-AI-logo.jpg`.
- Produces: ảnh WebP 900x900 dùng tại URL `/uploads/products-inline/tai-khoan-leonardo-essential-cover-v1.webp`.

- [ ] **Step 1: Tải và kiểm tra logo nguồn**

Run:

```bash
curl -L --fail --silent --show-error \
  'https://www.bworldonline.com/wp-content/uploads/2024/07/Leonardo-AI-logo.jpg' \
  -o /tmp/leonardo-ai-logo-source.jpg
file /tmp/leonardo-ai-logo-source.jpg
```

Expected: file ảnh JPEG hợp lệ.

- [ ] **Step 2: Tạo cover bằng Sharp**

Tạo script tạm dùng SVG cho gradient xanh tím, tiêu đề `Tài khoản Leonardo Essential`, badge `8.500 CREDIT`, app tile chứa logo thật đã trim, dòng phụ `Tài khoản cấp sẵn`, footer `79K | 1 tháng` và watermark `taikhoantenhat.com`. Composite logo vào giữa tile rồi xuất WebP quality 90.

- [ ] **Step 3: Kiểm tra ảnh**

Run:

```bash
file data/uploads/products-inline/tai-khoan-leonardo-essential-cover-v1.webp
```

Expected: `Web/P image` với kích thước `900x900`.

Mở ảnh bằng `view_image` và xác nhận logo không crop, nội dung không tràn, độ tương phản đủ tốt trên mobile.

### Task 2: Upsert sản phẩm và biến thể

**Files:**
- Modify runtime data: `data/shop.db`
- Temporary: `/tmp/create-leonardo-essential-product.js`

**Interfaces:**
- Consumes: ảnh URL `/uploads/products-inline/tai-khoan-leonardo-essential-cover-v1.webp`.
- Produces: product slug `tai-khoan-leonardo-essential` và một biến thể active.

- [ ] **Step 1: Kiểm tra dữ liệu test trước khi ghi DB**

Run:

```bash
node scripts/purge-test-data.js
```

Expected: mọi target count bằng `0`.

- [ ] **Step 2: Upsert trong transaction**

Script phải:

1. Tìm category `Tiện ích`; chỉ tạo nếu chưa tồn tại.
2. Upsert product theo slug `tai-khoan-leonardo-essential` với giá `79000`, nội dung đã duyệt, ảnh versioned, `is_active=1`, `is_archived=0`, `contact_only=0`, `created_at` được giữ nguyên khi update và đặt `CURRENT_TIMESTAMP` khi insert.
3. Upsert biến thể `Leonardo Essential 8.500 Credit - 1 tháng` với giá `79000`, `sort_order=0`, `is_active=1`, `requires_input=0`, `is_backorder=1`, `default_duration_days=30`.
4. Ẩn các biến thể active khác của cùng sản phẩm.
5. Không tạo stock và không gọi notification service.

Nội dung hướng dẫn bắt buộc chứa:

```html
<p><strong>Định dạng tài khoản: Mail|Pass</strong></p>
```

- [ ] **Step 3: Chạy upsert hai lần**

Run:

```bash
node /tmp/create-leonardo-essential-product.js
node /tmp/create-leonardo-essential-product.js
```

Expected: cùng một product ID và variant ID ở cả hai lần, không tạo bản ghi trùng.

### Task 3: Xác minh và dọn tác vụ

**Files:**
- Verify: `data/shop.db`
- Verify: `data/uploads/products-inline/tai-khoan-leonardo-essential-cover-v1.webp`

**Interfaces:**
- Consumes: dữ liệu Task 1 và Task 2.
- Produces: bằng chứng sản phẩm sẵn sàng hiển thị trên cửa hàng.

- [ ] **Step 1: Kiểm tra product, variant và stock**

Truy vấn phải xác nhận:

```text
product.price = 79000
product.category = Tiện ích
product.image_url = /uploads/products-inline/tai-khoan-leonardo-essential-cover-v1.webp
product.is_active = 1
product.is_archived = 0
variant.price = 79000
variant.is_backorder = 1
variant.requires_input = 0
variant.default_duration_days = 30
stockCount = 0
```

- [ ] **Step 2: Kiểm tra public shape**

Expected:

```json
{
  "priceMin": 79000,
  "priceMax": 79000,
  "hasBackorder": true,
  "category": "Tiện ích"
}
```

Đồng thời xác nhận mô tả ngắn không chứa `Mail|Pass`, còn hướng dẫn đăng nhập có chứa chính xác chuỗi này.

- [ ] **Step 3: Chạy purge dry-run sau thay đổi**

Run:

```bash
node scripts/purge-test-data.js
```

Expected: mọi target count vẫn bằng `0`; không chạy `--apply` khi không có dữ liệu test.

- [ ] **Step 4: Kiểm tra Git hygiene**

Run:

```bash
git status --short -- data/shop.db data/uploads/products-inline/tai-khoan-leonardo-essential-cover-v1.webp
```

Expected: DB và ảnh không được stage. Không commit runtime artifact.
