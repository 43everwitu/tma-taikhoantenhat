# Rail Slider + Filter + Search Polish — Design

**Date:** 2026-05-13
**Scope:** Mini App UX polish — product rails as horizontal sliders, category strip slider, compact filter dropdown, price range UX, fix search-input screen shake.

## Goals

1. ProductRail: horizontal scroll-snap carousel with side arrows (replace paged grid). PC ≥1024px = 5 cards/row visible.
2. Categories on home: single horizontal row with scroll slider (replace `.miniapp-cat-grid` 2-col grid).
3. FilterBar: compact bar + filter icon → dropdown popover panel. Default state shows only active-filter chips + filter button.
4. Price range: preset chips (`<100k`, `100k–500k`, `500k–1M`, `>1M`) + custom min/max inputs with `step=10000`.
5. Fix search input screen-shake: add `scrollbar-gutter: stable` to `html`.

## Architecture

### New primitive: `HScroll` component

`web/src/app/(miniapp)/components/HScroll.tsx`:
- Wraps children in horizontal scroll container
- Renders left/right arrow buttons on desktop (≥768px) when content overflows
- Hides arrow when at scroll start/end (track via `scrollLeft` + `scrollWidth - clientWidth`)
- Scroll step = `container.clientWidth * 0.9`, smooth behavior
- CSS: `overflow-x: auto`, `scroll-snap-type: x mandatory`, `scroll-behavior: smooth`, hide scrollbar
- Children apply `scroll-snap-align: start` via shared class

Used by ProductRail and category strip.

### Refactor: `ProductRail`

Strip pagination state. Render single `<HScroll>` containing `<ul.miniapp-rail-track>` of all items. Each `<li.miniapp-rail-cell>` has fixed width via CSS variable.

CSS class `.miniapp-rail-cell`:
- Mobile (<768): `flex: 0 0 calc((100% - 12px) / 2.2)` → 2.2 cards visible peek
- Tablet (768–1023): `flex: 0 0 calc((100% - 32px) / 4)` → 4 visible
- Desktop (≥1024): `flex: 0 0 calc((100% - 48px) / 5)` → 5 visible
- `scroll-snap-align: start`

Remove `.miniapp-product-grid--rail` from rail usage (kept for any other consumer; or drop if unused).

### New: Category strip slider

`web/src/app/(miniapp)/components/CategoryStrip.tsx`:
- Same `<HScroll>` wrapper
- Each tile fixed width 96px (mobile) / 112px (≥768)
- Replaces `.miniapp-cat-grid` on home page only (search/category pages don't render this strip)

### FilterBar refactor

`web/src/app/(miniapp)/components/FilterBar.tsx`:
- Default inline UI: chip list of *active* filters (sort label if not default, price label if set), each with `×` to clear that filter
- Right-side button: filter icon + count badge if any active
- Click button → toggles dropdown popover panel below (absolute positioned)
- Panel content:
  - Sort: 6 radio chips (same options)
  - Price: 5 preset chips (Tất cả/<100k/100k–500k/500k–1M/>1M) + custom min/max inputs (`step=10000`, number type, format with locale on blur)
  - Reset button (clears all)
- Close on: outside click, Escape, route change
- `FilterValue` interface unchanged (sort + priceMin + priceMax)

Helper `formatVndShort(n)` → `100K`, `1M` for chip labels.

### Search shake fix

`web/src/app/globals.css`:
```css
html { scrollbar-gutter: stable; }
```

Reserves scrollbar gutter even when content doesn't overflow → no width shift when dropdown causes overflow. Modern browsers (Chrome 94+, Firefox 97+, Safari 18.2+). Safe default.

## File map

**Create:**
- `web/src/app/(miniapp)/components/HScroll.tsx`
- `web/src/app/(miniapp)/components/CategoryStrip.tsx`

**Modify:**
- `web/src/app/(miniapp)/components/ProductRail.tsx` — drop pagination, use HScroll
- `web/src/app/(miniapp)/components/FilterBar.tsx` — compact + dropdown
- `web/src/app/(miniapp)/page.tsx` — use CategoryStrip
- `web/src/app/globals.css` — add scrollbar-gutter, rail-cell classes, hscroll/arrow styles, category-strip-tile

**No changes:**
- ProductCard.tsx, SearchBox.tsx (shake fixed via CSS only)
- san-pham/page.tsx, danh-muc/[slug]/page.tsx — FilterBar API stable, no consumer changes

## Non-goals

- Dual-range slider for price (chips + inputs suffices)
- Server-side category sliders for other pages
- Removing `.miniapp-product-grid--rail` from globals.css (leave dormant)
- Touch gesture polyfill (browser native handles)

## Testing

Manual smoke:
1. Home: rails scroll horizontally, arrows on desktop, native swipe on mobile
2. Categories: 1 row, horizontally scrollable
3. Filter button opens panel, active chips render, clicking × clears one filter
4. Price preset chips select correct ranges
5. Type into search box: no horizontal page shift / shake
6. Tab/Escape/click-outside closes filter dropdown
