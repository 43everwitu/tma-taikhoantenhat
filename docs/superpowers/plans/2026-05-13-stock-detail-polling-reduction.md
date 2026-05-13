# Stock Detail Polling Reduction

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the `/admin/stock/[productId]` page from polling `/admin/stock/<id>?page=…` every 10s to a calmer 30s + disable refetchOnWindowFocus. Same treatment for any other unannounced polling endpoints on admin pages the user opens often (orders, dashboard).

**Architecture:** Pure config tweak on `useQuery` options. Mutations already invalidate the cache explicitly, so the polling tail is only safety-net catch-up, not a feature. 30s gives the same UX with 3× fewer requests.

**Tech Stack:** Next 16 App Router, @tanstack/react-query.

---

### Task 1: Tame `/admin/stock/[productId]` polling

**Files:**
- Modify: `web/src/app/(admin)/admin/stock/[productId]/page.tsx`

- [ ] **Step 1: Update query options**

Open `web/src/app/(admin)/admin/stock/[productId]/page.tsx` at line 45-53. Locate:

```tsx
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'stock', productId, page, debouncedSearch],
    queryFn: () => {
      let url = `/admin/stock/${productId}?page=${page}&limit=${limit}`
      if (debouncedSearch) url += `&q=${encodeURIComponent(debouncedSearch)}`
      return api.get<StockResponse>(url)
    },
    refetchInterval: 10000,
  })
```

Replace with:

```tsx
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'stock', productId, page, debouncedSearch],
    queryFn: () => {
      let url = `/admin/stock/${productId}?page=${page}&limit=${limit}`
      if (debouncedSearch) url += `&q=${encodeURIComponent(debouncedSearch)}`
      return api.get<StockResponse>(url)
    },
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })
```

- [ ] **Step 2: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 3: Verify in browser**

Open DevTools → Network on `/admin/stock/10`. Watch the `/admin/stock/10?page=1&limit=50` request. Expected: fires once on mount, then once every 30s (was every 10s). After adding a key via the form, an extra refetch fires via explicit invalidation — that's expected.

- [ ] **Step 4: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/stock/\[productId\]/page.tsx
git commit -m "perf(admin/stock): bump stock-detail polling 10s → 30s + disable refetchOnWindowFocus"
```

---

### Task 2: Tame orders + dashboard polling

**Files:**
- Modify: `web/src/app/(admin)/admin/orders/page.tsx`
- Modify: `web/src/app/(admin)/admin/dashboard/page.tsx`

- [ ] **Step 1: Orders page**

Open `web/src/app/(admin)/admin/orders/page.tsx` at line 152. Locate the `refetchInterval: 10000` on the orders query. Replace with:

```tsx
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
```

(Don't change anything else in the query object — just edit/append those two options.)

- [ ] **Step 2: Dashboard stats query**

Open `web/src/app/(admin)/admin/dashboard/page.tsx` at line 36. Locate:

```tsx
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'dashboard', 'stats'],
    queryFn: () => api.get<DashboardStats>('/admin/dashboard/stats'),
    refetchInterval: 10000,
  })
```

Replace with:

```tsx
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['admin', 'dashboard', 'stats'],
    queryFn: () => api.get<DashboardStats>('/admin/dashboard/stats'),
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })
```

- [ ] **Step 3: Dashboard revenue + top-products**

Same file, lines 42 + 48. The two queries already use `refetchInterval: 30000`. Add `refetchOnWindowFocus: false` to both:

```tsx
  const { data: revenueData } = useQuery({
    queryKey: ['admin', 'dashboard', 'revenue'],
    queryFn: () => api.get<RevenuePoint[]>('/admin/dashboard/revenue?period=30'),
    refetchInterval: 30000,
    refetchOnWindowFocus: false,
  })

  const { data: topProducts } = useQuery({
    queryKey: ['admin', 'dashboard', 'top-products'],
    queryFn: () => api.get<TopProduct[]>('/admin/dashboard/top-products'),
    refetchInterval: 30000,
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

- [ ] **Step 5: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/orders/page.tsx web/src/app/\(admin\)/admin/dashboard/page.tsx
git commit -m "perf(admin): orders + dashboard polling slowed to 30s + no window-focus refetch"
```

---

### Task 3: Announcements polling

**Files:**
- Modify: `web/src/app/(admin)/admin/announcements/page.tsx`

- [ ] **Step 1: Bump interval**

Locate the `refetchInterval: 15000` around line 36. Replace with:

```tsx
    refetchInterval: 60000,
    refetchOnWindowFocus: false,
```

(Append `refetchOnWindowFocus: false` to the same query object.)

- [ ] **Step 2: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/announcements/page.tsx
git commit -m "perf(admin/announcements): polling 15s → 60s, no window-focus refetch"
```

---

### Task 4: Final build verify

- [ ] **Step 1: Build**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit && npm run build
```
Expected: clean.
