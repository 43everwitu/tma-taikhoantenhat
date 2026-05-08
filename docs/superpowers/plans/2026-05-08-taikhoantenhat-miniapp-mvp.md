# Taikhoantenhat — Mini App MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the customer-facing Telegram Mini App MVP — Vietnamese, mobile-first, served from the `(miniapp)` route group — covering: home (announcements + category tiles), catalog (search + category filter + sort), product detail, cart, checkout (creates order + renders VietQR), and order-status page (SSE-driven, shows delivered keys when paid). Authentication is via Telegram WebApp `initData` (HMAC-SHA-256 verify against `BOT_TOKEN`), exchanged for the existing customer JWT so the existing `/api/v1/*` routes can be reused unchanged.

**Architecture:** Next.js 16 App Router with the `(miniapp)` group owning `/`, `/danh-muc/[slug]`, `/san-pham/[slug]`, `/gio-hang`, `/dat-hang`, `/don-hang/[id]`. A small client-side auth bootstrap reads `window.Telegram.WebApp.initData`, posts it to a new `POST /api/v1/auth/miniapp` endpoint, receives a customer JWT, and stores it in memory + a HTTP-only cookie. All product/order calls reuse the existing public + customer routes (`GET /products`, `POST /orders`, `GET /orders/:id/status`, `GET /events` for SSE). State managed by TanStack Query (already installed); cart kept in `localStorage`. Telegram theme params drive a CSS variable bridge so the UI follows the user's Telegram light/dark theme automatically.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript (strict), TanStack Query, Tailwind CSS 4 (already in `web/`), Telegram WebApp JS SDK (loaded from `https://telegram.org/js/telegram-web-app.js?57` script tag), Node `node:test` for backend unit tests, Vitest is **not** added — backend tests use the existing `node --test` runner.

---

## Conventions for this plan

- **Repo root:** `/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/`. All paths below are relative.
- **URLs are Vietnamese.** `/danh-muc/...` (category), `/san-pham/...` (product), `/gio-hang` (cart), `/dat-hang` (checkout), `/don-hang/...` (order). The legacy `web/src/app/san-pham/` directory exists from the parent project and conflicts with the new `(miniapp)/san-pham/` route. Task 4 deletes the legacy one.
- **All user-visible strings are Vietnamese**, sourced through `messageTemplateService` if they are notification-style, or written inline if they are pure UI labels (e.g. "Giỏ hàng"). Inline strings live in `web/src/i18n/vi.ts` so a future localization split is mechanical.
- **Currency:** integer VND, formatted `1.234.567 ₫` via the existing `formatPrice` in `web/src/lib/utils.ts` (verify it produces the right format; adjust in Task 11 if not).
- **Dates:** `DD/MM/YYYY HH:mm` via `Intl.DateTimeFormat('vi-VN', ...)`.
- **Telegram WebApp SDK access:** always through the `useWebApp()` hook (Task 5) so SSR and tests don't crash on missing `window.Telegram`.
- Commit messages in English imperative mood.
- After every task: commit, even when the task is a single small change. Checkpoints make subagent dispatch safe.

---

## File map (what gets touched)

### Backend (Node)
- Create: `src/utils/initData.js` — verify Telegram initData HMAC
- Create: `tests/utils/initData.test.js`
- Modify: `src/api/routes/auth.js` — add `POST /auth/miniapp`
- Create: `tests/api/auth-miniapp.test.js`
- Modify: `src/services/userService.js` — `findOrCreateFromInitData(user)` helper used by the new endpoint
- Modify: `src/api/routes/events.js` — add `?orderId=` query support so the Mini App can scope its stream

### Frontend (Next.js)
- Create: `web/src/lib/telegram.ts` — typed Telegram WebApp wrapper + `useWebApp()` hook
- Create: `web/src/lib/miniappAuth.ts` — initData → JWT exchange + token store
- Create: `web/src/lib/miniappApi.ts` — `fetch` wrapper that auto-injects the bearer token
- Create: `web/src/lib/cart.ts` — local-storage-backed cart store + React hook
- Create: `web/src/i18n/vi.ts` — Vietnamese UI string table
- Create: `web/src/app/(miniapp)/layout.tsx` — replaces the placeholder from sub-project #1: theme bridge, viewport, font, query provider, auth bootstrap
- Modify (replace placeholder): `web/src/app/(miniapp)/page.tsx` — Home (announcements + categories)
- Create: `web/src/app/(miniapp)/danh-muc/[slug]/page.tsx` — category catalog
- Create: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx` — product detail
- Create: `web/src/app/(miniapp)/gio-hang/page.tsx` — cart
- Create: `web/src/app/(miniapp)/dat-hang/page.tsx` — checkout
- Create: `web/src/app/(miniapp)/don-hang/[id]/page.tsx` — order status (SSE)
- Create: `web/src/app/(miniapp)/components/MiniAppShell.tsx` — header + nav + theme variables
- Create: `web/src/app/(miniapp)/components/ProductCard.tsx`
- Create: `web/src/app/(miniapp)/components/QrPanel.tsx`
- Create: `web/src/app/(miniapp)/components/CartButton.tsx`
- Modify: `web/src/app/layout.tsx` — load Telegram WebApp script via `next/script` with `strategy="beforeInteractive"`
- Modify: `web/src/app/providers.tsx` — branch on Mini App route to skip the global AnnouncementBar (the Mini App renders its own)

### Files deleted
- `web/src/app/san-pham/page.tsx`
- `web/src/app/san-pham/[slug]/page.tsx`

These conflict with the new Mini App routes and belong to the legacy public storefront (deleted in sub-project #8 anyway).

### Files NOT touched
- The `(admin)` group is untouched.
- Existing API routes (`/api/v1/products`, `/orders`, etc.) are untouched. The new endpoint is additive.

---

## Pre-flight

1. Sub-project #1 is complete (tag `v0-fork-foundation`). Required.
2. Sub-project #2 is complete (tag `v0.2-wp-migration`). Recommended — without it, the catalog is empty and you can only smoke-test against seed rows. The plan still works; the screens will just look bare.
3. `BOT_TOKEN` is set in `.env`. Required for initData verify.

---

## Task 1: initData verify util + test

**Files:**
- Create: `src/utils/initData.js`
- Create: `tests/utils/initData.test.js`

Telegram signs `initData` with HMAC-SHA-256 using `secret = HMAC-SHA-256("WebAppData", BOT_TOKEN)` over the sorted, key-joined-by-`\n` payload (excluding the `hash` field). Reject if the computed hash doesn't match, or if `auth_date` is older than 24 hours.

- [ ] **Step 1: Write the failing test**

Create `tests/utils/initData.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { verifyInitData } = require('../../src/utils/initData');

const BOT_TOKEN = '123456:fake-bot-token-for-tests';

function signInitData(params) {
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const dataCheck = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('\n');
  const hash = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  const url = new URLSearchParams({ ...params, hash });
  return url.toString();
}

test('verifies a freshly signed initData', () => {
  const params = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 555, first_name: 'Khoa', username: 'khoa', language_code: 'vi' }),
    query_id: 'abc',
  };
  const initData = signInitData(params);
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.user.id, 555);
  assert.strictEqual(result.user.username, 'khoa');
});

test('rejects when hash is wrong', () => {
  const initData = 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=deadbeef';
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'BAD_HASH');
});

test('rejects when older than 24h', () => {
  const params = {
    auth_date: String(Math.floor(Date.now() / 1000) - 25 * 3600),
    user: JSON.stringify({ id: 1 }),
  };
  const initData = signInitData(params);
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'EXPIRED');
});

test('rejects when user field is missing', () => {
  const params = { auth_date: String(Math.floor(Date.now() / 1000)) };
  const initData = signInitData(params);
  const result = verifyInitData(initData, BOT_TOKEN);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'NO_USER');
});
```

- [ ] **Step 2: Run to fail**

```bash
node --test tests/utils/initData.test.js
```

Expected: failure with `Cannot find module '../../src/utils/initData'`.

- [ ] **Step 3: Implement the verifier**

Create `src/utils/initData.js`:

```js
const crypto = require('node:crypto');

const MAX_AGE_SECONDS = 24 * 3600;

/**
 * Verify a Telegram WebApp initData query string.
 * Returns { ok: true, user, authDate } on success, or { ok: false, reason } on failure.
 *
 * Reasons: 'EMPTY', 'BAD_HASH', 'EXPIRED', 'NO_USER', 'NO_AUTH_DATE'.
 */
function verifyInitData(initData, botToken) {
  if (!initData) return { ok: false, reason: 'EMPTY' };
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'BAD_HASH' };
  params.delete('hash');

  // Build data-check-string: sort keys, join "key=value" with newlines.
  const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = sorted.map(([k, v]) => `${k}=${v}`).join('\n');

  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!timingSafeEqualHex(computed, hash)) return { ok: false, reason: 'BAD_HASH' };

  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) return { ok: false, reason: 'NO_AUTH_DATE' };
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) return { ok: false, reason: 'NO_AUTH_DATE' };
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > MAX_AGE_SECONDS) return { ok: false, reason: 'EXPIRED' };

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, reason: 'NO_USER' };
  let user;
  try { user = JSON.parse(userRaw); } catch { return { ok: false, reason: 'NO_USER' }; }
  if (!user || typeof user.id !== 'number') return { ok: false, reason: 'NO_USER' };

  return { ok: true, user, authDate };
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

module.exports = { verifyInitData };
```

- [ ] **Step 4: Run to pass**

```bash
node --test tests/utils/initData.test.js
```

Expected: 4 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/utils/initData.js tests/utils/initData.test.js
git commit -m "feat(api): verify Telegram WebApp initData (HMAC + 24h age)"
```

---

## Task 2: User upsert helper from initData

**Files:**
- Modify: `src/services/userService.js`

The Mini App's first contact may be a brand-new Telegram user who never sent `/start`. We need to insert a `users` row for them on the first authenticated call so balance, orders, and notifications all work.

- [ ] **Step 1: Inspect the existing userService**

```bash
cat src/services/userService.js
```

Note the existing `findOrCreate(ctxFrom)` signature — Telegraf's `ctx.from` shape with `id`, `first_name`, `last_name`, `username`. The Mini App's user object is identical except keys are JSON-style (`first_name` not `firstName`). Reuse `findOrCreate` as-is.

- [ ] **Step 2: Add a thin alias method for clarity**

Append to the exported object in `src/services/userService.js`:

```js
findOrCreateFromInitData(user) {
  // Mini App initData.user matches the Telegraf ctx.from shape.
  return this.findOrCreate({
    id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    username: user.username,
  });
},
```

If the existing module shape uses `module.exports = userService` with method properties, fit the new method into that style. If it uses arrow functions on the object literal, match that.

- [ ] **Step 3: Commit**

```bash
git add src/services/userService.js
git commit -m "feat(user): findOrCreateFromInitData alias for Mini App auth"
```

---

## Task 3: POST /api/v1/auth/miniapp endpoint

**Files:**
- Modify: `src/api/routes/auth.js`
- Create: `tests/api/auth-miniapp.test.js`

The endpoint accepts `{ initData: "..." }`, verifies, upserts the user, mints a customer JWT (24h), returns it.

- [ ] **Step 1: Write the failing test**

Create `tests/api/auth-miniapp.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

// We import the route handler directly to avoid spinning up the full server.
// The auth router exports its Express router; we mount it on a fresh app.
const express = require('express');

const BOT_TOKEN = '123456:fake-bot-token-for-tests';
process.env.BOT_TOKEN = BOT_TOKEN;
process.env.JWT_SECRET = 'test-secret-for-miniapp-auth-tests-must-be-32-chars-long';

function signInitData(params) {
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const dataCheck = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('\n');
  const hash = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
  return new URLSearchParams({ ...params, hash }).toString();
}

async function postJson(app, path, body) {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, async () => {
      const port = server.address().port;
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        server.close();
        resolve({ status: res.status, json });
      } catch (err) { server.close(); reject(err); }
    });
  });
}

test('POST /auth/miniapp returns a customer JWT for valid initData', async () => {
  // Reset DB to a clean state by deleting any test user
  const db = require('../../src/database');
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(987654321);

  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', require('../../src/api/routes/auth'));

  const initData = signInitData({
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: 987654321, first_name: 'Mini', username: 'miniuser' }),
  });
  const { status, json } = await postJson(app, '/api/v1/auth/miniapp', { initData });

  assert.strictEqual(status, 200, `unexpected body: ${JSON.stringify(json)}`);
  assert.strictEqual(json.success, true);
  assert.match(json.data.token, /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/);
  assert.strictEqual(json.data.user.telegramId, 987654321);
  assert.strictEqual(json.data.user.username, 'miniuser');

  const created = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(987654321);
  assert.ok(created, 'user row should be created on first contact');
});

test('POST /auth/miniapp rejects bad hash with 401', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', require('../../src/api/routes/auth'));

  const { status, json } = await postJson(app, '/api/v1/auth/miniapp', {
    initData: 'auth_date=1&user=%7B%22id%22%3A1%7D&hash=deadbeef',
  });
  assert.strictEqual(status, 401);
  assert.strictEqual(json.success, false);
  assert.strictEqual(json.error.code, 'INVALID_INIT_DATA');
});
```

- [ ] **Step 2: Run to fail**

```bash
node --test tests/api/auth-miniapp.test.js
```

Expected: 404 Not Found on the POST (route doesn't exist yet).

- [ ] **Step 3: Implement the route**

In `src/api/routes/auth.js`, add (above `module.exports`):

```js
const { verifyInitData } = require('../../utils/initData');
const userService = require('../../services/userService');
const config = require('../../config');

router.post('/miniapp', validate(z.object({
  initData: z.string().min(1).max(8192),
})), async (req, res) => {
  const { initData } = req.validated;
  const result = verifyInitData(initData, config.BOT_TOKEN);
  if (!result.ok) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_INIT_DATA', message: `initData rejected: ${result.reason}` },
    });
  }

  const user = userService.findOrCreateFromInitData(result.user);
  const token = await authService.issueCustomerToken(user.telegram_id);

  res.json({
    success: true,
    data: {
      token,
      user: {
        telegramId: user.telegram_id,
        username: user.username || null,
        fullName: user.full_name || '',
        balance: user.balance || 0,
      },
    },
  });
});
```

Then verify `authService` exposes `issueCustomerToken(telegramId)` — it almost certainly does (`/auth/verify-code` already issues one). If the method has a different name, match it. The intent: same JWT shape as the existing customer token, so the existing `requireCustomer` middleware accepts it without modification.

- [ ] **Step 4: Run to pass**

```bash
node --test tests/api/auth-miniapp.test.js
```

Expected: 2 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/auth.js tests/api/auth-miniapp.test.js
git commit -m "feat(api): POST /auth/miniapp exchanges initData for customer JWT"
```

---

## Task 4: Delete legacy public storefront pages that conflict

**Files:**
- Delete: `web/src/app/san-pham/page.tsx`
- Delete: `web/src/app/san-pham/[slug]/page.tsx`

The legacy pages share their URL space with the new Mini App routes. Once the `(miniapp)/san-pham/[slug]/page.tsx` page lands in Task 8, the colocation produces a Next.js build error (two routes for the same path). Delete the legacy pages now to surface any unexpected imports early.

- [ ] **Step 1: Verify nothing else imports the legacy pages**

```bash
grep -rn "from '@/app/san-pham\|from \"@/app/san-pham" web/src 2>/dev/null
grep -rn "/san-pham" web/src --include="*.tsx" --include="*.ts" 2>/dev/null
```

Expected: only references to `/san-pham` URLs (string literals or `<Link href="/san-pham/...">`). Imports from `@/app/san-pham` should be zero. If imports exist, fix them inline before deleting.

- [ ] **Step 2: Delete**

```bash
git rm -r web/src/app/san-pham
```

- [ ] **Step 3: Confirm Next still builds (it should — no other route claims `/san-pham` yet)**

```bash
cd web && npm run build && cd ..
```

Expected: build succeeds, `/san-pham/[slug]` no longer in the route table.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(web): drop legacy /san-pham public pages — Mini App takes the URL"
```

---

## Task 5: Telegram WebApp wrapper + theme bridge + auth bootstrap

**Files:**
- Create: `web/src/lib/telegram.ts`
- Create: `web/src/lib/miniappAuth.ts`
- Create: `web/src/lib/miniappApi.ts`
- Modify: `web/src/app/layout.tsx`
- Modify: `web/src/app/providers.tsx`

The wrapper exposes a typed view of `window.Telegram.WebApp`, a `useWebApp()` hook that's safe in SSR, and a CSS variable bridge that maps the user's Telegram theme parameters to CSS custom properties so the Mini App matches the Telegram client chrome.

- [ ] **Step 1: Create the WebApp wrapper**

Write `web/src/lib/telegram.ts`:

```ts
'use client'

import { useEffect, useState } from 'react'

export interface TelegramThemeParams {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
}

export interface TelegramUser {
  id: number
  first_name?: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe: { user?: TelegramUser; auth_date?: number; hash?: string }
  themeParams: TelegramThemeParams
  colorScheme: 'light' | 'dark'
  ready(): void
  expand(): void
  close(): void
  MainButton: {
    text: string
    show(): void
    hide(): void
    setText(t: string): void
    onClick(cb: () => void): void
    offClick(cb: () => void): void
    enable(): void
    disable(): void
    showProgress(leaveActive?: boolean): void
    hideProgress(): void
  }
  BackButton: {
    show(): void
    hide(): void
    onClick(cb: () => void): void
    offClick(cb: () => void): void
  }
  HapticFeedback: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void
    notificationOccurred(type: 'error' | 'success' | 'warning'): void
    selectionChanged(): void
  }
  openLink(url: string): void
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export function getWebApp(): TelegramWebApp | null {
  if (typeof window === 'undefined') return null
  return window.Telegram?.WebApp ?? null
}

export function useWebApp(): TelegramWebApp | null {
  const [wa, setWa] = useState<TelegramWebApp | null>(null)
  useEffect(() => {
    const w = getWebApp()
    if (!w) return
    w.ready()
    w.expand()
    setWa(w)
  }, [])
  return wa
}

const THEME_VAR_MAP: [keyof TelegramThemeParams, string][] = [
  ['bg_color',          '--tg-bg'],
  ['text_color',        '--tg-text'],
  ['hint_color',        '--tg-hint'],
  ['link_color',        '--tg-link'],
  ['button_color',      '--tg-button'],
  ['button_text_color', '--tg-button-text'],
  ['secondary_bg_color','--tg-bg-2'],
]

export function applyThemeVars(theme: TelegramThemeParams) {
  if (typeof document === 'undefined') return
  for (const [src, varName] of THEME_VAR_MAP) {
    const v = theme[src]
    if (v) document.documentElement.style.setProperty(varName, v)
  }
}
```

- [ ] **Step 2: Create the auth bootstrap**

Write `web/src/lib/miniappAuth.ts`:

```ts
'use client'

let cachedToken: string | null = null
let inflight: Promise<string> | null = null

export interface MiniAppMe {
  telegramId: number
  username: string | null
  fullName: string
  balance: number
}

let cachedMe: MiniAppMe | null = null

export async function getMiniAppToken(initData: string): Promise<string> {
  if (cachedToken) return cachedToken
  if (inflight) return inflight
  inflight = (async () => {
    const res = await fetch('/api/v1/auth/miniapp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Mini App auth failed: ${res.status} ${text}`)
    }
    const json = await res.json()
    cachedToken = json.data.token as string
    cachedMe = json.data.user as MiniAppMe
    return cachedToken
  })().finally(() => { inflight = null })
  return inflight
}

export function getCachedMe(): MiniAppMe | null { return cachedMe }
export function getCachedToken(): string | null { return cachedToken }
export function clearAuth() { cachedToken = null; cachedMe = null }
```

- [ ] **Step 3: Create the API wrapper**

Write `web/src/lib/miniappApi.ts`:

```ts
'use client'

import { getCachedToken } from './miniappAuth'

export interface ApiResponse<T> { success: boolean; data?: T; error?: { code: string; message: string } }

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  const token = getCachedToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  const res = await fetch(`/api/v1${path}`, { ...init, headers })
  const json: ApiResponse<T> = await res.json()
  if (!json.success || json.data === undefined) {
    throw new Error(json.error?.message || `API ${path} failed (${res.status})`)
  }
  return json.data
}
```

- [ ] **Step 4: Load the Telegram WebApp script in the root layout**

In `web/src/app/layout.tsx`:

```diff
 import type { Metadata } from 'next'
 import { Inter, JetBrains_Mono } from 'next/font/google'
+import Script from 'next/script'
 import './globals.css'
 import { Providers } from './providers'

 // ...

 export default function RootLayout({ children }: { children: React.ReactNode }) {
   return (
     <html lang="vi" className={`${inter.variable} ${jbm.variable}`}>
       <body>
+        <Script
+          src="https://telegram.org/js/telegram-web-app.js?57"
+          strategy="beforeInteractive"
+        />
         <Providers>{children}</Providers>
       </body>
     </html>
   )
 }
```

`beforeInteractive` ensures `window.Telegram.WebApp` exists before any client-side React effect runs.

- [ ] **Step 5: Don't render the global AnnouncementBar inside the Mini App**

In `web/src/app/providers.tsx`, change the `showBar` predicate:

```diff
-  const showBar = !pathname?.startsWith('/admin')
+  const showBar = !pathname?.startsWith('/admin') &&
+                  !pathname?.startsWith('/danh-muc') &&
+                  !pathname?.startsWith('/san-pham') &&
+                  !pathname?.startsWith('/gio-hang') &&
+                  !pathname?.startsWith('/dat-hang') &&
+                  !pathname?.startsWith('/don-hang') &&
+                  pathname !== '/'
```

The Mini App owns `/` and the listed prefixes after Task 4. The legacy account pages (`/dang-nhap`, `/lien-ket`, `/tai-khoan`, `/quen-mat-khau`, `/thanh-toan`) keep the announcement bar until sub-project #8 deletes them.

- [ ] **Step 6: Build to verify nothing regressed**

```bash
cd web && npm run build && cd ..
```

Expected: success.

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/telegram.ts web/src/lib/miniappAuth.ts web/src/lib/miniappApi.ts web/src/app/layout.tsx web/src/app/providers.tsx
git commit -m "feat(miniapp): WebApp wrapper, auth bootstrap, API client, theme bridge"
```

---

## Task 6: Mini App layout shell with auth bootstrap and theme

**Files:**
- Modify: `web/src/app/(miniapp)/layout.tsx`
- Create: `web/src/app/(miniapp)/components/MiniAppShell.tsx`
- Create: `web/src/i18n/vi.ts`

The layout file is currently the placeholder from sub-project #1. Replace it with the real shell.

- [ ] **Step 1: Write the Vietnamese string table**

Create `web/src/i18n/vi.ts`:

```ts
export const t = {
  appName: 'Taikhoantenhat',
  tagline: 'Cửa hàng số trong Telegram',
  nav: {
    home: 'Trang chủ',
    catalog: 'Sản phẩm',
    cart: 'Giỏ hàng',
    orders: 'Đơn hàng',
  },
  home: {
    announcementsTitle: 'Thông báo',
    categoriesTitle: 'Danh mục',
    emptyCategories: 'Chưa có danh mục.',
  },
  catalog: {
    searchPlaceholder: 'Tìm sản phẩm…',
    sortLabel: 'Sắp xếp',
    sortDefault: 'Mặc định',
    sortPriceAsc: 'Giá thấp → cao',
    sortPriceDesc: 'Giá cao → thấp',
    sortNewest: 'Mới nhất',
    empty: 'Không có sản phẩm.',
  },
  product: {
    addToCart: 'Thêm vào giỏ',
    buyNow: 'Mua ngay',
    inStock: 'Còn {n} sản phẩm',
    outOfStock: 'Hết hàng',
    contactOnly: 'Liên hệ để mua',
  },
  cart: {
    title: 'Giỏ hàng',
    empty: 'Giỏ hàng trống.',
    total: 'Tổng cộng',
    checkout: 'Thanh toán',
    remove: 'Xoá',
    increase: 'Tăng',
    decrease: 'Giảm',
  },
  checkout: {
    title: 'Thanh toán',
    bank: 'Ngân hàng',
    confirm: 'Xác nhận đặt hàng',
    creating: 'Đang tạo đơn…',
  },
  order: {
    title: 'Đơn hàng',
    waiting: 'Đang chờ thanh toán',
    paid: 'Đã thanh toán',
    delivered: 'Đã giao',
    cancelled: 'Đã huỷ',
    expired: 'Hết hạn',
    qrTitle: 'Quét mã để thanh toán',
    paymentCode: 'Nội dung chuyển khoản',
    keysTitle: 'Tài khoản đã giao',
  },
  errors: {
    auth: 'Phiên đăng nhập không hợp lệ. Mở lại từ Telegram.',
    network: 'Lỗi kết nối. Thử lại sau.',
  },
} as const
```

- [ ] **Step 2: Write MiniAppShell**

Create `web/src/app/(miniapp)/components/MiniAppShell.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { ReactNode } from 'react'
import { t } from '@/i18n/vi'

export function MiniAppShell({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <div
      className="min-h-screen pb-20"
      style={{ background: 'var(--tg-bg, #fff)', color: 'var(--tg-text, #000)' }}
    >
      {title && (
        <header
          className="sticky top-0 z-10 px-4 py-3 text-base font-semibold"
          style={{ background: 'var(--tg-bg-2, #f4f4f4)' }}
        >
          {title}
        </header>
      )}
      <main className="px-4 py-3">{children}</main>
      <nav
        className="fixed bottom-0 left-0 right-0 grid grid-cols-3 border-t text-sm"
        style={{ background: 'var(--tg-bg-2, #f4f4f4)' }}
      >
        <Link href="/" className="py-3 text-center">{t.nav.home}</Link>
        <Link href="/gio-hang" className="py-3 text-center">{t.nav.cart}</Link>
        <Link href="/don-hang" className="py-3 text-center">{t.nav.orders}</Link>
      </nav>
    </div>
  )
}
```

The catalog isn't in the bottom nav because it lives inside Home (category tiles). That keeps the nav at three items, which is the comfortable Mini App ceiling.

- [ ] **Step 3: Replace the placeholder layout**

Overwrite `web/src/app/(miniapp)/layout.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'
import type { Metadata } from 'next'
import { useWebApp, applyThemeVars, getWebApp } from '@/lib/telegram'
import { getMiniAppToken } from '@/lib/miniappAuth'
import { t } from '@/i18n/vi'

export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  const wa = useWebApp()
  const [authState, setAuthState] = useState<'pending' | 'ready' | 'failed'>('pending')

  useEffect(() => {
    if (!wa) return
    applyThemeVars(wa.themeParams)
    if (!wa.initData) {
      // Page opened outside Telegram → leave as failed; Mini-App-only routes
      // will show the error banner. Geo-block (sub-project #4) prevents
      // direct access from VN browsers; this is the in-route fallback.
      setAuthState('failed')
      return
    }
    getMiniAppToken(wa.initData)
      .then(() => setAuthState('ready'))
      .catch(() => setAuthState('failed'))
  }, [wa])

  if (authState === 'failed') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <p>{t.errors.auth}</p>
      </div>
    )
  }
  if (authState === 'pending') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 text-center">
        <p>Đang khởi tạo…</p>
      </div>
    )
  }
  return <>{children}</>
}
```

`metadata` was on the placeholder, but a `'use client'` layout cannot export `metadata`. The root layout's metadata covers the title; the Mini App-specific viewport already lives there.

If the build complains about `'use client'` + nested route layouts, restructure: keep `(miniapp)/layout.tsx` as a server component that just renders a client `<AuthBoundary>{children}</AuthBoundary>` component, and put the auth logic there. Either approach is fine; pick whichever the build accepts.

- [ ] **Step 4: Verify the build**

```bash
cd web && npm run build && cd ..
```

Expected: success. If it fails on `'use client'` + metadata, switch to the boundary pattern above.

- [ ] **Step 5: Commit**

```bash
git add web/src/i18n/vi.ts web/src/app/(miniapp)/components/MiniAppShell.tsx web/src/app/(miniapp)/layout.tsx
git commit -m "feat(miniapp): shell layout with theme bridge and initData auth bootstrap"
```

---

## Task 7: Home page — announcements + categories

**Files:**
- Modify: `web/src/app/(miniapp)/page.tsx`

- [ ] **Step 1: Replace the placeholder**

```tsx
'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from './components/MiniAppShell'
import { t } from '@/i18n/vi'

interface Announcement { id: string; title: string; body: string; pinned: boolean }
interface Category { id: number; name: string; slug: string; emoji: string }

export default function MiniAppHome() {
  const ann = useQuery({
    queryKey: ['announcements'],
    queryFn: () => apiFetch<Announcement[]>('/announcements'),
  })
  const cats = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch<Category[]>('/categories'),
  })

  return (
    <MiniAppShell title={t.appName}>
      {ann.data && ann.data.length > 0 && (
        <section className="mb-6">
          <h2 className="text-sm font-semibold mb-2 opacity-70">{t.home.announcementsTitle}</h2>
          <ul className="space-y-2">
            {ann.data.slice(0, 3).map((a) => (
              <li key={a.id} className="rounded-lg p-3" style={{ background: 'var(--tg-bg-2)' }}>
                <p className="font-medium">{a.title}</p>
                <p className="text-sm opacity-80 whitespace-pre-line">{a.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2 opacity-70">{t.home.categoriesTitle}</h2>
        {cats.isLoading && <p className="opacity-60">…</p>}
        {cats.data && cats.data.length === 0 && <p className="opacity-60">{t.home.emptyCategories}</p>}
        {cats.data && cats.data.length > 0 && (
          <ul className="grid grid-cols-2 gap-3">
            {cats.data.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/danh-muc/${c.slug}`}
                  className="block rounded-xl p-4 text-center"
                  style={{ background: 'var(--tg-bg-2)' }}
                >
                  <div className="text-3xl">{c.emoji || '📦'}</div>
                  <div className="mt-2 text-sm font-medium">{c.name}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </MiniAppShell>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
cd web && npm run build && cd ..
```

- [ ] **Step 3: Commit**

```bash
git add web/src/app/(miniapp)/page.tsx
git commit -m "feat(miniapp): home page with announcements + categories"
```

---

## Task 8: Catalog page (per category) and product detail page

**Files:**
- Create: `web/src/app/(miniapp)/danh-muc/[slug]/page.tsx`
- Create: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`
- Create: `web/src/app/(miniapp)/components/ProductCard.tsx`

- [ ] **Step 1: Write ProductCard**

```tsx
'use client'

import Link from 'next/link'
import Image from 'next/image'
import { formatPrice } from '@/lib/utils'

export interface ProductSummary {
  id: string; slug: string; name: string; emoji: string;
  imageUrl?: string; price: number; stock: number;
}

export function ProductCard({ p }: { p: ProductSummary }) {
  return (
    <Link
      href={`/san-pham/${p.slug}`}
      className="block rounded-xl overflow-hidden"
      style={{ background: 'var(--tg-bg-2)' }}
    >
      <div className="aspect-square relative">
        {p.imageUrl ? (
          <Image src={p.imageUrl} alt={p.name} fill sizes="(max-width: 768px) 50vw, 200px" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-5xl">{p.emoji || '📦'}</div>
        )}
      </div>
      <div className="p-2">
        <p className="text-sm font-medium line-clamp-2">{p.name}</p>
        <p className="text-sm font-semibold mt-1">{formatPrice(p.price)}</p>
        <p className="text-xs opacity-70">{p.stock > 0 ? `Còn ${p.stock}` : 'Hết hàng'}</p>
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Write the catalog page**

Create `web/src/app/(miniapp)/danh-muc/[slug]/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../../components/MiniAppShell'
import { ProductCard, ProductSummary } from '../../components/ProductCard'
import { t } from '@/i18n/vi'

export default function CategoryPage() {
  const params = useParams<{ slug: string }>()
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('default')

  const products = useQuery({
    queryKey: ['products', params.slug, q, sort],
    queryFn: () => apiFetch<ProductSummary[]>(
      `/products?category=${encodeURIComponent(params.slug)}&q=${encodeURIComponent(q)}&sort=${sort}`
    ),
  })

  return (
    <MiniAppShell title={t.appName}>
      <div className="mb-3 flex gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.catalog.searchPlaceholder}
          className="flex-1 rounded-md px-3 py-2"
          style={{ background: 'var(--tg-bg-2)' }}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          className="rounded-md px-2"
          style={{ background: 'var(--tg-bg-2)' }}
        >
          <option value="default">{t.catalog.sortDefault}</option>
          <option value="price_asc">{t.catalog.sortPriceAsc}</option>
          <option value="price_desc">{t.catalog.sortPriceDesc}</option>
          <option value="newest">{t.catalog.sortNewest}</option>
        </select>
      </div>

      {products.isLoading && <p className="opacity-60">…</p>}
      {products.data && products.data.length === 0 && (
        <p className="opacity-60">{t.catalog.empty}</p>
      )}
      {products.data && products.data.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {products.data.map((p) => (
            <li key={p.id}><ProductCard p={p} /></li>
          ))}
        </ul>
      )}
    </MiniAppShell>
  )
}
```

- [ ] **Step 3: Write the product detail page**

Create `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`:

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams, useRouter } from 'next/navigation'
import Image from 'next/image'
import { apiFetch } from '@/lib/miniappApi'
import { useCart } from '@/lib/cart'
import { MiniAppShell } from '../../components/MiniAppShell'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

interface ProductDetail extends ProductBase { longDescription: string; description: string }
interface ProductBase {
  id: string; slug: string; name: string; emoji: string; imageUrl?: string;
  price: number; stock: number; contactOnly: boolean; contactUrl?: string;
}

export default function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const cart = useCart()

  const { data: p, isLoading } = useQuery({
    queryKey: ['product', slug],
    queryFn: () => apiFetch<ProductDetail>(`/products/${slug}`),
  })

  if (isLoading) return <MiniAppShell><p className="opacity-60">…</p></MiniAppShell>
  if (!p) return <MiniAppShell><p>Không tìm thấy.</p></MiniAppShell>

  return (
    <MiniAppShell title={p.name}>
      <div className="rounded-xl overflow-hidden mb-3" style={{ background: 'var(--tg-bg-2)' }}>
        <div className="aspect-square relative">
          {p.imageUrl
            ? <Image src={p.imageUrl} alt={p.name} fill sizes="100vw" />
            : <div className="absolute inset-0 flex items-center justify-center text-7xl">{p.emoji || '📦'}</div>}
        </div>
      </div>

      <p className="text-xl font-semibold">{formatPrice(p.price)}</p>
      <p className="text-sm opacity-70 mb-3">
        {p.stock > 0 ? t.product.inStock.replace('{n}', String(p.stock)) : t.product.outOfStock}
      </p>
      {p.description && <p className="mb-3 whitespace-pre-line">{p.description}</p>}
      {p.longDescription && (
        <details className="mb-4">
          <summary className="cursor-pointer">Chi tiết</summary>
          <div className="mt-2 whitespace-pre-line text-sm opacity-90">{p.longDescription}</div>
        </details>
      )}

      <div className="grid grid-cols-2 gap-2 fixed bottom-16 left-0 right-0 px-4">
        <button
          onClick={() => { cart.add({ id: p.id, slug: p.slug, name: p.name, price: p.price, emoji: p.emoji, imageUrl: p.imageUrl }) }}
          disabled={p.stock <= 0 || p.contactOnly}
          className="rounded-lg py-3 font-medium"
          style={{ background: 'var(--tg-bg-2)' }}
        >
          {t.product.addToCart}
        </button>
        <button
          onClick={() => {
            cart.add({ id: p.id, slug: p.slug, name: p.name, price: p.price, emoji: p.emoji, imageUrl: p.imageUrl })
            router.push('/dat-hang')
          }}
          disabled={p.stock <= 0 || p.contactOnly}
          className="rounded-lg py-3 font-medium"
          style={{ background: 'var(--tg-button)', color: 'var(--tg-button-text)' }}
        >
          {t.product.buyNow}
        </button>
      </div>
    </MiniAppShell>
  )
}
```

- [ ] **Step 4: Verify build**

```bash
cd web && npm run build && cd ..
```

If `useCart` errors as missing — that's expected; Task 9 creates it. Skip the build step until then; just confirm no syntax errors:

```bash
cd web && npx tsc --noEmit && cd ..
```

If `tsc` complains only about `useCart`, proceed.

- [ ] **Step 5: Commit (even if build is red on missing useCart — Task 9 finishes it)**

```bash
git add 'web/src/app/(miniapp)/danh-muc' 'web/src/app/(miniapp)/san-pham' 'web/src/app/(miniapp)/components/ProductCard.tsx'
git commit -m "feat(miniapp): catalog and product detail pages"
```

---

## Task 9: Cart store + cart page

**Files:**
- Create: `web/src/lib/cart.ts`
- Create: `web/src/app/(miniapp)/gio-hang/page.tsx`

- [ ] **Step 1: Write the cart store**

Create `web/src/lib/cart.ts`:

```ts
'use client'

import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'taikhoantenhat:cart:v1'

export interface CartItem {
  id: string; slug: string; name: string; emoji: string;
  imageUrl?: string; price: number; quantity: number;
}

interface Stored { items: Omit<CartItem, 'quantity'>[] | CartItem[] }

function read(): CartItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Stored
    return (parsed.items as CartItem[]).map((it) => ({ ...it, quantity: it.quantity || 1 }))
  } catch { return [] }
}

function write(items: CartItem[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ items }))
  window.dispatchEvent(new CustomEvent('cart:updated'))
}

export function useCart() {
  const [items, setItems] = useState<CartItem[]>([])
  useEffect(() => {
    setItems(read())
    const onUpdate = () => setItems(read())
    window.addEventListener('cart:updated', onUpdate)
    return () => window.removeEventListener('cart:updated', onUpdate)
  }, [])

  const add = useCallback((p: Omit<CartItem, 'quantity'>) => {
    const cur = read()
    const existing = cur.find((it) => it.id === p.id)
    if (existing) existing.quantity += 1
    else cur.push({ ...p, quantity: 1 })
    write(cur)
  }, [])
  const setQuantity = useCallback((id: string, q: number) => {
    const cur = read().map((it) => it.id === id ? { ...it, quantity: Math.max(0, q) } : it).filter((it) => it.quantity > 0)
    write(cur)
  }, [])
  const remove = useCallback((id: string) => {
    write(read().filter((it) => it.id !== id))
  }, [])
  const clear = useCallback(() => write([]), [])

  const total = items.reduce((s, it) => s + it.price * it.quantity, 0)

  return { items, add, setQuantity, remove, clear, total }
}
```

- [ ] **Step 2: Write the cart page**

Create `web/src/app/(miniapp)/gio-hang/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useCart } from '@/lib/cart'
import { MiniAppShell } from '../components/MiniAppShell'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

export default function CartPage() {
  const cart = useCart()

  return (
    <MiniAppShell title={t.cart.title}>
      {cart.items.length === 0 && <p className="opacity-60">{t.cart.empty}</p>}
      {cart.items.length > 0 && (
        <>
          <ul className="space-y-2 mb-4">
            {cart.items.map((it) => (
              <li key={it.id} className="rounded-lg p-3 flex gap-3 items-center" style={{ background: 'var(--tg-bg-2)' }}>
                <div className="text-3xl">{it.emoji || '📦'}</div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{it.name}</p>
                  <p className="text-xs opacity-70">{formatPrice(it.price)}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <button onClick={() => cart.setQuantity(it.id, it.quantity - 1)} className="px-2 rounded" style={{ background: 'var(--tg-bg)' }}>−</button>
                    <span className="w-8 text-center">{it.quantity}</span>
                    <button onClick={() => cart.setQuantity(it.id, it.quantity + 1)} className="px-2 rounded" style={{ background: 'var(--tg-bg)' }}>+</button>
                    <button onClick={() => cart.remove(it.id)} className="ml-auto text-xs opacity-70">{t.cart.remove}</button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between mb-3">
            <span className="opacity-70">{t.cart.total}</span>
            <span className="text-lg font-semibold">{formatPrice(cart.total)}</span>
          </div>
          <Link
            href="/dat-hang"
            className="block text-center rounded-lg py-3 font-medium"
            style={{ background: 'var(--tg-button)', color: 'var(--tg-button-text)' }}
          >
            {t.cart.checkout}
          </Link>
        </>
      )}
    </MiniAppShell>
  )
}
```

- [ ] **Step 3: Build**

```bash
cd web && npm run build && cd ..
```

Expected: success now that `useCart` exists.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/cart.ts 'web/src/app/(miniapp)/gio-hang'
git commit -m "feat(miniapp): localStorage cart + cart page"
```

---

## Task 10: Checkout — POST /orders, redirect to order page

**Files:**
- Create: `web/src/app/(miniapp)/dat-hang/page.tsx`

The checkout MVP supports a single line item (the existing `POST /orders` endpoint accepts one productId + quantity). If the cart has multiple items, we create them sequentially and redirect to the **last** order page; the user pays each separately. This is good enough for MVP — multi-line orders are a sub-project #5 scope item.

- [ ] **Step 1: Write the page**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useCart } from '@/lib/cart'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../components/MiniAppShell'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

interface CreateOrderResp {
  order: { id: number; status: string; expiresAt: string }
  payment: { qrUrl: string; paymentCode: string; bankName: string; amount: number }
}

export default function CheckoutPage() {
  const cart = useCart()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function placeOrder() {
    setBusy(true); setErr(null)
    try {
      let lastOrderId: number | null = null
      for (const it of cart.items) {
        const resp = await apiFetch<CreateOrderResp>('/orders', {
          method: 'POST',
          body: JSON.stringify({ productId: Number(it.id), quantity: it.quantity, bankIndex: 0 }),
        })
        lastOrderId = resp.order.id
      }
      cart.clear()
      if (lastOrderId) router.push(`/don-hang/${lastOrderId}`)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi không xác định')
    } finally {
      setBusy(false)
    }
  }

  return (
    <MiniAppShell title={t.checkout.title}>
      {cart.items.length === 0 && <p className="opacity-60">{t.cart.empty}</p>}
      {cart.items.length > 0 && (
        <>
          <ul className="space-y-2 mb-4">
            {cart.items.map((it) => (
              <li key={it.id} className="rounded-lg p-3 flex justify-between" style={{ background: 'var(--tg-bg-2)' }}>
                <span>{it.name} × {it.quantity}</span>
                <span>{formatPrice(it.price * it.quantity)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between mb-3">
            <span className="opacity-70">{t.cart.total}</span>
            <span className="text-lg font-semibold">{formatPrice(cart.total)}</span>
          </div>
          {err && <p className="text-red-500 text-sm mb-2">{err}</p>}
          <button
            onClick={placeOrder}
            disabled={busy}
            className="w-full rounded-lg py-3 font-medium"
            style={{ background: 'var(--tg-button)', color: 'var(--tg-button-text)' }}
          >
            {busy ? t.checkout.creating : t.checkout.confirm}
          </button>
        </>
      )}
    </MiniAppShell>
  )
}
```

- [ ] **Step 2: Build and commit**

```bash
cd web && npm run build && cd ..
git add 'web/src/app/(miniapp)/dat-hang'
git commit -m "feat(miniapp): checkout creates orders and redirects to status page"
```

---

## Task 11: Order status page with SSE

**Files:**
- Modify: `src/api/routes/events.js` — add `?orderId=` and `?topic=order:{id}:status` filtering hook
- Create: `web/src/app/(miniapp)/don-hang/[id]/page.tsx`
- Create: `web/src/app/(miniapp)/don-hang/page.tsx` — list of recent orders for the bottom-nav "Đơn hàng" link
- Create: `web/src/app/(miniapp)/components/QrPanel.tsx`

The existing `/api/v1/events` SSE endpoint fans out every event to every subscriber. For the order page we want only events for one order. Two paths:
- (a) Filter on the client: subscribe, ignore irrelevant frames. Simplest, lowest risk.
- (b) Add a `?topic=` query and only forward matching events.

Pick (a) for MVP. The eventBus payload already includes a `type` and an `id`/`orderId`; the client filters. If chatter becomes a problem later, sub-project #6 introduces (b).

The event publisher (paymentPoller / fulfillment) must publish frames the client can recognize. Audit:

```bash
grep -rn "eventBus.publish" src/ | head -10
```

If the existing publishers don't include `orderId`, this task adds the publisher-side fields where needed. The audit may show no orderId — in that case, also modify `paymentPoller.js` to publish `{ type: 'order.status', orderId, status }` whenever it confirms a payment, and `orderService` (or wherever fulfillment writes) to publish `{ type: 'order.delivered', orderId }`. Minimal additions, single line each.

- [ ] **Step 1: Audit existing eventBus publishers**

```bash
grep -rn "eventBus" src/services/ src/api/ | grep -v 'require\|test'
```

Identify whether order status changes already publish events. If yes, note the field names and skip the publisher changes. If not, plan to add them in Step 4 below before the SSE page can react.

- [ ] **Step 2: Write QrPanel**

Create `web/src/app/(miniapp)/components/QrPanel.tsx`:

```tsx
'use client'

import Image from 'next/image'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

export function QrPanel({ qrUrl, paymentCode, amount, bankName }: {
  qrUrl: string; paymentCode: string; amount: number; bankName: string
}) {
  return (
    <div className="rounded-xl p-4" style={{ background: 'var(--tg-bg-2)' }}>
      <p className="text-center text-sm opacity-70 mb-2">{t.order.qrTitle} ({bankName})</p>
      <div className="flex justify-center">
        <Image src={qrUrl} alt="VietQR" width={240} height={240} unoptimized />
      </div>
      <div className="mt-3 text-center">
        <p className="text-sm opacity-70">{t.order.paymentCode}</p>
        <p className="font-mono text-lg select-all">{paymentCode}</p>
        <p className="text-xs mt-1 opacity-70">{formatPrice(amount)}</p>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write the order detail page**

Create `web/src/app/(miniapp)/don-hang/[id]/page.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../../components/MiniAppShell'
import { QrPanel } from '../../components/QrPanel'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

interface OrderStatus {
  id: string; status: 'pending' | 'paid' | 'delivered' | 'cancelled' | 'expired';
  totalPrice: number; paymentCode: string; qrUrl: string; bankName: string; expiresAt: string;
  productName: string; quantity: number; accounts?: string[]; usageInstructions?: string | null;
}

const STATUS_LABEL: Record<OrderStatus['status'], string> = {
  pending: t.order.waiting, paid: t.order.paid, delivered: t.order.delivered,
  cancelled: t.order.cancelled, expired: t.order.expired,
}

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const qc = useQueryClient()

  const { data: order } = useQuery({
    queryKey: ['order', id],
    queryFn: () => apiFetch<OrderStatus>(`/orders/${id}/status`),
    refetchInterval: (q) => {
      const s = q.state.data?.status
      return s === 'pending' || s === 'paid' ? 5000 : false
    },
  })

  useEffect(() => {
    const es = new EventSource('/api/v1/events')
    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        const matches = (msg.orderId != null && String(msg.orderId) === id)
        if (matches && (msg.type === 'order.status' || msg.type === 'order.delivered')) {
          qc.invalidateQueries({ queryKey: ['order', id] })
        }
      } catch {}
    }
    return () => es.close()
  }, [id, qc])

  if (!order) {
    return <MiniAppShell title={t.order.title}><p className="opacity-60">…</p></MiniAppShell>
  }

  return (
    <MiniAppShell title={`${t.order.title} #${order.id}`}>
      <p className="mb-2"><strong>{order.productName}</strong> × {order.quantity}</p>
      <p className="mb-3">{formatPrice(order.totalPrice)}</p>
      <p className="mb-3 text-sm">Trạng thái: <strong>{STATUS_LABEL[order.status]}</strong></p>

      {order.status === 'pending' && (
        <QrPanel qrUrl={order.qrUrl} paymentCode={order.paymentCode}
          amount={order.totalPrice} bankName={order.bankName} />
      )}

      {order.status === 'delivered' && order.accounts && order.accounts.length > 0 && (
        <section className="mt-4">
          <h2 className="text-sm font-semibold mb-2 opacity-70">{t.order.keysTitle}</h2>
          <ul className="space-y-2">
            {order.accounts.map((k, i) => (
              <li key={i} className="rounded-md px-3 py-2 font-mono text-sm select-all"
                  style={{ background: 'var(--tg-bg-2)' }}>{k}</li>
            ))}
          </ul>
          {order.usageInstructions && (
            <div className="mt-3 text-sm whitespace-pre-line opacity-90">{order.usageInstructions}</div>
          )}
        </section>
      )}
    </MiniAppShell>
  )
}
```

- [ ] **Step 4: Add publisher events if Step 1 found them missing**

If `paymentPoller.js` confirms a payment by setting status to `paid`, add right after the DB update:

```js
require('./eventBus').publish({ type: 'order.status', orderId: order.id, status: 'paid' });
```

If `orderService.deliver` (or wherever fulfillment finishes) sets status to `delivered`, add:

```js
require('./eventBus').publish({ type: 'order.delivered', orderId, status: 'delivered' });
```

Search and edit only files where these state changes happen. Each change is one line.

- [ ] **Step 5: Write a tiny order-list page for the bottom-nav target**

Create `web/src/app/(miniapp)/don-hang/page.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../components/MiniAppShell'
import { formatPrice } from '@/lib/utils'
import { t } from '@/i18n/vi'

interface OrderRow { id: number; status: string; total_price: number; created_at: string; product_name?: string }

export default function MyOrdersPage() {
  const { data } = useQuery({
    queryKey: ['orders', 'my'],
    queryFn: () => apiFetch<OrderRow[]>('/orders/my'),
  })
  return (
    <MiniAppShell title={t.nav.orders}>
      {!data && <p className="opacity-60">…</p>}
      {data && data.length === 0 && <p className="opacity-60">Chưa có đơn hàng.</p>}
      {data && data.length > 0 && (
        <ul className="space-y-2">
          {data.map((o) => (
            <li key={o.id}>
              <Link href={`/don-hang/${o.id}`} className="block rounded-lg p-3" style={{ background: 'var(--tg-bg-2)' }}>
                <p className="text-sm">#{o.id} — {o.product_name || ''}</p>
                <p className="text-xs opacity-70">{formatPrice(o.total_price)} · {o.status}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </MiniAppShell>
  )
}
```

- [ ] **Step 6: Build, then commit**

```bash
cd web && npm run build && cd ..
git add 'web/src/app/(miniapp)/don-hang' 'web/src/app/(miniapp)/components/QrPanel.tsx' src/services/paymentPoller.js src/services/orderService.js
git commit -m "feat(miniapp): order status page with SSE + my-orders list"
```

(Adjust the `git add` paths to whichever files Step 4 actually modified.)

---

## Task 12: Verify formatPrice produces Vietnamese formatting

**Files:**
- Modify (only if needed): `web/src/lib/utils.ts`
- Create: `web/tests/utils.test.ts` (only if not already present)

The Mini App leans on `formatPrice` everywhere. Confirm it produces `1.234.567 ₫` (Vietnamese grouping with `.`, currency suffix). If it already does, this task is a one-line verification; if not, fix it.

- [ ] **Step 1: Inspect**

```bash
cat web/src/lib/utils.ts
```

- [ ] **Step 2: If `formatPrice` does anything else, replace its body with**

```ts
export function formatPrice(amount: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(amount)
}
```

If admin-side code depends on the old format string, leave it alone and add a `formatPriceVi` instead. Pick whichever path doesn't break the admin dashboard.

- [ ] **Step 3: Quick eyeball**

```bash
node -e 'const { formatPrice } = require("./web/src/lib/utils"); console.log(formatPrice(1234567));' 2>&1 | head -5
```

(If running TS via node fails, do it via `cd web && npx ts-node -e ...` or just visit a Mini App page in the browser and confirm the price renders.)

- [ ] **Step 4: Commit (if anything changed)**

```bash
git diff --quiet -- web/src/lib/utils.ts || (git add web/src/lib/utils.ts && git commit -m "fix(web): formatPrice uses vi-VN grouping with VND")
```

---

## Task 13: Smoke run end-to-end + tag

**Files:**
- (none modified) — verification gate

- [ ] **Step 1: Reset DB to imported snapshot if available**

```bash
if [ -f data/db.sqlite.imported ]; then cp data/db.sqlite.imported data/db.sqlite; fi
```

- [ ] **Step 2: Start the dev stack**

```bash
./dev.sh
```

The Node API runs on :3000, Next.js on :3001 (per existing config).

- [ ] **Step 3: Manual checks (browser, then Telegram)**

Browser (devtools open, no Telegram WebApp present):
1. `http://localhost:3001/` → renders the auth-failure banner (no initData). This proves the boundary works.

Bot (real Telegram, against the dev URL via tunnel — set `MINIAPP_URL` to a public HTTPS URL like an ngrok tunnel):
1. `/start` → tap "Mở cửa hàng" → home loads, categories visible.
2. Tap a category → catalog loads, products visible with prices and stock counts.
3. Tap a product → detail page loads, image visible (or emoji fallback).
4. "Thêm vào giỏ" → cart icon updates (or open `/gio-hang` to verify).
5. `/gio-hang` → items, totals correct.
6. "Thanh toán" → loading, then redirect to `/don-hang/<id>`.
7. Order page shows QR + payment code.
8. Manually transfer the exact amount with the exact code via MBBank.
9. Order page status flips to "Đã thanh toán" then "Đã giao" within ~30 s. Keys appear.

If any step fails, capture the failure (browser network tab error, server log, or screenshot) and fix before continuing.

- [ ] **Step 4: Run the automated tests**

```bash
node --test tests/
cd web && npm run build && cd ..
```

Expected: all green; build succeeds.

- [ ] **Step 5: Tag the milestone**

```bash
git tag -a v0.3-miniapp-mvp -m "Mini App MVP: home, catalog, product, cart, checkout, order status (SSE)"
```

- [ ] **Step 6: Hand-back checklist**

```text
Smoke checks:
  1. node --test tests/ → green
  2. cd web && npm run build → success
  3. Bot /start → "Mở cửa hàng" → home renders
  4. Catalog → product → cart → checkout → QR → status flips to delivered
  5. /don-hang shows the new order in the list
```

This concludes sub-project #3. The Mini App is now a usable storefront end-to-end. Ready for sub-projects #4 (geo-block), #5 (custom-info orders), #6 (order chat).

---

## Risks and notes

- **Initial Mini App SSR mismatch.** `useWebApp()` returns null on first render; the layout renders the "Đang khởi tạo…" spinner until the effect runs. If Next is configured for SSR streaming, this will flash. The pattern is intentional — alternative would be `dynamic(..., { ssr: false })` per page, which is heavier. Accept the flash for MVP.
- **CORS on /api/v1/auth/miniapp.** The current `cors` config in `src/api/server.js` allows `WEB_URL` and `localhost:3000/3001`. In production the Mini App is loaded from `https://taikhoantenhat.example.com` and the API is on the same origin (single Next + Node). No extra CORS needed in production; in dev with split ports, the existing config covers it.
- **Telegram WebApp script TTL.** We pin to `?57` (the latest stable as of the spec date). If new SDK features become required (e.g., new BackButton APIs), bump the cache-buster.
- **Multi-line cart.** MVP creates one order per line. If a user adds 3 different products to the cart and checks out, they get 3 separate QRs to pay. This is intentional — the alternative (multi-line orders) needs schema changes belonging to sub-project #5.
- **Image domain in next.config.** If `/uploads/products/...` is served from the same Next.js origin, no `images.domains` config is needed. If product images are served from a CDN later, add the CDN host to `next.config.ts` `images.domains`.
- **EventSource lacks auth.** `EventSource` doesn't support custom headers. The existing `/api/v1/events` is currently unauthenticated. If event scoping by user becomes required (sub-project #6 — chat), introduce a short-lived token query parameter (`?ticket=...`) issued from an authenticated endpoint. Out of scope for MVP since the order page already filters by orderId in the client.
- **Bot sends DM on payment** — when the bot DMs the user about order delivery (sub-project #7), include a deep link `tg://resolve?domain=<bot>&startapp=order_<id>` so tapping the message in Telegram opens the Mini App at the order page. The Mini App should read `start_param` from `initDataUnsafe` and route accordingly. This is a one-line addition to the Mini App layout (route to `/don-hang/<id>` if `start_param` matches `order_<id>`); flag it for sub-project #7's plan.
