# P3 — TMA performance pass

**Date**: 2026-05-14
**Status**: Spec
**Tag on ship**: `v0.32-tma-perf`

## Goal

Cut perceived latency on Telegram Mini App routes. Focus on round-trips over the Cloudflare tunnel, since that's the hot path. Admin perf is not addressed.

## Findings

1. **17 `useQuery` in miniapp, only 2 set `staleTime`** — default is 0, so every mount refetches.
2. **No `QueryClient` default config** for `refetchOnWindowFocus`, `gcTime`, retry behavior.
3. **Detail page waterfall**: `useQuery(product)` → `useEffect(pushRecentlyViewed)` → `useEffect(setRecentIds)` → `useQuery(recently)`. 3 sequential round-trips before the bottom rail shows.
4. **Image `sizes` strings** still mention `14vw` / `17vw` for breakpoints that no longer exist (grid capped at 5 cols → 20vw). Over-fetching at high-DPR desktop.
5. **Search modal** mounts SearchBox once opened — preview queries fire on every keystroke (debounced 200 ms) but no `staleTime` means each new query is fresh.
6. **Bundle**: not yet measured. Suspect lucide-react full-package import vs. tree-shaken named imports, unused deps from removed features.

## Changes

### QueryClient defaults

`web/src/app/providers.tsx`:

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,            // 60 s — fresh window per nav
      gcTime: 5 * 60_000,           // 5 min in cache
      refetchOnWindowFocus: false,  // TMA backgrounds aggressively; refocus is noise
      retry: 1,                     // one auto retry, then surface error
    },
  },
})
```

Per-query override only where stale-while-revalidate is wrong (cart count, order status SSE-adjacent — TBD).

### Fix detail-page waterfall

Combine recently-viewed setup into the `useQuery` `onSuccess` (or a single `useEffect` that does both `pushRecentlyViewed` + `setRecentIds` in one tick). The `recently` query becomes a parallel sibling of `related`, not a downstream of an effect-chain.

### Image `sizes` audit

Strip stale breakpoints. After `v0.28` grid cap at 5 cols:

- ProductCard `sizes`: `(min-width: 1024px) 20vw, (min-width: 768px) 25vw, (min-width: 480px) 33vw, 50vw` (already done in `v0.28`, double-check).
- Rail card: `(min-width: 1024px) 20vw, (min-width: 768px) 33vw, 50vw`.
- Detail hero: `(min-width: 768px) 50vw, 100vw`.

### Bundle audit

Run `npm run build` for `web/`. Check `.next/app-build-manifest.json` per-route entries. Targets:

- Miniapp index ≤ 250 KB gzipped (first-load JS).
- Detail page ≤ 300 KB.

Trim:
- Replace any whole-package imports (`import * as X from 'lucide-react'`) with named imports.
- Audit deps in `web/package.json` — drop anything imported only by deleted modules.
- Defer heavy admin-only components (RichEditor / TipTap) from miniapp chunks (should already be route-segmented, verify).

### Prefetch hints

Next App Router `<Link>` prefetches by default on hover/intersection. Verify no `prefetch={false}` overrides exist in miniapp. If `/san-pham/[slug]` is the typical landing, ensure home page's cards trigger prefetch.

### Out of scope

- Server-side caching layer (`/products` already returns fast, DB is in-process SQLite).
- CDN for `/uploads/*` (Cloudflare Tunnel covers this).
- Service worker / PWA (TMA doesn't benefit).
- Critical-CSS extraction.

## Acceptance

- Lighthouse mobile run on `/san-pham` shows **Performance ≥ 85** (current baseline TBD during work).
- Network panel: navigating home → detail → home executes ≤ 2 new fetches on the return trip (cache hits otherwise).
- `npm run build` reports miniapp index route first-load JS ≤ 250 KB gzipped, detail ≤ 300 KB.
- React DevTools profiler: no waterfall sequence > 2 dependent queries on detail page.

## Risk

- `refetchOnWindowFocus: false` could hide a stale state in cart/order pages — override there if a regression is observed.
- 60 s `staleTime` too long for admin live screens — admin app has its own provider already, no spillover.
- Trimming deps may surface hidden imports — `tsc --noEmit -p .` after each removal.

## Rollback

- Provider change is a single commit, simple to revert.
- Each dep removal own commit.
