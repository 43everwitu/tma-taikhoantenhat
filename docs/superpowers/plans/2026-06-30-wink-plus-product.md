# Wink+ Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo sản phẩm `Tài khoản Wink+` với 1 biến thể backorder, nội dung hướng dẫn đăng nhập và ảnh cover đúng style TMA.

**Architecture:** Không đổi code runtime. Tạo một asset WebP trong `data/uploads/products-inline` và upsert dữ liệu product/variant vào `data/shop.db`; product trỏ ảnh bằng URL version mới để tránh cache.

**Tech Stack:** Node.js, better-sqlite3, SQLite `data/shop.db`, Sharp để render WebP.

---

### Task 1: Tạo ảnh Wink+

**Files:**
- Create: `data/uploads/products-inline/wink-plus-cover-v1.webp`

- [ ] **Step 1: Tải logo Wink từ URL user cung cấp.**

Run: `curl -L -A 'Mozilla/5.0' -o /tmp/wink-plus/wink-source.png '<url>'`
Expected: WebP/PNG image có logo Wink.

- [ ] **Step 2: Render ảnh 900x900 bằng Sharp.**

Ảnh gồm nền gradient đậm, tiêu đề `Tài khoản Wink+`, badge `VIP+`, logo Wink ở giữa và footer `7 ngày | 100 credits | 1 thiết bị`.

- [ ] **Step 3: Verify ảnh.**

Run: `file data/uploads/products-inline/wink-plus-cover-v1.webp`
Expected: Web/P image, 900x900.

### Task 2: Upsert product và variant

**Files:**
- Modify runtime data only: `data/shop.db`

- [ ] **Step 1: Upsert product.**

Slug `tai-khoan-wink-plus`, category `Tiện ích`, price `25000`, image `/uploads/products-inline/wink-plus-cover-v1.webp`, active và featured.

- [ ] **Step 2: Upsert variant.**

Variant `Wink VIP+ 7 ngày - BHF 100 credits - 1 thiết bị`, price `25000`, `default_duration_days=7`, `is_backorder=1`, `requires_input=0`.

### Task 3: Verification

**Files:**
- Read-only checks against `data/shop.db` and generated image.

- [ ] **Step 1: Kiểm tra DB product/variant.**

Expected: product đúng category, image, price; variant đúng backorder/no input/duration.

- [ ] **Step 2: Kiểm tra purge dry-run.**

Run: `node scripts/purge-test-data.js`
Expected: target counts theo danh sách test bắt buộc không phát sinh.
