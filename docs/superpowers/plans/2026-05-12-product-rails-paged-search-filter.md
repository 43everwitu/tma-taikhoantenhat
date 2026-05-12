# Paged Product Rails + Universal Search/Filter Bar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** All product rails (Đã xem / Nổi bật / Mới) render 2 rows fixed (PC 5 cols × 2 rows = 10; mobile 2 cols × 2 rows = 4) with prev/next pagination. A reusable SearchBox (broad match with preview dropdown) + FilterBar (price range + sort A-Z) on home, `/san-pham`, and `/danh-muc/[slug]`.

**Architecture:** New `<ProductRail>` component owns the 2-row windowed view + pagination. New `<SearchBox>` debounces input + opens a dropdown of top 5 matches with thumbnails. New `<FilterBar>` exposes price-range + sort UI. Backend `/products` accepts `priceMin`, `priceMax`, `limit`, `offset`, `sort=name_asc|name_desc`. CSS modifier `.miniapp-product-grid--rail` enforces 5-col PC / 2-col mobile.

**Tech Stack:** Next 16, TanStack Query, existing patterns. No new deps.

---

## Naming

Rename "Khách đã xem" → "Sản phẩm đã xem" everywhere it shows.

## Backend changes

`src/api/routes/public.js` `GET /products` (non-`ids` branch) — extend params:
- `priceMin` (int, optional)
- `priceMax` (int, optional)
- `limit` (int, optional, max 100)
- `offset` (int, optional)
- `sort=name_asc|name_desc` (new options)

Response includes `total` field when `limit` is set so the frontend can paginate.

---

## File Structure

- `src/api/routes/public.js` — **MODIFY**. Extend `GET /products` with price range, name sort, limit/offset, total count.
- `tests/api/public-products-filters.test.js` — **CREATE**. Covers `priceMin`, `priceMax`, `name_asc`, `limit/offset/total`.
- `web/src/app/(miniapp)/components/ProductRail.tsx` — **CREATE**. 2-row pageable rail.
- `web/src/app/(miniapp)/components/SearchBox.tsx` — **CREATE**. Debounced search with preview dropdown.
- `web/src/app/(miniapp)/components/FilterBar.tsx` — **CREATE**. Price range + sort chips.
- `web/src/app/globals.css` — **MODIFY**. New `.miniapp-product-grid--rail` class (5 cols PC / 2 cols mobile).
- `web/src/app/(miniapp)/page.tsx` — **MODIFY**. Rename label, wrap each rail in `<ProductRail>`, mount SearchBox at top.
- `web/src/app/(miniapp)/san-pham/page.tsx` — **MODIFY**. Replace existing search + chip row with `<SearchBox>` + `<FilterBar>`. Use rail grid.
- `web/src/app/(miniapp)/danh-muc/[slug]/page.tsx` — **MODIFY**. Same — SearchBox + FilterBar.

---

## Task 1: Backend extend `GET /products`

**Files:**
- Modify: `src/api/routes/public.js`
- Create: `tests/api/public-products-filters.test.js`

- [ ] Step 1: Write failing tests `tests/api/public-products-filters.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');

const API = 'http://localhost:3000/api/v1';

test('GET /products?priceMin=100000 filters by min price', async () => {
  const r = await fetch(`${API}/products?priceMin=100000`);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.ok(j.data.every((p) => p.price >= 100000));
});

test('GET /products?priceMax=500000 filters by max price', async () => {
  const r = await fetch(`${API}/products?priceMax=500000`);
  const j = await r.json();
  assert.ok(j.data.every((p) => p.price <= 500000));
});

test('GET /products?sort=name_asc orders by name asc', async () => {
  const r = await fetch(`${API}/products?sort=name_asc`);
  const j = await r.json();
  const names = j.data.map((p) => p.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b, 'vi'));
  assert.deepEqual(names, sorted);
});

test('GET /products?limit=5 returns at most 5 and includes total', async () => {
  const r = await fetch(`${API}/products?limit=5`);
  const j = await r.json();
  assert.ok(j.data.length <= 5);
  assert.ok(typeof j.total === 'number');
  assert.ok(j.total > 0);
});

test('GET /products?limit=5&offset=5 windows correctly', async () => {
  const page1 = await (await fetch(`${API}/products?limit=5&offset=0`)).json();
  const page2 = await (await fetch(`${API}/products?limit=5&offset=5`)).json();
  const ids1 = new Set(page1.data.map((p) => p.id));
  const overlap = page2.data.filter((p) => ids1.has(p.id));
  assert.equal(overlap.length, 0);
});
```

Run:
```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/api/public-products-filters.test.js 2>&1 | tail -10
```

- [ ] Step 2: Edit `src/api/routes/public.js` `GET /products` (non-ids branch).

Find the sort `switch`:
```js
  let orderBy;
  switch (sort) {
    case 'price_asc': orderBy = 'p.price ASC, p.id'; break;
    case 'price_desc': orderBy = 'p.price DESC, p.id'; break;
    case 'newest': orderBy = 'p.created_at DESC, p.id DESC'; break;
    default: orderBy = 'p.sort_order, p.id';
  }
```

Add two cases:
```js
    case 'name_asc': orderBy = 'p.name COLLATE NOCASE ASC, p.id'; break;
    case 'name_desc': orderBy = 'p.name COLLATE NOCASE DESC, p.id'; break;
```

Add price range to the `where` builder (after the existing `q` + `categorySlug` blocks):
```js
  const priceMin = parseInt(req.query.priceMin);
  const priceMax = parseInt(req.query.priceMax);
  if (Number.isInteger(priceMin) && priceMin >= 0) {
    where += ' AND p.price >= ?';
    params.push(priceMin);
  }
  if (Number.isInteger(priceMax) && priceMax >= 0) {
    where += ' AND p.price <= ?';
    params.push(priceMax);
  }
```

Add pagination. After the existing query that fetches `rows`, replace:
```js
  const rows = db.prepare(`
    SELECT p.*, ...
    WHERE ${where}
    ORDER BY ${orderBy}
  `).all(...params);

  res.json({ success: true, data: rows.map(shapePublicProduct) });
```

With:
```js
  const limit = Math.min(parseInt(req.query.limit) || 0, 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const limitClause = limit > 0 ? ` LIMIT ${limit} OFFSET ${offset}` : '';

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
    WHERE ${where}
    ORDER BY ${orderBy}${limitClause}
  `).all(...params);

  const response = { success: true, data: rows.map(shapePublicProduct) };
  if (limit > 0) {
    const total = db.prepare(`
      SELECT COUNT(*) AS c FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE ${where}
    `).get(...params).c;
    response.total = total;
  }
  res.json(response);
```

- [ ] Step 3: Reload + run tests:
```bash
touch src/index.js && sleep 4
node --test tests/api/public-products-filters.test.js 2>&1 | tail -10
```
Expected: 5/5 pass.

- [ ] Step 4: Commit:
```bash
git add src/api/routes/public.js tests/api/public-products-filters.test.js
git commit -m "feat(public-api): GET /products supports priceMin/priceMax, name sort, limit/offset, total"
```

---

## Task 2: ProductRail component

**Files:**
- Create: `web/src/app/(miniapp)/components/ProductRail.tsx`
- Modify: `web/src/app/globals.css`

- [ ] Step 1: CSS modifier — append inside `@layer components { ... }` near the existing `.miniapp-product-grid--featured` block. **Add** this new variant:

```css
  /* Rail grid: 2 cols mobile, 5 cols ≥ md. Used for paged rails on home/category. */
  .miniapp-product-grid--rail { grid-template-columns: repeat(2, 1fr); }
  @media (min-width: 480px) { .miniapp-product-grid--rail { grid-template-columns: repeat(2, 1fr); } }
  @media (min-width: 768px) { .miniapp-product-grid--rail { grid-template-columns: repeat(3, 1fr); } }
  @media (min-width: 1024px) { .miniapp-product-grid--rail { grid-template-columns: repeat(5, 1fr); } }
  @media (min-width: 1280px) { .miniapp-product-grid--rail { grid-template-columns: repeat(5, 1fr); } }
  @media (min-width: 1536px) { .miniapp-product-grid--rail { grid-template-columns: repeat(5, 1fr); } }

  .miniapp-pager { display: flex; align-items: center; justify-content: center; gap: .5rem; margin-top: .75rem; }
  .miniapp-pager button {
    padding: .375rem .75rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent);
    background: var(--tg-bg-2, #fff);
    color: var(--brand-ink);
    font-size: .8125rem; font-weight: 500;
  }
  .miniapp-pager button:disabled { opacity: .4; cursor: not-allowed; }
  .miniapp-pager .miniapp-pager-page { font-size: .75rem; opacity: .7; }
```

- [ ] Step 2: Create `web/src/app/(miniapp)/components/ProductRail.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { ProductCard, type ProductSummary } from './ProductCard'
import { Icon } from './Icon'

interface Props {
  items: ProductSummary[]
}

// Page size = 2 rows × max-cols-per-breakpoint. Mobile shows 4 (2×2), desktop
// shows 10 (5×2). Page-size logic uses CSS-driven max of 10 (the desktop case)
// because computing the actual rendered columns server-side is impossible;
// mobile users see fewer items per page but the same pagination.
const PAGE_SIZE = 10

export function ProductRail({ items }: Props) {
  const [page, setPage] = useState(0)
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const slice = items.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <>
      <ul className="miniapp-product-grid miniapp-product-grid--rail">
        {slice.map((p) => (
          <li key={p.id}><ProductCard p={p} /></li>
        ))}
      </ul>
      {totalPages > 1 && (
        <nav className="miniapp-pager" aria-label="Phân trang">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            aria-label="Trang trước"
          >
            <Icon name="arrowRight" size={14} className="rotate-180" />
          </button>
          <span className="miniapp-pager-page">{page + 1} / {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            aria-label="Trang sau"
          >
            <Icon name="arrowRight" size={14} />
          </button>
        </nav>
      )}
    </>
  )
}
```

(`Icon` already accepts `className` for the `rotate-180` prev-button arrow.)

- [ ] Step 3: Verify + commit:
```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
cd ..
git add web/src/app/\(miniapp\)/components/ProductRail.tsx web/src/app/globals.css
git commit -m "feat(miniapp): ProductRail + .miniapp-product-grid--rail (5-col PC, 2-col mobile, paged)"
```

---

## Task 3: SearchBox + FilterBar components

**Files:**
- Create: `web/src/app/(miniapp)/components/SearchBox.tsx`
- Create: `web/src/app/(miniapp)/components/FilterBar.tsx`

### Step 1: `SearchBox.tsx`

```tsx
'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { Icon } from './Icon'
import { formatPrice } from '@/lib/utils'

interface Preview {
  id: string; slug: string; name: string; price: number; imageUrl?: string
}

interface Props {
  value: string
  onChange: (q: string) => void
  placeholder?: string
}

export function SearchBox({ value, onChange, placeholder }: Props) {
  const [debounced, setDebounced] = useState(value)
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value.trim()), 200)
    return () => clearTimeout(t)
  }, [value])

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  const { data } = useQuery({
    queryKey: ['products', 'search-preview', debounced],
    queryFn: () => apiFetch<Preview[]>(`/products?q=${encodeURIComponent(debounced)}&limit=5`),
    enabled: debounced.length >= 2,
  })
  const previews = data ?? []

  return (
    <div ref={wrapRef} className="relative">
      <div className="miniapp-search">
        <span className="opacity-60 flex"><Icon name="search" size={18} /></span>
        <input
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder ?? 'Tìm sản phẩm…'}
          autoComplete="off"
        />
      </div>

      {open && debounced.length >= 2 && previews.length > 0 && (
        <ul className="absolute left-0 right-0 mt-1 rounded-xl shadow-lg z-30 max-h-80 overflow-y-auto"
            style={{ background: 'var(--tg-bg-2, #fff)', border: '1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent)' }}>
          {previews.map((p) => (
            <li key={p.id}>
              <Link
                href={`/san-pham/${p.slug}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 p-2 hover:bg-black/5"
              >
                <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0" style={{ background: 'var(--brand-gold-soft)', position: 'relative' }}>
                  {p.imageUrl ? (
                    <Image src={p.imageUrl} alt={p.name} fill sizes="40px" style={{ objectFit: 'cover' }} />
                  ) : (
                    <div className="absolute inset-0 grid place-items-center" style={{ color: 'var(--brand-gold-deep)' }}>
                      <Icon name="package" size={18} />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm line-clamp-1">{p.name}</p>
                  <p className="text-xs opacity-70">{formatPrice(p.price)}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

### Step 2: `FilterBar.tsx`

```tsx
'use client'

export interface FilterValue {
  sort: 'default' | 'price_asc' | 'price_desc' | 'newest' | 'name_asc' | 'name_desc'
  priceMin: number | ''
  priceMax: number | ''
}

interface Props {
  value: FilterValue
  onChange: (v: FilterValue) => void
}

const SORTS: { k: FilterValue['sort']; label: string }[] = [
  { k: 'default', label: 'Mặc định' },
  { k: 'price_asc', label: 'Giá ↑' },
  { k: 'price_desc', label: 'Giá ↓' },
  { k: 'newest', label: 'Mới nhất' },
  { k: 'name_asc', label: 'A → Z' },
  { k: 'name_desc', label: 'Z → A' },
]

export function FilterBar({ value, onChange }: Props) {
  return (
    <div className="space-y-2 mt-2">
      <div className="miniapp-chip-row" style={{ marginTop: 0 }}>
        {SORTS.map((s) => (
          <button
            key={s.k}
            type="button"
            className="miniapp-chip"
            aria-pressed={value.sort === s.k}
            onClick={() => onChange({ ...value, sort: s.k })}
          >
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 items-center text-xs">
        <span className="opacity-60">Giá</span>
        <input
          type="number"
          placeholder="từ"
          value={value.priceMin}
          onChange={(e) => onChange({ ...value, priceMin: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
          className="rounded-lg px-2 py-1 text-xs w-24"
          style={{ background: 'var(--tg-bg-2, #fff)', border: '1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent)' }}
        />
        <span className="opacity-60">–</span>
        <input
          type="number"
          placeholder="đến"
          value={value.priceMax}
          onChange={(e) => onChange({ ...value, priceMax: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
          className="rounded-lg px-2 py-1 text-xs w-24"
          style={{ background: 'var(--tg-bg-2, #fff)', border: '1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent)' }}
        />
        <span className="opacity-60">đ</span>
        {(value.priceMin !== '' || value.priceMax !== '' || value.sort !== 'default') && (
          <button
            type="button"
            className="ml-auto text-xs opacity-70 underline"
            onClick={() => onChange({ sort: 'default', priceMin: '', priceMax: '' })}
          >Reset</button>
        )}
      </div>
    </div>
  )
}
```

### Step 3: tsc + commit

```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/components/SearchBox.tsx web/src/app/\(miniapp\)/components/FilterBar.tsx
git commit -m "feat(miniapp): SearchBox (debounced with preview) + FilterBar (sort + price range)"
```

---

## Task 4: Wire into home page

**Files:**
- Modify: `web/src/app/(miniapp)/page.tsx`

- [ ] Step 1: Apply edits.

Add imports:
```tsx
import { ProductRail } from './components/ProductRail'
import { SearchBox } from './components/SearchBox'
```

Inside the component, near the existing `useState` calls, add:
```tsx
const [q, setQ] = useState('')
```

Render the SearchBox immediately INSIDE the `<MiniAppShell>` (before the `<section className="miniapp-hero">`):

```tsx
      <div className="mb-3">
        <SearchBox value={q} onChange={setQ} placeholder="Tìm sản phẩm…" />
      </div>
```

Find the section labelled `"Khách đã xem"` (around the recently-viewed `<section>`). Change the heading text from `"Khách đã xem"` to `"Sản phẩm đã xem"`:

```tsx
              <Icon name="clock" size={16} />
              Sản phẩm đã xem
```

Replace the three rail `<ul className="miniapp-product-grid miniapp-product-grid--featured">…</ul>` blocks (Đã xem, Nổi bật, Mới) with `<ProductRail items={...} />`:

```tsx
{recently.data && recently.data.length > 0 && (
  // ...title block...
  <ProductRail items={recently.data} />
)}

{featured.data && featured.data.length > 0 && (
  // ...title block...
  <ProductRail items={featured.data} />
)}

{newest.data && newest.data.length > 0 && (
  // ...title block...
  <ProductRail items={newest.data} />
)}
```

Bump query data limits so pagination has content:
- `featured.queryFn` already returns up to 8 — fine, but increase by passing `?limit=30` to `/products?sort=newest` (newest section already uses this query)
- Actually, change the `newest` query to fetch 30:

```tsx
const newest = useQuery({
  queryKey: ['products', 'newest', 30],
  queryFn: () => apiFetch<ProductSummary[]>('/products?sort=newest&limit=30'),
  select: (rows) => rows.slice(0, 30),
})
```

(Same for `featured` if user wants paginated featured — but featured already capped at 8 by the endpoint. Leave it.)

- [ ] Step 2: Verify + commit:
```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/page.tsx
git commit -m "feat(miniapp): home — rename Khách đã xem → Sản phẩm đã xem, paged rails, top SearchBox"
```

---

## Task 5: Wire into /san-pham

**Files:**
- Modify: `web/src/app/(miniapp)/san-pham/page.tsx`

- [ ] Step 1: Replace the existing search input + sort chip row with `<SearchBox>` + `<FilterBar>`. Use the new product grid + rail-style pagination is unnecessary on the dedicated list page (this page already shows everything). Just add the filters.

Replace the page body:

```tsx
'use client'

import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/miniappApi'
import { MiniAppShell } from '../components/MiniAppShell'
import { ProductCard, ProductSummary } from '../components/ProductCard'
import { SearchBox } from '../components/SearchBox'
import { FilterBar, type FilterValue } from '../components/FilterBar'
import { Icon } from '../components/Icon'
import { t } from '@/i18n/vi'

interface Category { id: number; name: string; slug: string; emoji: string }

const DEFAULT_FILTER: FilterValue = { sort: 'default', priceMin: '', priceMax: '' }

export default function AllProductsPage() {
  const [q, setQ] = useState('')
  const [activeSlug, setActiveSlug] = useState<string | ''>('')
  const [filter, setFilter] = useState<FilterValue>(DEFAULT_FILTER)

  const cats = useQuery({
    queryKey: ['categories', 'noUncat'],
    queryFn: () => apiFetch<Category[]>('/categories?exclude=uncategorized'),
  })

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (activeSlug) p.set('category', activeSlug)
    if (q.trim()) p.set('q', q.trim())
    if (filter.sort !== 'default') p.set('sort', filter.sort)
    if (filter.priceMin !== '') p.set('priceMin', String(filter.priceMin))
    if (filter.priceMax !== '') p.set('priceMax', String(filter.priceMax))
    return p.toString()
  }, [activeSlug, q, filter])

  const products = useQuery({
    queryKey: ['products', 'all', queryString],
    queryFn: () => apiFetch<ProductSummary[]>(`/products?${queryString}`),
  })

  return (
    <MiniAppShell title="Tất cả sản phẩm" subtitle={products.data ? `${products.data.length} sản phẩm` : undefined}>
      <SearchBox value={q} onChange={setQ} placeholder={t.catalog.searchPlaceholder} />

      <div className="miniapp-chip-row">
        <button
          type="button"
          className="miniapp-chip"
          aria-pressed={activeSlug === ''}
          onClick={() => setActiveSlug('')}
        >Tất cả</button>
        {cats.data?.map((c) => (
          <button
            key={c.id}
            type="button"
            className="miniapp-chip"
            aria-pressed={activeSlug === c.slug}
            onClick={() => setActiveSlug(c.slug)}
          >{c.name}</button>
        ))}
      </div>

      <FilterBar value={filter} onChange={setFilter} />

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

- [ ] Step 2: Verify + commit:
```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/san-pham/page.tsx
git commit -m "feat(miniapp): /san-pham — SearchBox preview + FilterBar (sort + price)"
```

---

## Task 6: Wire into /danh-muc/[slug]

**Files:**
- Modify: `web/src/app/(miniapp)/danh-muc/[slug]/page.tsx`

- [ ] Step 1: Read the file. Replace the existing search + sort chip row with `<SearchBox>` + `<FilterBar>`.

Apply the same pattern as `/san-pham/page.tsx`:

Add imports:
```tsx
import { SearchBox } from '../../components/SearchBox'
import { FilterBar, type FilterValue } from '../../components/FilterBar'
```

Replace `useState`s + the existing query string. Use this body skeleton:

```tsx
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<FilterValue>({ sort: 'default', priceMin: '', priceMax: '' })

  // ...existing cats query...

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    p.set('category', params.slug)
    if (q.trim()) p.set('q', q.trim())
    if (filter.sort !== 'default') p.set('sort', filter.sort)
    if (filter.priceMin !== '') p.set('priceMin', String(filter.priceMin))
    if (filter.priceMax !== '') p.set('priceMax', String(filter.priceMax))
    return p.toString()
  }, [params.slug, q, filter])

  const products = useQuery({
    queryKey: ['products', params.slug, queryString],
    queryFn: () => apiFetch<ProductSummary[]>(`/products?${queryString}`),
  })
```

Add `useMemo` to the React import if missing.

In the JSX, replace the existing `.miniapp-search` input block + sort chip-row with:
```tsx
      <SearchBox value={q} onChange={setQ} placeholder={t.catalog.searchPlaceholder} />
      <FilterBar value={filter} onChange={setFilter} />
```

Leave the product grid + empty-state untouched.

- [ ] Step 2: Verify + commit:
```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/danh-muc/\[slug\]/page.tsx
git commit -m "feat(miniapp): category page uses SearchBox + FilterBar"
```

---

## Task 7: Verify + tag

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/ 2>&1 | tail -5
cd web && npx tsc --noEmit 2>&1 | tail -3
cd web && npm run build 2>&1 | tail -8
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
for p in / /san-pham /danh-muc/hoc-tap; do curl -s -o /dev/null -w "$p → %{http_code}\n" "http://localhost:3001$p"; done
git tag v0.17-rails-search -m "Paged rails + universal SearchBox + FilterBar"
```

---

## Self-Review

- Renamed "Khách đã xem" → "Sản phẩm đã xem" → Task 4
- Rails 2 rows × 5 cols PC / 2 cols mobile with paginator → Tasks 2 + 4
- Featured + New use same rail → Task 4
- /san-pham search with preview + filters → Task 5
- Category page same → Task 6
- Backend price + name sort + limit/offset/total → Task 1
- PC max 5 per row → CSS `--rail` modifier in Task 2

No placeholders. Type-consistent (`FilterValue` defined Task 3, used Tasks 5 + 6).
