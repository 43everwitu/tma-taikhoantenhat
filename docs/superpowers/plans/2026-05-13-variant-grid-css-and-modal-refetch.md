# Variant Grid CSS Delivery + Admin Modal Refetch Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get `.miniapp-variant-grid` CSS actually delivered to the browser so the product detail variant list renders as a grid, and stop redundant `/admin/me` + `/admin/features` + `/admin/products` refetches triggered by opening the admin product modal.

**Architecture:** Issue 1 is a Turbopack CSS HMR delivery problem (verified: 0 matches for `miniapp-variant-grid` in served stylesheet despite the rules existing in source) — fix by clearing `.next` cache and restarting the dev server, plus add an HMR-safe smoke test command we can rerun in future. Issue 2 stems from React-Query refetching on window focus / remount when the modal mounts/unmounts; fix by adding `staleTime` to the `/admin/products` query and a query-key audit + disabling `refetchOnWindowFocus` for static admin metadata (me/features).

**Tech Stack:** Next 16 + Turbopack, React 19, @tanstack/react-query.

---

### Task 1: Verify CSS not in bundle, then restart dev server

**Files:**
- (no source edits — operational fix)

- [ ] **Step 1: Confirm current state**

Run:
```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
curl -sL http://localhost:3001/ 2>&1 | grep -oE 'href="[^"]*\.css"' | head -1 \
  | sed 's/href="//;s/"$//' \
  | xargs -I {} curl -sL "http://localhost:3001{}" 2>/dev/null \
  | grep -c "miniapp-variant-grid\|miniapp-variant-tile"
```
Expected (current broken state): `0`

- [ ] **Step 2: Kill web dev**

```bash
lsof -ti :3001 | xargs kill -9 2>/dev/null
sleep 2
lsof -i :3001 -sTCP:LISTEN
```
Expected after: no output (port free).

- [ ] **Step 3: Clear Turbopack cache and restart**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
rm -rf .next/cache
cd ..
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
cd web && nohup npm run dev > ../logs/web.log 2>&1 &
```

- [ ] **Step 4: Verify CSS now delivered**

Wait 10 seconds for boot, then:
```bash
sleep 12
curl -sL http://localhost:3001/ 2>&1 | grep -oE 'href="[^"]*\.css"' | head -1 \
  | sed 's/href="//;s/"$//' \
  | xargs -I {} curl -sL "http://localhost:3001{}" 2>/dev/null \
  | grep -c "miniapp-variant-grid\|miniapp-variant-tile"
```
Expected: `>= 10` (the variant-grid rule + media queries + tile rules).

- [ ] **Step 5: Visual smoke**

Open `http://localhost:3001/san-pham/<slug-with-variants>` (e.g. `tai-khoan-course-hero-premium-unlock` from the screenshot). Hard-refresh. Verify: variants render as a 2-column grid (mobile) instead of concatenated inline text.

- [ ] **Step 6: No commit needed (operational fix). Move on.**

---

### Task 2: Audit + tame React-Query refetches in admin modal

**Files:**
- Modify: `web/src/app/(admin)/admin/products/page.tsx`
- Modify: `web/src/components/AdminSidebar.tsx`

- [ ] **Step 1: Add Network panel reproduction**

Open `/admin/products` in browser DevTools → Network tab → filter "Fetch/XHR". Click "Thêm sản phẩm" (or "Sửa" on a product) to open the modal. Observe which requests fire. Expected (current bug):
- `/admin/me` fires
- `/admin/features` fires
- `/admin/products` (with current `?q=`) fires

Document the response codes + timing. (If they DON'T fire — the bug already resolved by Task 1's restart and we can short-circuit.) Either way, proceed.

- [ ] **Step 2: Stabilize `/admin/products` query**

Open `web/src/app/(admin)/admin/products/page.tsx` and locate the query at line ~90:

```tsx
const { data, isLoading } = useQuery({
  queryKey: ['admin', 'products', debouncedSearch],
  queryFn: () => {
    let url = '/admin/products'
    if (debouncedSearch) url += `?q=${encodeURIComponent(debouncedSearch)}`
    return api.get<Product[]>(url)
  },
})
```

Add `staleTime` (so opening the modal does not re-fetch the products list, since invalidation already happens explicitly after create/update/delete) and disable `refetchOnWindowFocus` (admin doesn't need it for a list that we manage with explicit invalidations):

```tsx
const { data, isLoading } = useQuery({
  queryKey: ['admin', 'products', debouncedSearch],
  queryFn: () => {
    let url = '/admin/products'
    if (debouncedSearch) url += `?q=${encodeURIComponent(debouncedSearch)}`
    return api.get<Product[]>(url)
  },
  staleTime: 30_000,
  refetchOnWindowFocus: false,
})
```

Also do the same for the categories query at ~84:

```tsx
const { data: catsData } = useQuery({
  queryKey: ['categories'],
  queryFn: () => api.get<Category[]>('/categories'),
  staleTime: 5 * 60_000,
  refetchOnWindowFocus: false,
})
```

- [ ] **Step 3: Stabilize sidebar metadata queries**

Open `web/src/components/AdminSidebar.tsx` at line ~34. They already have `staleTime: 5 * 60 * 1000` but lack `refetchOnWindowFocus: false`. Add it:

```tsx
const featuresQuery = useQuery({
  queryKey: ['admin', 'features'],
  queryFn: () => api.get<{ topups: boolean; broadcast: boolean }>('/admin/features'),
  staleTime: 5 * 60 * 1000,
  refetchOnWindowFocus: false,
})
const features = featuresQuery.data?.data ?? { topups: false, broadcast: false }

const meQuery = useQuery({
  queryKey: ['admin', 'me'],
  queryFn: () => api.get<{ permissions: string[] }>('/admin/me'),
  staleTime: 5 * 60 * 1000,
  refetchOnWindowFocus: false,
})
```

- [ ] **Step 4: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 5: Re-test**

In DevTools Network tab, open + close modal repeatedly. Expected: no new `/admin/me`, `/admin/features`, or `/admin/products` requests fire during open/close cycles (the cache keeps the data fresh). They should fire only on:
- Initial page load
- After `staleTime` (30s for products, 5min for me/features)
- Explicit mutation invalidations (create/update/delete product)

- [ ] **Step 6: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/products/page.tsx web/src/components/AdminSidebar.tsx
git commit -m "perf(admin): add staleTime + disable refetchOnWindowFocus for products/me/features queries"
```

---

### Task 3: Final QA + tag

- [ ] **Step 1: Build verify**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit && npm run build
```
Expected: clean build, no type errors.

- [ ] **Step 2: Smoke checklist**

Manual verifications on `http://localhost:3001`:
1. `/san-pham/<slug-with-variants>` — variants render as grid (2 cols mobile, 3 cols ≥480px, 2 cols ≥768px). Selected variant has gold border. Out-of-stock tile dimmed with "Hết" badge.
2. `/admin/products` — open + close product modal 3 times. DevTools Network shows no `/admin/me` / `/admin/features` / `/admin/products` calls after the first page load.
3. `/admin/products` — edit a product, save. Confirm `/admin/products` refetches (via the mutation's `invalidateQueries`) — this is the desired behavior, not a regression.

- [ ] **Step 3: Tag**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git tag -a v0.21-modal-refetch-fix -m "Fix variant grid CSS delivery + reduce admin modal refetches"
```

- [ ] **Step 4: Update CLAUDE.md**

Append to the "Sub-projects shipped" table (after the `v0.20` row):
```
| `v0.21-modal-refetch-fix` | fix variant-grid CSS delivery via Turbopack cache clear + add staleTime/refetchOnWindowFocus to admin queries |
```

Commit:
```bash
git add CLAUDE.md
git commit -m "docs: log v0.21-modal-refetch-fix"
```
