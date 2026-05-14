# Miniapp UX polish — design

**Date**: 2026-05-14
**Status**: Spec
**Tag on ship**: `v0.28-miniapp-ux`

## Scope — 6 tweaks

1. `/san-pham` grid caps at 5 cols on desktop (drop 6/7-col breakpoints).
2. "Mua nhanh" button moves from `.miniapp-product-img` overlay into `.miniapp-product-info`, icon changes from `plus` to `zap`.
3. Telegram MiniApp `BackButton` SDK wired up: shows on non-root paths, calls `router.back()`.
4. "Lọc" button rendered inline with the category chip row instead of below it.
5. Variant input section ("Thông tin") wrapped in a highlighted card (brand-gold-soft bg + ring + header with info icon).
6. Search icon button added next to the support button in the top nav (desktop + mobile); links to `/san-pham?focus=1`, which autofocuses the search input.

## Files touched

- `web/src/app/globals.css` — grid cap, new chip-filter-row class, variant-input-card class.
- `web/src/app/(miniapp)/components/ProductCard.tsx` — move quick-buy.
- `web/src/app/(miniapp)/components/MiniAppShell.tsx` — search button + `useTelegramBackButton` hook call.
- `web/src/app/(miniapp)/components/SearchBox.tsx` — optional `autoFocus` prop.
- `web/src/app/(miniapp)/components/VariantPicker.tsx` — wrap input fields in highlighted card.
- `web/src/app/(miniapp)/san-pham/page.tsx` — chip + Lọc same row + autofocus search.
- `web/src/lib/useTelegramBackButton.ts` (new) — hook reading `window.Telegram?.WebApp?.BackButton`.

## Out of scope

No API changes. No DB changes. Tests are visual (dev server + tunnel).
