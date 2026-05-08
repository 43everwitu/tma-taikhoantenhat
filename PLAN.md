# Plan: Automated Key-Selling Platform (Webapp + Telegram Bot + Auto-Payment)

## Context

Current state: Starizzi Shop Bot (Node.js/Telegraf/SQLite) sells keys via Telegram with **manual** payment confirmation. MBBank API (Python/FastAPI) can poll bank transactions but isn't connected to the bot. No web interface exists.

**Goal**: Unified platform with auto-payment detection, customer webapp, admin dashboard, and real-time sync between Telegram bot and website.

---

## Architecture Overview

```
┌─────────────────────────────────────────┐
│          CUSTOMER TOUCHPOINTS           │
│   Telegram Bot        Customer Webapp   │
│   (Telegraf)          (Next.js)         │
└────────┬──────────────────┬─────────────┘
         │                  │
         ▼                  ▼
┌─────────────────────────────────────────┐
│      SINGLE NODE.JS PROCESS (:3000)     │
│                                         │
│  Express REST API                       │
│  Telegraf Bot (long-poll)               │
│  PaymentPoller (30s interval)           │
│  NotificationService (EventEmitter)     │
│  Google Sheet Sync                      │
└────────┬──────────────────┬─────────────┘
         │                  │
    ┌────▼────┐      ┌─────▼──────┐
    │ SQLite  │      │ MBBank API │
    │  (WAL)  │      │ (Python    │
    │ shop.db │      │  :8000)    │
    └─────────┘      └────────────┘
```

**Key decision**: Express + Telegraf in **single Node.js process**. Shared DB, no IPC, payment poller has direct access to `bot.telegram.sendMessage()`. Express already in `package.json` but unused — activate it.

---

## Tech Stack

| Layer | Choice | Why |
|-------|--------|-----|
| Backend API | Express (existing dep) | Already in package.json, co-hosts with Telegraf |
| Telegram | Telegraf 4.x (existing) | Keep as-is |
| Database | SQLite + WAL (existing) | Sufficient scale, zero infra cost |
| Webapp | Next.js 14 App Router | SEO for product pages + SPA for admin |
| UI | Tailwind CSS + shadcn/ui | Zero runtime cost, pre-built components |
| Data fetching | TanStack Query v5 | Polling, caching, mutations for dashboard |
| Charts | Recharts | Lightweight, React-native |
| Auth | JWT (jose) + bcrypt | Self-hosted, budget-conscious |
| Forms | React Hook Form + Zod | Validated forms |
| Payment | MBBank API (existing) | Polling-based, no changes needed |

---

## Database Schema Evolution

Keep SQLite. Add tables + columns via migration system.

### New Tables

```sql
-- Admin accounts (multi-admin support)
admins (id, telegram_id, username, password_hash, display_name, role, is_active, last_login_at, created_at)

-- Payment detection log
transactions (id, mb_transaction_number UNIQUE, amount, description, matched_order_id, matched_payment_code, match_status, raw_data, detected_at)

-- Multi-channel notifications
notifications (id, user_id, type, title, body, data JSON, is_read, channel, sent_telegram, sent_web, created_at)

-- Stock follow system
product_follows (id, user_id, product_id, created_at, UNIQUE(user_id, product_id))

-- Admin announcements
announcements (id, title, body, admin_id, is_pinned, target, sent_count, failed_count, created_at)

-- Admin action tracking
audit_log (id, admin_id, action, entity_type, entity_id, details JSON, ip_address, created_at)

-- Runtime settings
settings (key PK, value, updated_at)
```

### Evolved Existing Tables

```sql
-- users: + email, web_token, notification_prefs JSON, updated_at
-- categories: + slug UNIQUE, description, is_active, created_at
-- products: + slug UNIQUE, image_url, long_description, low_stock_threshold, sort_order, created_at, updated_at
-- stock: + added_by, added_at
-- orders: + source ('telegram'|'web'), bank_name, payment_matched_at, auto_confirmed, notes, expires_at
```

### Critical Fix: Race Condition

Wrap `confirmAndDeliver` in `db.transaction()` (better-sqlite3's `BEGIN IMMEDIATE`):

```javascript
// src/services/orderService.js:72 — currently NOT atomic
confirmAndDeliver: db.transaction(function(orderId) {
  // SELECT stock + UPDATE stock + UPDATE order all in one transaction
  // Prevents double-selling under concurrent orders
})
```

### Migration System

```
src/database/
  index.js              — exports db instance
  migrations/
    runner.js           — checks `migrations` table, runs pending
    001_initial.js      — existing schema (already applied)
    002_platform.js     — all new tables/columns above
```

---

## Auto-Payment Flow (Core Feature)

### Payment Poller (`src/services/paymentPoller.js`) — Event-Driven, Not Continuous

**Key design**: Poller is **dormant by default**. Only activates when pending orders exist. Stops when all orders resolved/expired. Saves MBBank API calls.

```
ON ORDER CREATED:
  1. Insert order with expires_at = NOW + 5 MINUTES
  2. Call paymentPoller.ensureRunning()
     → If poller already running: do nothing (new order will be picked up on next cycle)
     → If poller stopped: start 15-second interval loop

POLLER LOOP (every 15s while active):
  1. SELECT all pending orders (status = 'pending' AND expires_at > NOW)
     → If 0 pending orders: STOP poller, return (go dormant)

  2. POST http://localhost:8000/transactions/credit
     Body: {
       description_contains: "NAP PAY-",
       from_date: today,
       to_date: today,
       min_amount: MIN(all pending order amounts),
       limit: 100,
       sort_order: "desc"
     }
     Header: Authorization: Bearer <MBBANK_API_TOKEN>
     *** ONE API call checks ALL pending orders ***

  3. Build lookup map: { paymentCode → pendingOrder } from all pending orders

  4. For each transaction in response:
     a. Skip if mb_transaction_number already in transactions table
     b. Extract payment code via regex: /NAP PAY-[A-Z0-9]{6}/
     c. Look up in map → if no match: insert as 'unmatched', continue
     d. Verify amount >= order.total_price
     e. BEGIN TRANSACTION (SQLite):
        - Insert into transactions (matched)
        - If real stock exists → confirmAndDeliver() → auto-deliver keys
        - If contact-only/sheet_stock → mark 'paid', notify admin
        COMMIT
     f. Notify customer (Telegram + web notification)
     g. Remove from pending map

  5. Expire stale orders:
     UPDATE orders SET status = 'expired'
     WHERE status = 'pending' AND expires_at <= NOW
     → Notify expired order customers

  6. If no more pending orders after step 5 → STOP poller (go dormant)

LIFECYCLE:
  Order created    → ensureRunning() → poller wakes up
  All orders done  → poller goes dormant (no API calls)
  New order while poller running → automatically included in next cycle
  Server restart   → check pending orders on startup, start poller if any exist
```

### Smart Batching Benefits
- **0 pending orders = 0 API calls** (poller dormant)
- **10 simultaneous orders = still 1 API call per 15s** (batch check)
- **5-minute expiry** keeps pending window tight, reduces stale orders
- MBBank API rate limit (60/min) never hit — max 4 calls/min during active period

### Customer "Đã thanh toán" Button

Triggers **on-demand check** for that specific payment code (calls single-order match function). Also calls `ensureRunning()` to wake poller if dormant. Instant feedback without waiting for next 15s cycle.

---

## Customer Purchase Flow

### Via Telegram (existing, enhanced)
```
/product → tap product → tap qty → [choose bank] → QR + payment code
→ AUTOMATIC: poller detects in 30-60s → delivery message with keys
```

### Via Web (new)
```
/san-pham → click product → /san-pham/[slug] → "Mua ngay" → qty modal
→ link Telegram ID (or skip) → /thanh-toan/[orderId] → QR + countdown
→ page polls GET /api/v1/orders/:id/status every 5s
→ status = 'delivered' → show keys on page (+ Telegram if linked)
```

### Account Linking (Web ↔ Telegram)
1. Customer enters Telegram ID on web
2. API sends 6-digit code to that Telegram ID via bot
3. Customer enters code on web → JWT issued → httpOnly cookie
4. Web-only customers (no Telegram) can still purchase — delivery shown on payment page

---

## Admin Dashboard

### Routes

```
/admin/dashboard        — stats cards, revenue chart, recent orders, alerts
/admin/orders           — filterable table, bulk confirm/cancel, CSV export
/admin/products         — CRUD table, inline edit, toggle active, low stock badges
/admin/categories       — CRUD
/admin/stock/[productId]— view/add/clear stock, bulk import from textarea/file
/admin/users            — user list + detail with order history
/admin/transactions     — MBBank transaction log (matched/unmatched)
/admin/announcements    — create/send to Telegram+web, history with sent/failed counts
/admin/settings         — shop name, payment timeout, poller interval, thresholds
/admin/audit-log        — admin action history
```

### Dashboard Features
- **Stats cards**: Revenue (today/week/month), pending orders, total stock, active users
- **Revenue chart**: Last 30 days (Recharts line chart)
- **Low stock alerts**: Red badges when stock <= threshold
- **Unmatched transactions**: Alert for bank transfers that don't match any order
- **Real-time**: TanStack Query polls orders every 10s, other pages every 30s

---

## REST API Design

### Base: `/api/v1`

**Public (no auth)**:
- `GET /categories` — active categories
- `GET /products` — active products with stock counts
- `GET /products/:slug` — product detail
- `GET /shop/info` — shop name, support contact
- `GET /announcements` — pinned announcements

**Customer (customer JWT)**:
- `POST /auth/link-telegram` — sends verification code
- `POST /auth/verify-code` — returns JWT
- `POST /orders` — create order `{ productId, quantity, bankIndex? }`
- `GET /orders/:id/status` — polled by payment page
- `GET /orders/my` — order history
- `POST /products/:id/follow` — follow for stock alerts
- `DELETE /products/:id/follow` — unfollow
- `GET /notifications/my` — customer notifications
- `PATCH /notifications/:id/read` — mark read

**Admin (admin JWT)**:
- `POST /auth/login` — `{ username, password }` → JWT
- `GET /admin/dashboard/stats` — aggregated stats
- `GET /admin/dashboard/revenue?period=30d` — chart data
- Orders: `GET/POST confirm/cancel/manual-deliver/export`
- Products: full CRUD + toggle
- Categories: full CRUD
- Stock: `GET/POST/DELETE` per product
- Users: `GET` list + detail
- Transactions: `GET` log
- Announcements: `GET/POST/DELETE`
- Settings: `GET/PUT`
- Audit: `GET` log
- Poller: `GET status`, `POST trigger` (force poll)

### Response Format

```json
{ "success": true, "data": {}, "meta": { "page": 1, "limit": 20, "total": 150 } }
```

---

## Notification System

### `src/services/notificationService.js`

| Type | Trigger | Recipients | Channels |
|------|---------|-----------|----------|
| `stock_alert` | Stock added for followed product | Followers | Telegram + web |
| `renewal` | Stock <= low_stock_threshold (check every 5min) | Admins only | Telegram + web dashboard |
| `announcement` | Admin creates broadcast | All users | Telegram (25/sec rate limit) + web |
| `order_update` | Any status change | Order customer | Telegram + web |

---

## Sync Architecture

**No sync problem** — bot + API run in same process, share same `db` instance. Both read/write through same SQLite connection.

| Event | Source | Sync |
|-------|--------|------|
| Order via web | API Server | Bot sees it on next DB read. Admin notified via Telegram. |
| Order via Telegram | Bot handler | Dashboard sees it on next poll (10s). |
| Payment detected | Poller | Updates DB → Telegram msg + web notification insert |
| Stock added via dashboard | API | Bot product queries see updated count |
| Stock added via /addstock | Bot | Web pages see it on next request |

Web "real-time" via TanStack Query polling. WebSocket upgrade deferred to future if needed.

---

## File Structure

```
telegram-shop-bot/
├── package.json                     # Root: bot + api deps
├── .env / .env.example
├── data/shop.db                     # SQLite (gitignored)
│
├── mbbank-api/                      # UNCHANGED — Python FastAPI
│
├── src/                             # Node.js: Bot + API (single process)
│   ├── index.js                     # NEW entry point: Express + Bot + Poller
│   ├── config.js                    # EVOLVED: +MBBANK_API_URL, JWT_SECRET, etc.
│   │
│   ├── database/
│   │   ├── index.js                 # Moved from src/database.js
│   │   └── migrations/
│   │       ├── runner.js
│   │       ├── 001_initial.js
│   │       └── 002_platform.js
│   │
│   ├── api/                         # NEW: Express REST API
│   │   ├── server.js                # Express setup, middleware, route mounting
│   │   ├── middleware/
│   │   │   ├── auth.js              # JWT verification
│   │   │   ├── rateLimit.js         # express-rate-limit
│   │   │   ├── validate.js          # Zod validation
│   │   │   └── audit.js             # Audit log middleware
│   │   └── routes/
│   │       ├── public.js
│   │       ├── auth.js
│   │       ├── customer.js
│   │       └── admin/
│   │           ├── index.js
│   │           ├── dashboard.js
│   │           ├── orders.js
│   │           ├── products.js
│   │           ├── categories.js
│   │           ├── stock.js
│   │           ├── users.js
│   │           ├── transactions.js
│   │           ├── announcements.js
│   │           ├── settings.js
│   │           ├── sync.js
│   │           ├── audit.js
│   │           └── poller.js
│   │
│   ├── bot/                         # REORGANIZED from src/commands + src/handlers
│   │   ├── index.js                 # Bot setup + handler registration
│   │   ├── commands/                # Existing 7 + new /follow
│   │   └── handlers/                # Existing 4, evolved
│   │
│   ├── services/                    # SHARED between bot + API
│   │   ├── orderService.js          # EVOLVED: +transaction wrapping, +source tracking
│   │   ├── paymentService.js        # EXISTING (unchanged)
│   │   ├── productService.js        # EVOLVED: +slug, +follow checks
│   │   ├── userService.js           # EVOLVED: +web token, +linking
│   │   ├── sheetSync.js             # EXISTING (unchanged)
│   │   ├── paymentPoller.js         # NEW: polls MBBank, auto-delivers
│   │   ├── notificationService.js   # NEW: multi-channel dispatch
│   │   ├── authService.js           # NEW: JWT + bcrypt
│   │   ├── statsService.js          # NEW: dashboard queries
│   │   └── auditService.js          # NEW: audit log
│   │
│   └── utils/
│       ├── keyboard.js              # EXISTING
│       ├── messages.js              # EXISTING
│       ├── slugify.js               # NEW: Vietnamese-aware slugs
│       └── csv.js                   # NEW: CSV export
│
└── web/                             # NEW: Next.js webapp + admin dashboard
    ├── package.json
    ├── next.config.js
    ├── tailwind.config.js
    ├── src/
    │   ├── app/
    │   │   ├── layout.tsx
    │   │   ├── page.tsx             # Home: hero + featured products
    │   │   ├── san-pham/            # Product catalog + detail
    │   │   ├── thanh-toan/[orderId] # Payment QR + polling
    │   │   ├── don-hang/            # Customer order history
    │   │   ├── lien-ket/            # Telegram linking
    │   │   ├── thong-bao/           # Customer notifications
    │   │   └── admin/               # Full admin dashboard (all routes above)
    │   ├── components/
    │   │   ├── ui/                  # shadcn/ui
    │   │   ├── layout/              # Header, Footer, AdminSidebar
    │   │   ├── products/            # ProductCard, ProductGrid
    │   │   ├── orders/              # PaymentQR, OrderStatus, CountdownTimer
    │   │   └── admin/               # StatsCard, RevenueChart, OrderTable, etc.
    │   ├── lib/
    │   │   ├── api.ts               # Fetch wrapper with auth
    │   │   ├── auth.ts              # Client auth utils
    │   │   └── utils.ts             # formatPrice, formatDate
    │   └── hooks/                   # TanStack Query hooks
```

---

## Implementation Phases

### Phase 1: Foundation (Backend Core) — Highest value first
1. Database migration system (`src/database/migrations/`)
2. Restructure entry point → `src/index.js` (Express + Telegraf + Poller in one process)
3. **Payment Poller** — poll MBBank API, match payment codes, auto-deliver
4. Fix `confirmAndDeliver` race condition with `db.transaction()`
5. Order expiration (5 min timeout)

### Phase 2: API Layer
6. Auth service (admin JWT + customer Telegram linking)
7. Admin API routes (all CRUD endpoints)
8. Public + Customer API routes
9. Notification service (stock alerts, announcements, order updates)

### Phase 3: Customer Webapp
10. Next.js project setup (Tailwind + shadcn/ui)
11. Product catalog pages (`/san-pham`, `/san-pham/[slug]`) — SEO
12. Purchase flow (`/thanh-toan/[orderId]`) — QR + polling + delivery display
13. Account linking (`/lien-ket`)

### Phase 4: Admin Dashboard
14. Admin login + layout (sidebar + topbar)
15. Dashboard overview (stats + charts)
16. Orders management (filter, confirm, cancel, export)
17. Products + Categories CRUD
18. Stock management (bulk import)
19. Announcements (create + broadcast)
20. Settings + Audit log

### Phase 5: Polish
21. Product follow system (`/follow` command + web button)
22. Low stock renewal reminders (periodic check → admin alert)
23. Customer order history on web
24. Transaction log on dashboard
25. Multi-admin roles (nice-to-have)

---

## Security

- **Admin JWT**: 24h expiry, httpOnly/Secure/SameSite=Strict cookie, `jose` library
- **Customer JWT**: 30d expiry, httpOnly cookie, contains only `telegramId`
- **Rate limiting**: express-rate-limit (100/min public, 30/min customer, 10/min auth)
- **Input validation**: Zod schemas on all API inputs
- **SQL injection**: better-sqlite3 prepared statements throughout
- **XSS**: React escapes by default, `sanitize-html` for admin announcements
- **CORS**: Strict — only webapp origin allowed
- **Stock encryption**: AES-256-GCM at rest (Phase 5 enhancement)
- **Audit trail**: All admin actions logged with IP, admin ID, timestamp

---

## New .env Variables

```env
# Add to existing .env
MBBANK_API_URL=http://localhost:8000
MBBANK_API_TOKEN=your_mbbank_api_bearer_token
PAYMENT_POLL_INTERVAL=15000
PAYMENT_POLL_ENABLED=true
JWT_SECRET=random-64-char-string
ADMIN_INITIAL_PASSWORD=change-on-first-login
WEB_URL=http://localhost:3001
API_PORT=3000
```

---

## Verification Plan

1. **Auto-payment**: Create order via Telegram → transfer money → verify poller detects within 60s → keys auto-delivered
2. **Web purchase**: Browse `/san-pham` → buy → QR page → transfer → page shows keys
3. **Dashboard**: Login → verify stats match DB → CRUD products → add stock → verify bot reflects changes
4. **Notifications**: Add stock to followed product → verify follower gets Telegram msg + web notification
5. **Announcement**: Create broadcast → verify all users receive Telegram msg
6. **Race condition**: Simulate 2 concurrent orders for last stock item → verify only 1 succeeds
7. **Expiration**: Create order → wait 5 min → verify status = 'expired'
8. **Poller lifecycle**: No pending orders → verify 0 MBBank API calls. Place order → verify poller starts. All resolved → verify poller stops.

---

## Critical Files to Modify

| File | Change |
|------|--------|
| `src/services/orderService.js` | Wrap in `db.transaction()`, add source tracking |
| `src/database.js` → `src/database/index.js` | Refactor into migration system |
| `src/bot.js` → `src/index.js` | Co-host Express + Telegraf + Poller |
| `src/handlers/paymentConfirm.js` | "Đã thanh toán" triggers on-demand check |
| `src/services/productService.js` | Add slug generation, follow queries |
| `src/services/userService.js` | Add web token, linking methods |
| `package.json` | Add new deps: jose, bcrypt, zod, cors, express-rate-limit, sanitize-html |
