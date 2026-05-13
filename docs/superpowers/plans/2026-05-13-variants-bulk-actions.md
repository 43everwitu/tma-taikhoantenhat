# Variants Bulk-Action Toolbar

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pick multiple variants in the admin product modal, then bulk delete / hide / show / bulk-edit price via a sticky toolbar.

**Architecture:** Add per-row checkbox + header "select-all" + `selectedIds: Set<string>` state. When non-empty, render a sticky bulk-action toolbar above the list. Bulk operations issue parallel admin API calls (existing `DELETE /variants/:id` + `PUT /variants/:id`) using `Promise.all` — no new backend routes needed. Optimistic cache updates already in place for delete; for bulk hide/show/price we invalidate after the parallel batch.

**Tech Stack:** Next 16, React 19, @tanstack/react-query, existing variant admin API.

---

### Task 1: Selection state + per-row checkbox

**Files:**
- Modify: `web/src/app/(admin)/admin/products/VariantsManager.tsx`

- [ ] **Step 1: Add selection state in VariantsManager**

Near the existing useState hooks, add:

```tsx
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Drop stale IDs whenever the variant list changes (post-mutation refetch).
  useEffect(() => {
    setSelectedIds((prev) => {
      const valid = new Set(variants.map((v) => v.id))
      const next = new Set<string>()
      for (const id of prev) if (valid.has(id)) next.add(id)
      return next.size === prev.size ? prev : next
    })
  }, [variants])

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    setSelectedIds((prev) => prev.size === variants.length ? new Set() : new Set(variants.map((v) => v.id)))
  }
```

Also import `useEffect`:
```tsx
import { useEffect, useState } from 'react'
```

- [ ] **Step 2: Add checkbox to SortableVariantRow**

Locate the existing `SortableVariantRow` (bottom of file). Extend its props + JSX:

```tsx
function SortableVariantRow({ v, selected, onToggle, onEdit, onDelete }: {
  v: Variant
  selected: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: v.id })
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  }
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`rounded-lg border p-2 text-sm flex items-center gap-2 ${selected ? 'ring-2 ring-yellow-400 bg-yellow-50' : v.isActive ? 'bg-white' : 'bg-gray-50'}`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
        className="cursor-pointer"
      />
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab opacity-50 hover:opacity-100 px-1"
        aria-label="Kéo để sắp xếp"
      >⋮⋮</button>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">
          {v.name}
          {!v.isActive && (
            <span className="ml-2 text-[10px] uppercase tracking-wide bg-gray-500 text-white px-1.5 py-0.5 rounded">
              Tạm ẩn
            </span>
          )}
          {v.isBackorder && (
            <span className="ml-2 text-[10px] uppercase tracking-wide bg-blue-500 text-white px-1.5 py-0.5 rounded">
              Đặt trước
            </span>
          )}
        </p>
        <p className="text-xs opacity-60">{v.price.toLocaleString('vi-VN')}đ · kho {v.stock} {v.requiresInput && '· cần nhập'}</p>
      </div>
      <button type="button" onClick={onEdit} className="text-xs opacity-70 hover:opacity-100 px-2">Sửa</button>
      <button type="button" onClick={onDelete} className="text-xs text-red-600 px-2">Xoá</button>
    </li>
  )
}
```

Update the `<SortableVariantRow … />` call site to pass new props:

```tsx
              <SortableVariantRow
                key={v.id}
                v={v}
                selected={selectedIds.has(v.id)}
                onToggle={() => toggleOne(v.id)}
                onEdit={() => setEditing(v)}
                onDelete={() => {
                  if (confirm(`Xoá vĩnh viễn biến thể "${v.name}"? Không thể hoàn tác.`)) deleteMut.mutate(v.id)
                }}
              />
```

- [ ] **Step 3: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/products/VariantsManager.tsx
git commit -m "feat(admin/variants): per-row select checkbox + selection state"
```

---

### Task 2: Bulk-action toolbar

**Files:**
- Modify: `web/src/app/(admin)/admin/products/VariantsManager.tsx`

- [ ] **Step 1: Add bulk mutations**

Inside `VariantsManager`, alongside the existing `deleteMut` / `reorderMut`:

```tsx
  const bulkDeleteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => api.delete(`/admin/products/${productId}/variants/${id}`)))
    },
    onSuccess: () => {
      t.success('Đã xoá biến thể đã chọn')
      setSelectedIds(new Set())
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'xoá thất bại'}`),
  })

  const bulkActiveMut = useMutation({
    mutationFn: async ({ ids, isActive }: { ids: string[]; isActive: boolean }) => {
      await Promise.all(ids.map((id) => api.put(`/admin/products/${productId}/variants/${id}`, { isActive })))
    },
    onSuccess: (_r, vars) => {
      t.success(vars.isActive ? 'Đã hiện biến thể đã chọn' : 'Đã ẩn biến thể đã chọn')
      setSelectedIds(new Set())
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'cập nhật thất bại'}`),
  })

  const bulkPriceMut = useMutation({
    mutationFn: async ({ ids, price }: { ids: string[]; price: number }) => {
      await Promise.all(ids.map((id) => api.put(`/admin/products/${productId}/variants/${id}`, { price })))
    },
    onSuccess: () => {
      t.success('Đã cập nhật giá biến thể đã chọn')
      setSelectedIds(new Set())
      setBulkPriceOpen(false)
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'cập nhật giá thất bại'}`),
  })

  const [bulkPriceOpen, setBulkPriceOpen] = useState(false)
  const [bulkPrice, setBulkPrice] = useState<number>(0)
```

- [ ] **Step 2: Render header bar with select-all + bulk toolbar**

Replace the existing header block (the `<div className="flex items-center justify-between gap-2">` row containing "Biến thể (n)" + Thêm biến thể) with:

```tsx
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs uppercase tracking-wider opacity-60 inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={variants.length > 0 && selectedIds.size === variants.length}
            ref={(el) => {
              if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < variants.length
            }}
            onChange={toggleAll}
          />
          Biến thể ({variants.length})
        </label>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
        >+ Thêm biến thể</button>
      </div>

      {selectedIds.size > 0 && (
        <div className="sticky top-0 z-10 -mx-2 px-2 py-2 bg-yellow-50 border border-yellow-300 rounded-lg flex items-center flex-wrap gap-2 text-xs">
          <span className="font-medium">Đã chọn {selectedIds.size}</span>
          <span className="opacity-60">·</span>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Xoá vĩnh viễn ${selectedIds.size} biến thể đã chọn?`))
                bulkDeleteMut.mutate(Array.from(selectedIds))
            }}
            disabled={bulkDeleteMut.isPending}
            className="px-2 py-1 rounded bg-red-100 hover:bg-red-200 text-red-700 disabled:opacity-50"
          >Xoá</button>
          <button
            type="button"
            onClick={() => bulkActiveMut.mutate({ ids: Array.from(selectedIds), isActive: false })}
            disabled={bulkActiveMut.isPending}
            className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 disabled:opacity-50"
          >Ẩn</button>
          <button
            type="button"
            onClick={() => bulkActiveMut.mutate({ ids: Array.from(selectedIds), isActive: true })}
            disabled={bulkActiveMut.isPending}
            className="px-2 py-1 rounded bg-green-100 hover:bg-green-200 text-green-800 disabled:opacity-50"
          >Hiện</button>
          <button
            type="button"
            onClick={() => { setBulkPrice(0); setBulkPriceOpen(true) }}
            className="px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
          >Sửa giá…</button>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto px-2 py-1 rounded opacity-70 hover:opacity-100"
          >Bỏ chọn</button>
        </div>
      )}
```

- [ ] **Step 3: Bulk-price modal**

Append to the existing `{editing && (...)}` block, as a sibling:

```tsx
      {bulkPriceOpen && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setBulkPriceOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold">Đổi giá {selectedIds.size} biến thể</h3>
              <button onClick={() => setBulkPriceOpen(false)} className="opacity-60 text-xl leading-none">×</button>
            </div>
            <label className="block text-sm">
              <span className="text-xs opacity-70 mb-1 inline-block">Giá mới (VND)</span>
              <input
                type="number"
                min={0}
                step={1000}
                value={bulkPrice}
                onChange={(e) => setBulkPrice(Number(e.target.value))}
                className="clay-input w-full text-sm"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setBulkPriceOpen(false)} className="clay-btn text-sm">Huỷ</button>
              <button
                onClick={() => bulkPriceMut.mutate({ ids: Array.from(selectedIds), price: Math.max(0, bulkPrice) })}
                disabled={bulkPriceMut.isPending}
                className="clay-btn clay-btn--lemon text-sm"
              >{bulkPriceMut.isPending ? 'Đang lưu…' : 'Áp dụng'}</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Type-check + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```

Open admin product modal with several variants. Tick 2-3 row checkboxes → toolbar appears. Click "Xoá" → confirm → toast + rows vanish. Tick another → "Ẩn" → tag "Tạm ẩn" appears. Click "Hiện" → tag removed. Click "Sửa giá…" → modal → enter `15000` → Áp dụng → all selected variants' price field shows 15.000đ.

Also verify select-all checkbox: empty → all → checked; partial → indeterminate.

- [ ] **Step 5: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/products/VariantsManager.tsx
git commit -m "feat(admin/variants): bulk select + delete/hide/show/edit-price toolbar"
```

---

### Task 3: Final build verify

- [ ] **Step 1: Build**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit && npm run build
```
Expected: clean.
