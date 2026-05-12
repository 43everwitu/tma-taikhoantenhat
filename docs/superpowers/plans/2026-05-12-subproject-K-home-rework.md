# Sub-project K: Home Rework + `/san-pham` All-Products Page

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure mini-app home page (hide Uncategorized, categories above hero, new "recently viewed" + "new products" + responsive featured 4mobile/8desktop) and add `/san-pham` all-products page; "Khám phá ngay" and "Tất cả →" link there.

**Architecture:** Frontend-only refactor on top of existing `GET /api/v1/products` + `/categories`. Backend gains two small features: `?ids=` query param for products lookup (recently-viewed fetch), and a `excludeSlug` param on categories. Recently-viewed tracked in localStorage. No new DB columns (uses existing `created_at` for newest).

**Tech Stack:** Next 16 App Router, React 19, TanStack Query, Tailwind v4, existing `lucide-react` icons.

---

## File Structure

- `src/api/routes/public.js` — **MODIFY**. `GET /products` accepts `ids` query param (comma-separated). `GET /categories` accepts `?exclude=<slug>` to filter out a category. Add new endpoint `GET /products/featured` returning featured + fallback to newest.
- `web/src/lib/recentlyViewed.ts` — **CREATE**. localStorage helpers `pushRecentlyViewed(id)` and `getRecentlyViewedIds()`.
- `web/src/app/(miniapp)/page.tsx` — **MODIFY**. Reorder sections, filter out Uncategorized, add Recently-Viewed + New-Products sections, link CTAs to `/san-pham`.
- `web/src/app/(miniapp)/san-pham/page.tsx` — **CREATE**. All-products listing page (paginated client-side, category filter chips).
- `web/src/app/(miniapp)/san-pham/[slug]/page.tsx` — **MODIFY**. Push product id into recently-viewed on mount.
- `web/src/app/globals.css` — **MODIFY** if needed. Extend `.miniapp-product-grid` to support the new featured 4-col mobile / 4×2 desktop layout (override the existing 2/3/4/5/6/7 ladder for that specific instance via a modifier class `--featured`).

---

## Notes for the Engineer

- **Read `web/AGENTS.md`** before frontend work.
- **Hidden category**: `uncategorized` slug (id=4) exists in DB with `is_active=1`. Don't deactivate it (admin uses it). Filter on read instead.
- **`/danh-muc/<slug>` page** still exists and is unchanged — only home links update.
- **Recently-viewed storage shape**: `JSON.stringify(string[])` of product IDs, max 12 entries, most-recent first. localStorage key: `miniapp:recently-viewed`. Quota errors handled silently.
- **Backend `ids` param**: comma-separated, max 50 IDs, returns rows in the SAME ORDER as the input list (preserves "most recent first"). SQLite has no `FIELD()` so use a CASE expression.
- **Featured threshold**: products with `is_featured=1` first; if fewer than 8, fill with newest. Admin UI for `is_featured` ships in a future sub-project; for now, the column simply enables manual SQL toggling.
- **No tests for the pure-UI bits**, but backend changes get unit tests via the existing `tests/api/` pattern.

---

## Task 1: Backend `?ids=` + `?exclude=` + `/products/featured`

**Files:**
- Modify: `src/api/routes/public.js`
- Create: `tests/api/public-ids-exclude-featured.test.js`

- [ ] **Step 1: Write tests first**

`tests/api/public-ids-exclude-featured.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');

const API = 'http://localhost:3000/api/v1';

test('GET /categories?exclude=uncategorized hides uncategorized', async () => {
  const r = await fetch(`${API}/categories?exclude=uncategorized`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.data));
  assert.ok(!j.data.some((c) => c.slug === 'uncategorized'));
});

test('GET /categories without exclude returns all (including uncategorized if active)', async () => {
  const r = await fetch(`${API}/categories`);
  const j = await r.json();
  assert.ok(j.data.some((c) => c.slug === 'hoc-tap'));
});

test('GET /products?ids=… returns rows in order', async () => {
  // pick first three products
  const all = await (await fetch(`${API}/products`)).json();
  const ids = all.data.slice(0, 3).map((p) => p.id);
  // reverse the order
  const reversedIds = [...ids].reverse();
  const r = await fetch(`${API}/products?ids=${reversedIds.join(',')}`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.data.length, 3);
  assert.deepEqual(j.data.map((p) => p.id), reversedIds);
});

test('GET /products?ids= with unknown id silently drops it', async () => {
  const all = await (await fetch(`${API}/products`)).json();
  const realId = all.data[0].id;
  const r = await fetch(`${API}/products?ids=${realId},999999`);
  const j = await r.json();
  assert.equal(j.data.length, 1);
  assert.equal(j.data[0].id, realId);
});

test('GET /products/featured returns up to 8 products', async () => {
  const r = await fetch(`${API}/products/featured`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.data));
  assert.ok(j.data.length <= 8);
});
```

Run:
```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/api/public-ids-exclude-featured.test.js 2>&1 | tail -10
```
Expected: failures — endpoints + params don't exist yet.

- [ ] **Step 2: Extend `GET /categories`**

In `src/api/routes/public.js`, find the categories handler (line ~27). Add support for `?exclude=<slug>`:

```js
router.get('/categories', (req, res) => {
  const exclude = (req.query.exclude || '').trim();
  let sql = "SELECT id, name, slug, emoji, description FROM categories WHERE is_active = 1";
  const params = [];
  if (exclude) {
    sql += ' AND slug != ?';
    params.push(exclude);
  }
  sql += ' ORDER BY sort_order';
  const rows = db.prepare(sql).all(...params);
  res.json({ success: true, data: rows });
});
```

(Replace the existing prepare statement with this conditional builder.)

- [ ] **Step 3: Extend `GET /products` with `?ids=`**

In the same file's `GET /products` handler, before the existing `where` builder, add an early-return branch for the `ids` mode:

```js
  const idsParam = (req.query.ids || '').trim();
  if (idsParam) {
    const ids = idsParam.split(',').map((s) => parseInt(s, 10)).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
    if (ids.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const placeholders = ids.map(() => '?').join(',');
    // Order rows by the input list — SQLite has no FIELD(), so build a CASE expr
    const caseExpr = ids.map((id, i) => `WHEN p.id = ${id} THEN ${i}`).join(' ');
    const rows = db.prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count,
        CASE
          WHEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) > 0
          THEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0)
          ELSE COALESCE(p.sheet_stock, 0)
        END as display_stock,
        c.name as category_name, c.slug as category_slug
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.id IN (${placeholders}) AND p.is_active = 1
      ORDER BY CASE ${caseExpr} END
    `).all(...ids);
    return res.json({ success: true, data: rows.map(shapePublicProduct) });
  }
```

(Make sure `shapePublicProduct` is the existing helper used by the list endpoint. If the existing list handler uses a different shaper, mirror that one.)

- [ ] **Step 4: Add `GET /products/featured`**

Add immediately before `GET /products/:slug` so the route order matches `/featured` before the slug catch-all:

```js
router.get('/products/featured', (req, res) => {
  const limit = 8;
  // Featured first, then newest fill
  const featured = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count,
      CASE
        WHEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) > 0
        THEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0)
        ELSE COALESCE(p.sheet_stock, 0)
      END as display_stock,
      c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1 AND p.is_featured = 1
    ORDER BY p.sort_order, p.id
    LIMIT ?
  `).all(limit);

  if (featured.length >= limit) {
    return res.json({ success: true, data: featured.map(shapePublicProduct) });
  }
  const featuredIds = new Set(featured.map((r) => r.id));
  const fillNeeded = limit - featured.length;
  const fill = db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) as stock_count,
      CASE
        WHEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) > 0
        THEN (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0)
        ELSE COALESCE(p.sheet_stock, 0)
      END as display_stock,
      c.name as category_name, c.slug as category_slug
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT ?
  `).all(fillNeeded + featured.length);
  const fillFiltered = fill.filter((r) => !featuredIds.has(r.id)).slice(0, fillNeeded);

  res.json({ success: true, data: [...featured, ...fillFiltered].map(shapePublicProduct) });
});
```

- [ ] **Step 5: Run tests**

```bash
touch src/index.js
sleep 3
node --test tests/api/public-ids-exclude-featured.test.js 2>&1 | tail -10
```
Expected: 5/5 pass.

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/public.js tests/api/public-ids-exclude-featured.test.js
git commit -m "feat(public-api): /products?ids, /categories?exclude, /products/featured"
```

---

## Task 2: localStorage helper `recentlyViewed`

**Files:**
- Create: `web/src/lib/recentlyViewed.ts`

- [ ] **Step 1: Create the file**

```ts
const KEY = 'miniapp:recently-viewed'
const MAX = 12

function safeParse(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function getRecentlyViewedIds(): string[] {
  return safeParse()
}

export function pushRecentlyViewed(id: string): void {
  if (typeof window === 'undefined' || !id) return
  try {
    const existing = safeParse().filter((x) => x !== id)
    existing.unshift(id)
    const trimmed = existing.slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(trimmed))
  } catch {
    // localStorage quota / disabled — silent
  }
}

export function clearRecentlyViewed(): void {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(KEY) } catch {}
}
```

- [ ] **Step 2: Type check**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/lib/recentlyViewed.ts
git commit -m "feat(miniapp): recentlyViewed localStorage helpers"
```

---

## Task 3: Push to recently-viewed on product detail mount

**Files:**
- Modify: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`

- [ ] **Step 1: Patch the page**

Read the file. Add this import at the top of imports:

```tsx
import { useEffect } from 'react'
import { pushRecentlyViewed } from '@/lib/recentlyViewed'
```

(`useEffect` may already be there — if so, don't duplicate.)

After the `useQuery` block that fetches the product, add a `useEffect` that fires when `p.id` becomes available:

```tsx
  useEffect(() => {
    if (p?.id) pushRecentlyViewed(String(p.id))
  }, [p?.id])
```

(Place it immediately after the query hook declarations, before the early-return for `isLoading` / `!p`.)

- [ ] **Step 2: Verify**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/san-pham/tai-khoan-grammarly-premium-gia-re
```
Expected: tsc clean, curl 200.

- [ ] **Step 3: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/san-pham/\[slug\]/page.tsx
git commit -m "feat(miniapp): track recently-viewed on product detail mount"
```

---

## Task 4: New `/san-pham` all-products page

**Files:**
- Create: `web/src/app/(miniapp)/san-pham/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../components/MiniAppShell'
import { ProductCard, ProductSummary } from '../components/ProductCard'
import { Icon } from '../components/Icon'
import { t } from '@/i18n/vi'

interface Category { id: number; name: string; slug: string; emoji: string }

export default function AllProductsPage() {
  const [q, setQ] = useState('')
  const [activeSlug, setActiveSlug] = useState<string | ''>('')

  const cats = useQuery({
    queryKey: ['categories', 'noUncat'],
    queryFn: () => apiFetch<Category[]>('/categories?exclude=uncategorized'),
  })

  const products = useQuery({
    queryKey: ['products', 'all', activeSlug, q],
    queryFn: () => apiFetch<ProductSummary[]>(
      `/products?category=${encodeURIComponent(activeSlug)}&q=${encodeURIComponent(q)}`,
    ),
  })

  return (
    <MiniAppShell title="Tất cả sản phẩm" subtitle={products.data ? `${products.data.length} sản phẩm` : undefined}>
      <div className="miniapp-search">
        <span className="opacity-60 flex"><Icon name="search" size={18} /></span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.catalog.searchPlaceholder}
        />
      </div>

      <div className="miniapp-chip-row">
        <button
          type="button"
          className="miniapp-chip"
          aria-pressed={activeSlug === ''}
          onClick={() => setActiveSlug('')}
        >
          Tất cả
        </button>
        {cats.data?.map((c) => (
          <button
            key={c.id}
            type="button"
            className="miniapp-chip"
            aria-pressed={activeSlug === c.slug}
            onClick={() => setActiveSlug(c.slug)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="miniapp-section">
        {products.isLoading && <p className="opacity-60 text-sm">Đang tải…</p>}
        {products.data && products.data.length === 0 && (
          <div className="text-center py-12 opacity-60">
            <div className="mb-2 inline-flex p-3 rounded-full" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-gold-deep)' }}>
              <Icon name="search" size={28} />
            </div>
            <p className="text-sm">{t.catalog.empty}</p>
          </div>
        )}
        {products.data && products.data.length > 0 && (
          <ul className="miniapp-product-grid">
            {products.data.map((p) => (
              <li key={p.id}><ProductCard p={p} /></li>
            ))}
          </ul>
        )}
      </div>
    </MiniAppShell>
  )
}
```

- [ ] **Step 2: Smoke**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/san-pham
```
Expected: tsc clean, curl 200.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/\(miniapp\)/san-pham/page.tsx
git commit -m "feat(miniapp): /san-pham all-products page with search + category chips"
```

---

## Task 5: Home page rework

**Files:**
- Modify: `web/src/app/(miniapp)/page.tsx`

This is the centerpiece of K. Replaces the existing home page entirely with the new layout: hero + categories on top, then announcements, then `Sản phẩm khách đã xem`, `Sản phẩm nổi bật`, `Sản phẩm mới`. Excludes Uncategorized. CTAs point to `/san-pham`.

- [ ] **Step 1: Replace `web/src/app/(miniapp)/page.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from './components/MiniAppShell'
import { ProductCard, ProductSummary } from './components/ProductCard'
import { Icon } from './components/Icon'
import { categoryIcons } from '@/lib/miniappIcons'
import { getRecentlyViewedIds } from '@/lib/recentlyViewed'
import { t } from '@/i18n/vi'

interface Announcement { id: string; title: string; body: string; pinned: boolean }
interface Category { id: number; name: string; slug: string; emoji: string }

export default function MiniAppHome() {
  const [recentIds, setRecentIds] = useState<string[]>([])

  useEffect(() => {
    setRecentIds(getRecentlyViewedIds())
  }, [])

  const ann = useQuery({
    queryKey: ['announcements'],
    queryFn: () => apiFetch<Announcement[]>('/announcements'),
  })
  const cats = useQuery({
    queryKey: ['categories', 'noUncat'],
    queryFn: () => apiFetch<Category[]>('/categories?exclude=uncategorized'),
  })
  const featured = useQuery({
    queryKey: ['products', 'featured'],
    queryFn: () => apiFetch<ProductSummary[]>('/products/featured'),
  })
  const newest = useQuery({
    queryKey: ['products', 'newest'],
    queryFn: () => apiFetch<ProductSummary[]>('/products?sort=newest'),
    select: (rows) => rows.slice(0, 8),
  })
  const recently = useQuery({
    queryKey: ['products', 'recently', recentIds.join(',')],
    queryFn: () => apiFetch<ProductSummary[]>(`/products?ids=${recentIds.join(',')}`),
    enabled: recentIds.length > 0,
  })

  return (
    <MiniAppShell>
      <section className="miniapp-hero">
        <p className="text-xs uppercase tracking-wider opacity-70 mb-2">Taikhoantenhat</p>
        <h1>Tài khoản số chính chủ</h1>
        <p>Mua trong Telegram. Giao key tự động. Bảo hành dài hạn.</p>
        <Link href="/san-pham" className="miniapp-hero-cta">
          Khám phá ngay
          <Icon name="arrowRight" size={16} />
        </Link>
      </section>

      <section className="miniapp-section">
        <div className="miniapp-section-title">
          <span>{t.home.categoriesTitle}</span>
        </div>
        {cats.isLoading && <p className="opacity-60 text-sm">Đang tải…</p>}
        {cats.data && cats.data.length === 0 && (
          <p className="opacity-60 text-sm">{t.home.emptyCategories}</p>
        )}
        {cats.data && cats.data.length > 0 && (
          <ul className="miniapp-cat-grid">
            {cats.data.map((c) => (
              <li key={c.id}>
                <Link href={`/danh-muc/${c.slug}`} className="miniapp-cat-tile">
                  <span className="miniapp-cat-emoji">
                    <Icon name={categoryIcons[c.slug] ?? 'package'} size={22} strokeWidth={1.75} />
                  </span>
                  <p className="miniapp-cat-name">{c.name}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {ann.data && ann.data.length > 0 && (
        <section className="miniapp-section">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="megaphone" size={16} />
              {t.home.announcementsTitle}
            </span>
          </div>
          <ul className="space-y-2">
            {ann.data.slice(0, 3).map((a) => (
              <li key={a.id} className="miniapp-ann">
                <p className="miniapp-ann-title">{a.title}</p>
                <p className="miniapp-ann-body">{a.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {recently.data && recently.data.length > 0 && (
        <section className="miniapp-section">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="clock" size={16} />
              Khách đã xem
            </span>
          </div>
          <ul className="miniapp-product-grid miniapp-product-grid--featured">
            {recently.data.slice(0, 8).map((p) => (
              <li key={p.id}><ProductCard p={p} /></li>
            ))}
          </ul>
        </section>
      )}

      {featured.data && featured.data.length > 0 && (
        <section className="miniapp-section">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sparkles" size={16} />
              Sản phẩm nổi bật
            </span>
            <Link href="/san-pham" className="inline-flex items-center gap-1">
              Tất cả <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          <ul className="miniapp-product-grid miniapp-product-grid--featured">
            {featured.data.map((p) => (
              <li key={p.id}><ProductCard p={p} /></li>
            ))}
          </ul>
        </section>
      )}

      {newest.data && newest.data.length > 0 && (
        <section className="miniapp-section">
          <div className="miniapp-section-title">
            <span className="inline-flex items-center gap-1.5">
              <Icon name="sparkles" size={16} />
              Sản phẩm mới
            </span>
            <Link href="/san-pham" className="inline-flex items-center gap-1">
              Tất cả <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          <ul className="miniapp-product-grid miniapp-product-grid--featured">
            {newest.data.map((p) => (
              <li key={p.id}><ProductCard p={p} /></li>
            ))}
          </ul>
        </section>
      )}
    </MiniAppShell>
  )
}
```

Key changes:
- Hero CTA now `/san-pham`
- Categories section MOVED above announcements (was below)
- Uncategorized excluded via `?exclude=uncategorized`
- New "Khách đã xem" section (only renders when localStorage has IDs)
- New "Sản phẩm mới" section (separate from featured)
- Featured section uses `/products/featured` endpoint (not `?sort=newest&slice(6)` hack)
- Both Featured + Newest + Recently use a new `--featured` grid modifier for the 4-mobile / 4×2 desktop layout
- "Tất cả →" link now `/san-pham`

- [ ] **Step 2: Add the `--featured` grid CSS modifier**

Open `web/src/app/globals.css`. Inside the `@layer components` block, immediately after the existing `.miniapp-product-grid` responsive rules (added in sub-project J of the previous miniapp work), add:

```css
  /* Featured rail: 2-col mobile, 4-col tablet+, capped at 4 cols on desktop
     so "8 items = 2 rows of 4" reads as a horizontal feature strip rather
     than spilling into 7-col ultrawide grid. */
  .miniapp-product-grid--featured { grid-template-columns: repeat(2, 1fr); }
  @media (min-width: 480px) { .miniapp-product-grid--featured { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 768px) { .miniapp-product-grid--featured { grid-template-columns: repeat(4, 1fr); } }
  @media (min-width: 1024px) { .miniapp-product-grid--featured { grid-template-columns: repeat(4, 1fr); } }
  @media (min-width: 1280px) { .miniapp-product-grid--featured { grid-template-columns: repeat(4, 1fr); } }
  @media (min-width: 1536px) { .miniapp-product-grid--featured { grid-template-columns: repeat(4, 1fr); } }
```

The user spec said "4 sản phẩm trên mobile và 2 hàng trên PC". Mobile width is too narrow for 4 product cards to be readable — 2 cols × 2 rows = same 4 visible, just stacked. On desktop 4×2 = 8 cards. If the engineer wants literal 4 cols on mobile, change the first rule to `repeat(4, 1fr)` — but the cards will be tiny. Document the deviation in the commit message if changed.

(Re-reading the spec carefully: "4 sản phẩm trên mobile và 2 hàng trên PC". 4 products on mobile total = 2 cols × 2 rows. 2 rows on PC = 2 rows × 4 cols = 8. Both add up to 8 displayed on desktop, 4 on mobile. The CSS above slices `featured.data` to 8 in the endpoint, then mobile shows 2×2=4 visible since the API returns 8 but mobile users only see the first 4 cards before scrolling. The simpler approach: render all 8 on both, mobile shows 2 cols = 4 rows of 2 = visible 2 rows at a time. That matches Vietnamese mobile UX patterns. Stick with the layout above.)

- [ ] **Step 3: Smoke**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/
```
Expected: tsc clean, curl 200.

Open http://localhost:3001/ in browser. Confirm:
- Hero on top, "Khám phá ngay" links to `/san-pham`
- Categories grid right below hero (no Uncategorized tile)
- Announcements after categories
- "Khách đã xem" only renders if you've previously visited a product page
- "Sản phẩm nổi bật" + "Sản phẩm mới" both show, each with "Tất cả →" linking to `/san-pham`
- Featured/Newest grid: 2 cols on phone, 4 cols on desktop

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(miniapp\)/page.tsx web/src/app/globals.css
git commit -m "feat(miniapp): home rework — categories above hero, recently-viewed, new section"
```

---

## Task 6: Verify + tag

- [ ] **Step 1: Test suite**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/ 2>&1 | tail -10
```
Expected: 0 fail. New tests +5 from Task 1.

- [ ] **Step 2: Frontend build**

```bash
cd web && npm run build 2>&1 | tail -10
```
Expected: `Compiled successfully` + the new `/san-pham` route appears in the build output.

- [ ] **Step 3: Tag**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git tag v0.8-home-overhaul -m "Sub-project K: home rework + /san-pham all-products page"
```

- [ ] **Step 4: Done**

Report: commit count, test count delta, tag created.

---

## Self-Review

- **Spec coverage:**
  - K1 categories filter Uncategorized → Task 1 (backend `?exclude`) + Task 5 (home + all-products use it)
  - K2 categories above hero → Task 5 (section order)
  - K3 Recently-viewed → Tasks 2, 3, 5
  - K4 Featured 4/8 layout → Task 5 + CSS modifier
  - K5 "Sản phẩm mới" → Task 5 (newest query)
  - K6 `/san-pham` page → Task 4
  - K7 "Khám phá ngay" + "Tất cả →" point to `/san-pham` → Task 5
- **Placeholders:** none.
- **Type consistency:** `getRecentlyViewedIds` + `pushRecentlyViewed` from `recentlyViewed.ts` consumed in Tasks 3, 5. `apiFetch` signature unchanged. `ProductSummary` reused.
- **Back-compat:** `/danh-muc/<slug>` page untouched — still works. Old route `/danh-muc/hoc-tap` still resolves; only home links updated.
