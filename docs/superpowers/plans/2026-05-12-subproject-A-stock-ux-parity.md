# Sub-project A: /admin/stock UX Parity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Add search box, status filter chips, quick-add-keys popup, and bulk-delete-unsold to `/admin/stock`. Reuse same components/patterns as `/admin/products`.

**Architecture:** Client-side filter on the existing product list. New `QuickAddKeysModal` reuses existing admin `/admin/stock/:productId` POST endpoint (already accepts a bulk array `{items: [...], variantId?}`). Bulk delete-unsold uses existing `DELETE /admin/stock/:productId/unsold` route.

**Tech Stack:** Next 16, TanStack Query, existing admin API. No backend changes.

---

## Tasks

### Task 1: Add search + status filter + sort to stock page

**Files:**
- Modify: `web/src/app/(admin)/admin/stock/page.tsx`

- [ ] **Step 1:** Replace the component with this version (preserving the existing `columns` + `cardActions` definitions above):

```tsx
export default function StockIndexPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'products'],
    queryFn: () => api.get<ProductStock[]>('/admin/products'),
    refetchInterval: 10000,
  })
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'in' | 'out' | 'low'>('all')
  const [sort, setSort] = useState<'default' | 'stock_asc' | 'stock_desc'>('default')

  const products = data?.data ?? []

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase()
    let rows = products
    if (ql) {
      rows = rows.filter((p) =>
        p.name.toLowerCase().includes(ql) || p.category.toLowerCase().includes(ql)
      )
    }
    if (statusFilter === 'in') rows = rows.filter((p) => p.stock > 0)
    else if (statusFilter === 'out') rows = rows.filter((p) => p.stock === 0)
    else if (statusFilter === 'low') rows = rows.filter((p) => p.stock > 0 && p.stock <= 5)

    if (sort === 'stock_asc') rows = [...rows].sort((a, b) => a.stock - b.stock)
    else if (sort === 'stock_desc') rows = [...rows].sort((a, b) => b.stock - a.stock)
    return rows
  }, [products, q, statusFilter, sort])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="clay-display text-3xl">Kho</h1>
        <button
          type="button"
          onClick={() => setQuickAddOpen(true)}
          className="clay-btn clay-btn--lemon text-sm"
        >
          + Thêm key
        </button>
      </div>

      <div className="clay-input flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Tìm theo tên sản phẩm hoặc danh mục…"
          className="w-full bg-transparent outline-none text-sm"
        />
      </div>

      <div className="flex gap-2 flex-wrap">
        {[
          { k: 'all', label: 'Tất cả' },
          { k: 'in', label: 'Còn hàng' },
          { k: 'out', label: 'Hết hàng' },
          { k: 'low', label: 'Sắp hết' },
        ].map((s) => (
          <button
            key={s.k}
            type="button"
            onClick={() => setStatusFilter(s.k as typeof statusFilter)}
            className="clay-pill text-xs"
            style={statusFilter === s.k ? { background: 'var(--color-clay-ink)', color: '#fff', borderColor: 'var(--color-clay-ink)' } : undefined}
          >
            {s.label}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="clay-input text-xs py-1 px-2"
        >
          <option value="default">Sắp xếp mặc định</option>
          <option value="stock_asc">Tồn ↑</option>
          <option value="stock_desc">Tồn ↓</option>
        </select>
      </div>

      <ResponsiveTable
        rows={filtered}
        columns={columns}
        rowKey={(p) => p.id}
        loading={isLoading}
        emptyText="Không tìm thấy sản phẩm phù hợp"
        cardActions={cardActions}
      />

      {quickAddOpen && (
        <QuickAddKeysModal products={products} onClose={() => setQuickAddOpen(false)} />
      )}
    </div>
  )
}
```

- [ ] **Step 2:** Add imports at top:

```tsx
import { useMemo, useState } from 'react'
import { QuickAddKeysModal } from './QuickAddKeysModal'
```

Add `quickAddOpen` state:
```tsx
const [quickAddOpen, setQuickAddOpen] = useState(false)
```

(Place near other useState calls.)

- [ ] **Step 3:** Skip verification until Task 2 (modal created).

### Task 2: QuickAddKeysModal

**Files:**
- Create: `web/src/app/(admin)/admin/stock/QuickAddKeysModal.tsx`

```tsx
'use client'

import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Product { id: string; name: string }

export function QuickAddKeysModal({ products, onClose }: { products: Product[]; onClose: () => void }) {
  const [productId, setProductId] = useState<string>(products[0]?.id ?? '')
  const [text, setText] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: async () => {
      const items = text.split('\n').map((s) => s.trim()).filter(Boolean)
      if (items.length === 0) throw new Error('Chưa nhập key nào')
      if (!productId) throw new Error('Chưa chọn sản phẩm')
      return api.post(`/admin/stock/${productId}`, { items })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] })
      onClose()
    },
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Thêm key</h2>
          <button onClick={onClose} className="opacity-60 text-xl leading-none">×</button>
        </div>

        <label className="block text-sm">
          <span className="text-xs text-clay-charcoal mb-1 inline-block">Sản phẩm</span>
          <select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            className="clay-input w-full text-sm"
          >
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-xs text-clay-charcoal mb-1 inline-block">Keys (mỗi key một dòng)</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            placeholder="key1@example.com|password&#10;key2@example.com|password"
            className="clay-input w-full text-sm font-mono"
          />
        </label>

        {err && <p className="text-xs text-red-600">{err}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="clay-btn text-sm">Huỷ</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="clay-btn clay-btn--lemon text-sm"
          >
            {mutation.isPending ? 'Đang thêm…' : 'Thêm'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

### Task 3: Verify + tag

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
npx tsc --noEmit 2>&1 | tail -3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/admin/stock
cd ..
git add web/src/app/\(admin\)/admin/stock/page.tsx web/src/app/\(admin\)/admin/stock/QuickAddKeysModal.tsx
git commit -m "feat(admin-stock): search + filter chips + sort + quick-add-keys modal"
git tag v0.11-stock-ux -m "Sub-project A: stock UX parity"
```

---

## Self-Review

- A1 search → Task 1
- A2 status filter chips → Task 1
- A3 sort → Task 1
- A4 quick-add keys modal → Task 2
- A5 reuse existing endpoint → no backend change needed
