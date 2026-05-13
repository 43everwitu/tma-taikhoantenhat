# Rail Slider + Filter + Search Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mini App UX polish — horizontal product rails with arrows, category strip slider, compact filter dropdown, better price UX, fix search-input screen shake.

**Architecture:** Add reusable `<HScroll>` primitive (scroll-snap + arrow buttons). Refactor `ProductRail` to drop pagination → single horizontal track. New `CategoryStrip` replaces home grid. `FilterBar` rebuilt as compact bar + popover dropdown with preset price chips. CSS one-liner fixes search shake.

**Tech Stack:** Next 16 App Router, React 19, Tailwind, plain CSS in `globals.css`, lucide-react Icon component.

**Spec reference:** `docs/superpowers/specs/2026-05-13-rail-slider-filter-search-polish-design.md`

---

### Task 1: Fix search shake (scrollbar-gutter)

**Files:**
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add `scrollbar-gutter: stable` to html**

Locate the `html` selector in `globals.css` (or add new rule near top of `@layer base` or root scope). Add:

```css
html { scrollbar-gutter: stable; }
```

If `html` already has a rule, add the property to it. Otherwise insert a new rule near top of file, before existing component classes.

- [ ] **Step 2: Verify in browser**

Hard refresh `http://localhost:3001`. Type characters into the search box on home. Confirm no horizontal page shake. Check that scrollbar gutter is reserved (right-side padding stable whether content overflows vertically or not).

- [ ] **Step 3: Commit**

```bash
git add web/src/app/globals.css
git commit -m "fix(miniapp): reserve scrollbar gutter to eliminate search input shake"
```

---

### Task 2: Create HScroll primitive

**Files:**
- Create: `web/src/app/(miniapp)/components/HScroll.tsx`
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add CSS for hscroll container + arrows**

Append to `web/src/app/globals.css` in the same `@layer components` block (or top-level if no layer) where `.miniapp-*` classes live:

```css
.miniapp-hscroll {
  position: relative;
}
.miniapp-hscroll-track {
  display: flex;
  gap: .75rem;
  overflow-x: auto;
  scroll-snap-type: x mandatory;
  scroll-behavior: smooth;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding-bottom: .25rem;
}
.miniapp-hscroll-track::-webkit-scrollbar { display: none; }
.miniapp-hscroll-track > * { scroll-snap-align: start; }
@media (min-width: 768px) {
  .miniapp-hscroll-track { gap: 1rem; }
}
.miniapp-hscroll-arrow {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 5;
  width: 36px;
  height: 36px;
  display: none;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--tg-bg-2, #fff);
  border: 1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent);
  box-shadow: 0 4px 12px color-mix(in srgb, var(--brand-ink) 18%, transparent);
  color: var(--brand-ink);
  cursor: pointer;
  transition: opacity .15s, transform .15s;
}
.miniapp-hscroll-arrow:hover { transform: translateY(-50%) scale(1.05); }
.miniapp-hscroll-arrow:disabled { opacity: 0; pointer-events: none; }
.miniapp-hscroll-arrow--left { left: -8px; }
.miniapp-hscroll-arrow--right { right: -8px; }
@media (min-width: 768px) {
  .miniapp-hscroll-arrow { display: inline-flex; }
}
```

- [ ] **Step 2: Create HScroll component**

Write `web/src/app/(miniapp)/components/HScroll.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

interface Props {
  children: ReactNode
  ariaLabel?: string
}

export function HScroll({ children, ariaLabel }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  function update() {
    const el = trackRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft >= max - 1 || max <= 0)
  }

  useEffect(() => {
    update()
    const el = trackRef.current
    if (!el) return
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [])

  function scrollBy(dir: 1 | -1) {
    const el = trackRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' })
  }

  return (
    <div className="miniapp-hscroll" aria-label={ariaLabel}>
      <button
        type="button"
        className="miniapp-hscroll-arrow miniapp-hscroll-arrow--left"
        onClick={() => scrollBy(-1)}
        disabled={atStart}
        aria-label="Cuộn trái"
      >
        <Icon name="arrowRight" size={16} className="rotate-180" />
      </button>
      <div ref={trackRef} className="miniapp-hscroll-track">
        {children}
      </div>
      <button
        type="button"
        className="miniapp-hscroll-arrow miniapp-hscroll-arrow--right"
        onClick={() => scrollBy(1)}
        disabled={atEnd}
        aria-label="Cuộn phải"
      >
        <Icon name="arrowRight" size={16} />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Type-check + build**

Run from repo root:
```bash
cd web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(miniapp\)/components/HScroll.tsx web/src/app/globals.css
git commit -m "feat(miniapp): add HScroll primitive with side arrows + scroll-snap"
```

---

### Task 3: Refactor ProductRail to use HScroll

**Files:**
- Modify: `web/src/app/(miniapp)/components/ProductRail.tsx`
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add rail-cell CSS**

Append to `globals.css`:

```css
.miniapp-rail-cell {
  flex: 0 0 calc((100% - .75rem) / 2.2);
  list-style: none;
}
@media (min-width: 480px) {
  .miniapp-rail-cell { flex: 0 0 calc((100% - 1.5rem) / 3); }
}
@media (min-width: 768px) {
  .miniapp-rail-cell { flex: 0 0 calc((100% - 3rem) / 4); }
}
@media (min-width: 1024px) {
  .miniapp-rail-cell { flex: 0 0 calc((100% - 4rem) / 5); }
}
```

- [ ] **Step 2: Replace ProductRail implementation**

Overwrite `web/src/app/(miniapp)/components/ProductRail.tsx`:

```tsx
'use client'

import { ProductCard, type ProductSummary } from './ProductCard'
import { HScroll } from './HScroll'

interface Props {
  items: ProductSummary[]
}

export function ProductRail({ items }: Props) {
  if (items.length === 0) return null
  return (
    <HScroll ariaLabel="Danh sách sản phẩm">
      {items.map((p) => (
        <div key={p.id} className="miniapp-rail-cell">
          <ProductCard p={p} />
        </div>
      ))}
    </HScroll>
  )
}
```

- [ ] **Step 3: Visual smoke test**

Reload home. Verify:
- Mobile viewport: ~2.2 cards visible, native horizontal swipe works
- ≥768px: 4 cards, arrows visible
- ≥1024px: 5 cards, arrows visible
- Click right arrow: track scrolls one viewport-width smoothly
- At end: right arrow hidden/disabled

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(miniapp\)/components/ProductRail.tsx web/src/app/globals.css
git commit -m "refactor(miniapp): ProductRail as horizontal slider via HScroll"
```

---

### Task 4: Category strip slider

**Files:**
- Create: `web/src/app/(miniapp)/components/CategoryStrip.tsx`
- Modify: `web/src/app/(miniapp)/page.tsx`
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add category-strip-tile CSS**

Append to `globals.css`:

```css
.miniapp-cat-strip-tile {
  flex: 0 0 96px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: .375rem;
  padding: .625rem .5rem;
  border-radius: 14px;
  background: var(--brand-gold-soft, #fff7e0);
  color: var(--brand-ink);
  text-align: center;
  text-decoration: none;
  list-style: none;
}
.miniapp-cat-strip-tile .miniapp-cat-strip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: var(--tg-bg-2, #fff);
  color: var(--brand-gold-deep, #b88500);
}
.miniapp-cat-strip-tile .miniapp-cat-strip-name {
  font-size: .75rem;
  line-height: 1.1;
  font-weight: 500;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
@media (min-width: 768px) {
  .miniapp-cat-strip-tile { flex: 0 0 112px; }
}
```

- [ ] **Step 2: Create CategoryStrip component**

Write `web/src/app/(miniapp)/components/CategoryStrip.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { HScroll } from './HScroll'
import { Icon } from './Icon'
import { categoryIcons } from '@/lib/miniappIcons'

interface Category { id: number; name: string; slug: string; emoji: string }

interface Props {
  items: Category[]
}

export function CategoryStrip({ items }: Props) {
  if (items.length === 0) return null
  return (
    <HScroll ariaLabel="Danh mục">
      {items.map((c) => (
        <Link
          key={c.id}
          href={`/danh-muc/${c.slug}`}
          className="miniapp-cat-strip-tile"
        >
          <span className="miniapp-cat-strip-icon">
            <Icon name={categoryIcons[c.slug] ?? 'package'} size={20} strokeWidth={1.75} />
          </span>
          <span className="miniapp-cat-strip-name">{c.name}</span>
        </Link>
      ))}
    </HScroll>
  )
}
```

- [ ] **Step 3: Replace category grid on home**

Modify `web/src/app/(miniapp)/page.tsx`:

Replace the import line:
```tsx
import { categoryIcons } from '@/lib/miniappIcons'
```
With:
```tsx
import { CategoryStrip } from './components/CategoryStrip'
```

Then replace the entire `<ul className="miniapp-cat-grid"> ... </ul>` block (lines ~74-86) with:
```tsx
<CategoryStrip items={cats.data} />
```

Remove unused `categoryIcons` import + unused `Icon` import if no longer needed inside the category section (keep `Icon` if still used in section titles).

- [ ] **Step 4: Visual smoke test**

Reload home. Verify:
- Categories render in single horizontal row
- Mobile: swipe works
- Desktop: arrows when more than ~6-8 fit on screen
- Clicking tile navigates to `/danh-muc/<slug>`

- [ ] **Step 5: Commit**

```bash
git add web/src/app/\(miniapp\)/components/CategoryStrip.tsx web/src/app/\(miniapp\)/page.tsx web/src/app/globals.css
git commit -m "feat(miniapp): categories as horizontal slider strip"
```

---

### Task 5: Refactor FilterBar to compact + dropdown

**Files:**
- Modify: `web/src/app/(miniapp)/components/FilterBar.tsx`
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add filter-bar + dropdown CSS**

Append to `globals.css`:

```css
.miniapp-filterbar {
  display: flex;
  align-items: center;
  gap: .5rem;
  flex-wrap: wrap;
  margin-top: .5rem;
}
.miniapp-filterbar-chip {
  display: inline-flex;
  align-items: center;
  gap: .25rem;
  padding: .25rem .5rem .25rem .625rem;
  border-radius: 999px;
  background: var(--brand-gold-soft, #fff7e0);
  color: var(--brand-ink);
  font-size: .75rem;
  border: 1px solid color-mix(in srgb, var(--brand-ink) 8%, transparent);
}
.miniapp-filterbar-chip button {
  display: inline-flex;
  align-items: center;
  padding: 0 0 0 .125rem;
  background: none;
  border: 0;
  cursor: pointer;
  color: inherit;
  opacity: .65;
}
.miniapp-filterbar-chip button:hover { opacity: 1; }
.miniapp-filterbar-spacer { flex: 1; }
.miniapp-filterbar-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: .25rem;
  padding: .375rem .625rem;
  border-radius: 999px;
  background: var(--tg-bg-2, #fff);
  border: 1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent);
  color: var(--brand-ink);
  font-size: .8125rem;
  cursor: pointer;
}
.miniapp-filterbar-btn-count {
  display: inline-grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--brand-gold, #ffc200);
  color: var(--brand-ink);
  font-size: .6875rem;
  font-weight: 600;
}
.miniapp-filter-panel {
  position: absolute;
  right: 0;
  top: calc(100% + .375rem);
  z-index: 30;
  width: min(320px, calc(100vw - 1.5rem));
  padding: .875rem;
  border-radius: 14px;
  background: var(--tg-bg-2, #fff);
  border: 1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent);
  box-shadow: 0 12px 32px color-mix(in srgb, var(--brand-ink) 18%, transparent);
  display: flex;
  flex-direction: column;
  gap: .75rem;
}
.miniapp-filter-panel h4 {
  font-size: .75rem;
  font-weight: 600;
  opacity: .7;
  margin-bottom: .375rem;
}
.miniapp-filter-panel .price-inputs {
  display: flex;
  align-items: center;
  gap: .375rem;
  margin-top: .5rem;
}
.miniapp-filter-panel .price-inputs input {
  flex: 1;
  min-width: 0;
  border-radius: 10px;
  padding: .375rem .5rem;
  font-size: .8125rem;
  background: var(--tg-bg, #fafafa);
  border: 1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent);
}
.miniapp-filter-panel-actions {
  display: flex;
  justify-content: flex-end;
  gap: .5rem;
  padding-top: .25rem;
  border-top: 1px solid color-mix(in srgb, var(--brand-ink) 8%, transparent);
}
.miniapp-filter-panel-actions button {
  font-size: .8125rem;
  padding: .375rem .75rem;
  border-radius: 999px;
  background: none;
  border: 1px solid color-mix(in srgb, var(--brand-ink) 12%, transparent);
  color: var(--brand-ink);
  cursor: pointer;
}
```

- [ ] **Step 2: Rewrite FilterBar**

Overwrite `web/src/app/(miniapp)/components/FilterBar.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

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

const PRICE_PRESETS: { label: string; min: number | ''; max: number | '' }[] = [
  { label: 'Tất cả', min: '', max: '' },
  { label: '< 100K', min: '', max: 100_000 },
  { label: '100K – 500K', min: 100_000, max: 500_000 },
  { label: '500K – 1M', min: 500_000, max: 1_000_000 },
  { label: '> 1M', min: 1_000_000, max: '' },
]

function formatVndShort(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return `${n}`
}

function priceLabel(min: FilterValue['priceMin'], max: FilterValue['priceMax']) {
  if (min === '' && max === '') return null
  if (min !== '' && max !== '') return `${formatVndShort(min)} – ${formatVndShort(max)}`
  if (min !== '') return `≥ ${formatVndShort(min)}`
  return `≤ ${formatVndShort(max as number)}`
}

export function FilterBar({ value, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const sortLabel = value.sort !== 'default' ? SORTS.find((s) => s.k === value.sort)?.label : null
  const pLabel = priceLabel(value.priceMin, value.priceMax)
  const activeCount = (sortLabel ? 1 : 0) + (pLabel ? 1 : 0)

  function clearSort() { onChange({ ...value, sort: 'default' }) }
  function clearPrice() { onChange({ ...value, priceMin: '', priceMax: '' }) }
  function reset() { onChange({ sort: 'default', priceMin: '', priceMax: '' }); setOpen(false) }

  return (
    <div ref={wrapRef} className="relative">
      <div className="miniapp-filterbar">
        {sortLabel && (
          <span className="miniapp-filterbar-chip">
            {sortLabel}
            <button type="button" onClick={clearSort} aria-label="Bỏ sắp xếp">
              <Icon name="x" size={12} />
            </button>
          </span>
        )}
        {pLabel && (
          <span className="miniapp-filterbar-chip">
            {pLabel}
            <button type="button" onClick={clearPrice} aria-label="Bỏ khoảng giá">
              <Icon name="x" size={12} />
            </button>
          </span>
        )}
        <span className="miniapp-filterbar-spacer" />
        <button
          type="button"
          className="miniapp-filterbar-btn"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label="Bộ lọc"
        >
          <Icon name="filter" size={14} />
          <span>Lọc</span>
          {activeCount > 0 && <span className="miniapp-filterbar-btn-count">{activeCount}</span>}
        </button>
      </div>

      {open && (
        <div className="miniapp-filter-panel" role="dialog" aria-label="Bộ lọc">
          <div>
            <h4>Sắp xếp</h4>
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
          </div>
          <div>
            <h4>Khoảng giá</h4>
            <div className="miniapp-chip-row" style={{ marginTop: 0 }}>
              {PRICE_PRESETS.map((p) => {
                const active = value.priceMin === p.min && value.priceMax === p.max
                return (
                  <button
                    key={p.label}
                    type="button"
                    className="miniapp-chip"
                    aria-pressed={active}
                    onClick={() => onChange({ ...value, priceMin: p.min, priceMax: p.max })}
                  >
                    {p.label}
                  </button>
                )
              })}
            </div>
            <div className="price-inputs">
              <input
                type="number"
                inputMode="numeric"
                placeholder="Từ"
                step={10000}
                min={0}
                value={value.priceMin}
                onChange={(e) => onChange({ ...value, priceMin: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
              />
              <span className="opacity-60 text-xs">–</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="Đến"
                step={10000}
                min={0}
                value={value.priceMax}
                onChange={(e) => onChange({ ...value, priceMax: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) })}
              />
              <span className="opacity-60 text-xs">đ</span>
            </div>
          </div>
          <div className="miniapp-filter-panel-actions">
            <button type="button" onClick={reset}>Đặt lại</button>
            <button type="button" onClick={() => setOpen(false)}>Xong</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify Icon component supports `filter` and `x` names**

Run:
```bash
grep -n "filter\|^\s*x:" web/src/app/\(miniapp\)/components/Icon.tsx
```

If `filter` or `x` not exported, open `web/src/app/(miniapp)/components/Icon.tsx` and add them. Most likely uses `lucide-react` — add to the icon map. Example expected map structure:

```tsx
import { Filter, X } from 'lucide-react'
// inside the iconMap object:
filter: Filter,
x: X,
```

- [ ] **Step 4: Type-check**

```bash
cd web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Visual smoke test**

Open `/san-pham` and a category page. Verify:
- Filter button + count badge appears at right of bar
- Click → panel opens below with sort chips + price presets + custom inputs + Reset/Xong
- Selecting a preset highlights it; custom inputs sync if matching
- Active filters render as removable chips inline
- Click outside / Escape closes panel

- [ ] **Step 6: Commit**

```bash
git add web/src/app/\(miniapp\)/components/FilterBar.tsx web/src/app/\(miniapp\)/components/Icon.tsx web/src/app/globals.css
git commit -m "feat(miniapp): compact FilterBar with dropdown panel + price presets"
```

---

### Task 6: Final QA + tag

- [ ] **Step 1: Run all backend tests**

```bash
node --test tests/utils tests/wp-migration tests/messageTemplateService.test.js tests/bot-start.test.js tests/brand-strip.test.js
```

Expected: all pass (no API changes; just sanity check nothing regressed).

- [ ] **Step 2: Build web**

```bash
cd web && npm run build
```

Expected: build succeeds, no type errors.

- [ ] **Step 3: Smoke test full flow**

Manual checks on `http://localhost:3001`:
1. Home: search box, type — no shake
2. Home: category strip scrolls horizontally
3. Home: "Sản phẩm đã xem" / nổi bật / mới rails scroll with arrows on desktop
4. `/san-pham`: filter button → dropdown works, presets + custom inputs both apply
5. `/danh-muc/<slug>`: same filter UX

- [ ] **Step 4: Tag release**

```bash
git tag -a v0.19-rail-slider-filter -m "UX polish: rail sliders + category strip + filter dropdown + search-shake fix"
```

- [ ] **Step 5: Update CLAUDE.md sub-projects table**

Modify `CLAUDE.md` — append row to the "Sub-projects shipped" table:

```
| `v0.19-rail-slider-filter` | UX — rail sliders, category strip, filter dropdown, search-shake fix |
```

Commit:
```bash
git add CLAUDE.md
git commit -m "docs: log v0.19-rail-slider-filter in shipped sub-projects"
```
