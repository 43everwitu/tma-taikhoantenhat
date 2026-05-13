# Stock Detail Variant + Variant Delete Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/admin/stock/[productId]` add-stock form require + send `variantId` when product has variants. Verify and fix the variant `Xoá` button on the admin product edit modal (`VariantsManager`).

**Architecture:** Add a variant select to the stock-detail page that hits `/admin/products/:id/variants`, blocks submission when product has variants but none chosen, and forwards `variantId` in the POST body. For the variant delete bug: add optimistic UI removal + error surface so success/failure is visible immediately; verify the existing soft-delete query-key invalidation still matches the showInactive-suffixed query.

**Tech Stack:** Next 16, React 19, @tanstack/react-query, better-sqlite3.

---

### Task 1: Add variant select to `/admin/stock/[productId]` add-stock form

**Files:**
- Modify: `web/src/app/(admin)/admin/stock/[productId]/page.tsx`

- [ ] **Step 1: Add variants query + state**

Open `web/src/app/(admin)/admin/stock/[productId]/page.tsx`. After the existing `useQuery` for stock data (around line 44-52), add a variants query. Locate this block:

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

Append immediately after it:

```tsx
  const variantsQuery = useQuery({
    queryKey: ['admin', 'variants', productId],
    queryFn: () => api.get<{ id: string; name: string; stock: number }[]>(`/admin/products/${productId}/variants`),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const variants = variantsQuery.data?.data ?? []
  const hasVariants = variants.length > 0
  const [variantId, setVariantId] = useState<string>('')

  useEffect(() => {
    if (hasVariants && !variantId) setVariantId(variants[0].id)
  }, [hasVariants, variantId, variants])
```

- [ ] **Step 2: Pass variantId in addMutation**

Find the `addMutation` block (around line 54-62):

```tsx
  const addMutation = useMutation({
    mutationFn: (items: string[]) =>
      api.post(`/admin/stock/${productId}`, { items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stock', productId] })
      setNewItems('')
    },
  })
```

Replace with:

```tsx
  const addMutation = useMutation({
    mutationFn: (items: string[]) => {
      const payload: { items: string[]; variantId?: number } = { items }
      if (variantId) payload.variantId = Number(variantId)
      return api.post(`/admin/stock/${productId}`, payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stock', productId] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      setNewItems('')
    },
  })
```

- [ ] **Step 3: Block submit when variants present but none chosen**

Find the `handleAdd` function (search for `addMutation.mutate(lines)`, around line 96-101):

```tsx
    const lines = newItems
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (lines.length > 0) addMutation.mutate(lines)
```

Wrap with a variant check. Replace the surrounding `handleAdd` so the guard fires before mutate:

```tsx
  function handleAdd() {
    if (hasVariants && !variantId) {
      alert('Sản phẩm có biến thể — vui lòng chọn biến thể trước khi thêm key.')
      return
    }
    const lines = newItems
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (lines.length > 0) addMutation.mutate(lines)
  }
```

(If `handleAdd` is inline at the button, extract it into a function near the other handlers and reference it from the button's `onClick`.)

- [ ] **Step 4: Render variant select in JSX**

Find the "Thêm hàng" card JSX (around line 240-273). Locate this header:

```tsx
        <h3 className="text-lg font-semibold mb-3">Thêm hàng mới</h3>
        <p className="text-sm text-clay-silver mb-3">Mỗi dòng là 1 mục (key, code, link...)</p>
```

Insert a variant select between the heading and the description:

```tsx
        <h3 className="text-lg font-semibold mb-3">Thêm hàng mới</h3>
        {hasVariants && (
          <div className="mb-3">
            <label className="block text-sm font-medium text-clay-charcoal mb-1">
              Biến thể <span className="text-red-500">*</span>
            </label>
            <select
              value={variantId}
              onChange={(e) => setVariantId(e.target.value)}
              className="clay-input w-full text-sm"
              required
            >
              <option value="">— Chọn biến thể —</option>
              {variants.map((v) => (
                <option key={v.id} value={v.id}>{v.name} (kho {v.stock})</option>
              ))}
            </select>
            {!variantId && (
              <p className="text-xs text-red-600 mt-1">Sản phẩm này có biến thể, phải chọn biến thể trước khi thêm key.</p>
            )}
          </div>
        )}
        <p className="text-sm text-clay-silver mb-3">Mỗi dòng là 1 mục (key, code, link...)</p>
```

- [ ] **Step 5: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 6: Manual smoke**

1. Open `/admin/stock/9` (product with variants).
2. Verify variant dropdown appears + first variant pre-selected.
3. Enter `KEY-TEST-001` in textarea, click "Thêm hàng".
4. Inspect Network: `POST /admin/stock/9` payload should now be `{"items":["KEY-TEST-001"],"variantId":<number>}`.
5. The added key should appear in the table tagged to the chosen variant.

For a product without variants: dropdown does NOT appear; flow unchanged.

- [ ] **Step 7: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/stock/\[productId\]/page.tsx
git commit -m "fix(admin/stock): require + send variantId on stock-detail add when product has variants"
```

---

### Task 2: Fix variant Xoá button on admin product modal

**Files:**
- Modify: `web/src/app/(admin)/admin/products/VariantsManager.tsx`

- [ ] **Step 1: Capture current behaviour**

In the browser:
1. Open `/admin/products` → edit a product with variants
2. Open DevTools → Network
3. Click "Xoá" on a variant, confirm the prompt
4. Note: (a) DELETE request status (200 / 404 / 403 / 500?), (b) whether the variant disappears from the list

If status is 200 and UI does not refresh → query invalidation key mismatch (Task 2 below).
If status is 404 → backend `softDelete` returned `changes === 0` (variant already inactive). Apply Task 2-extra patch.
If status is 403 → permission issue; check `/admin/me` for `products.write`. Resolve outside this plan.

- [ ] **Step 2: Add optimistic removal + error display**

Open `web/src/app/(admin)/admin/products/VariantsManager.tsx`. Locate the deleteMut around line 43:

```tsx
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/products/${productId}/variants/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] })
    },
  })
```

Replace with optimistic update + error capture:

```tsx
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/products/${productId}/variants/${id}`),
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ['admin', 'variants', productId] })
      const snapshots = qc.getQueriesData<{ data: Variant[] }>({ queryKey: ['admin', 'variants', productId] })
      snapshots.forEach(([key, prev]) => {
        if (!prev) return
        qc.setQueryData(key, { ...prev, data: prev.data.filter((v) => v.id !== id) })
      })
      return { snapshots }
    },
    onError: (_e, _id, ctx) => {
      ctx?.snapshots.forEach(([key, prev]) => prev && qc.setQueryData(key, prev))
      alert('Xoá biến thể thất bại — đã khôi phục danh sách.')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] })
    },
  })
```

This way: variant disappears instantly on click; if the server says no, it comes back and a clear alert fires.

- [ ] **Step 3: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 4: Manual smoke**

1. Open admin product modal with variants.
2. Click Xoá on a variant. Confirm prompt.
3. Variant should disappear immediately from the list.
4. Open `data/shop.db` (or hit `GET /admin/products/:id/variants?includeInactive=1`) — confirm `is_active = 0` for that variant.

Toggle "Hiện đã xoá" — the variant re-appears as soft-deleted; toggle off — disappears again.

- [ ] **Step 5: (Conditional) Backend tolerance patch**

Only if Step 1 showed a `404 NOT_FOUND` on Xoá: open `src/api/routes/admin/variants.js` lines 74-81 and replace:

```js
router.delete('/:id', (req, res) => {
  const productId = parseInt(req.params.productId);
  const variantId = parseInt(req.params.id);
  const r = variantService.softDelete(db, productId, variantId);
  if (r.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  auditService.log(req.admin?.adminId, 'variant.delete', 'variant', variantId, { productId }, req.ip);
  res.json({ success: true });
});
```

With:

```js
router.delete('/:id', (req, res) => {
  const productId = parseInt(req.params.productId);
  const variantId = parseInt(req.params.id);
  const existing = db.prepare('SELECT id, is_active FROM product_variants WHERE id = ? AND product_id = ?').get(variantId, productId);
  if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  if (existing.is_active) variantService.softDelete(db, productId, variantId);
  auditService.log(req.admin?.adminId, 'variant.delete', 'variant', variantId, { productId, alreadyInactive: !existing.is_active }, req.ip);
  res.json({ success: true });
});
```

Now an already-inactive variant returns 200 — UI no longer flips back into the list with an error.

- [ ] **Step 6: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/products/VariantsManager.tsx
# also stage src/api/routes/admin/variants.js if Step 5 was applied
git commit -m "fix(admin): optimistic variant delete with rollback + error alert"
```

---

### Task 3: Final QA + tag

- [ ] **Step 1: Build + type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit && npm run build
```
Expected: clean.

- [ ] **Step 2: Smoke checklist**

1. `/admin/stock/9` (assumes product 9 has variants): variant dropdown shows, first pre-selected, adding key with variant succeeds → DB row has `variant_id` set.
2. `/admin/stock/<id>` for a no-variant product: no dropdown, behavior unchanged.
3. `/admin/products` edit modal: Xoá on variant removes it instantly. Toggle "Hiện đã xoá" → it reappears as inactive.

- [ ] **Step 3: Tag + CLAUDE.md log**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git tag -a v0.22-stock-variant-delete-fix -m "Stock detail variant select + optimistic variant delete"
```

Append to `CLAUDE.md` sub-projects table:
```
| `v0.22-stock-variant-delete-fix` | /admin/stock/[id] variant select on add-stock + optimistic variant delete UX |
```

Commit:
```bash
git add CLAUDE.md
git commit -m "docs: log v0.22-stock-variant-delete-fix"
```
