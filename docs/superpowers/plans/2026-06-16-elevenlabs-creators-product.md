# ElevenLabs Creators Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved ElevenLabs Creators product, image asset, and one 30-day variant to the runtime catalog.

**Architecture:** This is a runtime data update, not an application code change. The generated product image is copied into `data/uploads/products-inline/`, then `data/shop.db` receives one `products` row and one `product_variants` row.

**Tech Stack:** SQLite via `sqlite3`, existing `products` and `product_variants` schema, static upload serving from `/uploads`.

---

### Task 1: Add Runtime Catalog Data

**Files:**
- Copy asset to: `data/uploads/products-inline/elevenlabs-creators-cover.png`
- Modify runtime DB only: `data/shop.db`

- [ ] **Step 1: Verify product does not already exist**

Run:

```bash
sqlite3 data/shop.db "SELECT id, name, slug FROM products WHERE slug='tai-khoan-elevenlabs-creators';"
```

Expected: no rows.

- [ ] **Step 2: Copy approved image into uploads**

Run:

```bash
cp /home/peanut/.codex/generated_images/019ec574-e903-7480-953b-c6a1895d42f1/ig_0f3b964f14c50897016a30e70844508191aec9f79eefeb71ba.png data/uploads/products-inline/elevenlabs-creators-cover.png
```

Expected: `data/uploads/products-inline/elevenlabs-creators-cover.png` exists.

- [ ] **Step 3: Insert product and variant**

Run a transaction that:

- Finds category `Tiện ích`.
- Inserts product `Tài khoản ElevenLabs Creators`.
- Inserts variant `ElevenLabs Creator 1 tháng - acc cấp sẵn dùng riêng có 100k credit`.
- Sets `default_duration_days = 30`.
- Leaves stock empty.

- [ ] **Step 4: Verify public API can resolve the product**

Run a small Express/public-router request to `GET /api/v1/products/tai-khoan-elevenlabs-creators`.

Expected:

- HTTP 200.
- Product name matches.
- One variant exists.
- Variant price is `279000`.
- Variant duration is `30`.
- Image URL is `/uploads/products-inline/elevenlabs-creators-cover.png`.

- [ ] **Step 5: Confirm no test stock was created**

Run:

```bash
sqlite3 data/shop.db "SELECT COUNT(*) FROM stock WHERE product_id = (SELECT id FROM products WHERE slug='tai-khoan-elevenlabs-creators');"
```

Expected: `0`.
