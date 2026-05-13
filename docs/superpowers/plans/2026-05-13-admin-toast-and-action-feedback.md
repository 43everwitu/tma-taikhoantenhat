# Admin Toast + Action Feedback (Variant Delete + Similar)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the perceived "duplicate after delete" by visually flagging soft-deleted variants AND fire a toast on delete success. Add a tiny in-house Toast system + apply it to the parallel admin actions (variant create/update/delete, product create/update/delete/duplicate/toggle, stock add/clear/delete).

**Architecture:** Build a dependency-free `ToastProvider` + `useToast()` hook in `web/src/components/Toast.tsx` (portal + auto-dismiss + stack). Mount once inside `(admin)/layout.tsx`. Existing mutations gain `onSuccess`/`onError` calls to `toast(...)`. Add a "Đã xoá" badge + line-through to inactive variant rows so the user can tell active vs soft-deleted apart at a glance.

**Tech Stack:** Next 16 App Router, React 19, @tanstack/react-query, no new npm dependency.

---

### Task 1: Build minimal Toast component + provider

**Files:**
- Create: `web/src/components/Toast.tsx`
- Modify: `web/src/app/(admin)/layout.tsx`

- [ ] **Step 1: Write Toast.tsx**

Create `web/src/components/Toast.tsx`:

```tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Tone = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  message: string
  tone: Tone
}

interface ToastApi {
  toast: (message: string, tone?: Tone) => void
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastCtx = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) throw new Error('useToast() outside ToastProvider')
  return ctx
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const idRef = useRef(0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const remove = useCallback((id: number) => {
    setItems((xs) => xs.filter((x) => x.id !== id))
  }, [])

  const push = useCallback((message: string, tone: Tone = 'info') => {
    const id = ++idRef.current
    setItems((xs) => [...xs, { id, message, tone }])
    setTimeout(() => remove(id), 3500)
  }, [remove])

  const api: ToastApi = {
    toast: push,
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
    info: (m) => push(m, 'info'),
  }

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {mounted && createPortal(
        <div
          aria-live="polite"
          className="fixed top-4 right-4 z-[1000] flex flex-col gap-2 pointer-events-none"
        >
          {items.map((it) => (
            <div
              key={it.id}
              role="status"
              className={`pointer-events-auto rounded-lg shadow-lg px-4 py-2.5 text-sm min-w-[200px] max-w-[360px] backdrop-blur-sm border ${toneClass(it.tone)}`}
            >
              {it.message}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

function toneClass(tone: Tone) {
  switch (tone) {
    case 'success': return 'bg-green-50 border-green-200 text-green-900'
    case 'error': return 'bg-red-50 border-red-200 text-red-900'
    default: return 'bg-white border-gray-200 text-gray-900'
  }
}
```

- [ ] **Step 2: Mount provider in admin layout**

Read `web/src/app/(admin)/layout.tsx`. It likely already has a `QueryClientProvider`. Wrap the children with `ToastProvider` inside the same client component:

```tsx
import { ToastProvider } from '@/components/Toast'

// inside the existing layout JSX:
<QueryClientProvider client={queryClient}>
  <ToastProvider>
    {children}
  </ToastProvider>
</QueryClientProvider>
```

If `(admin)/layout.tsx` does NOT contain a QueryClientProvider, search for the component that does (likely `web/src/components/QueryProvider.tsx` or inlined in a layout) and wrap there. Either way, ToastProvider must be a descendant of QueryClientProvider AND an ancestor of every `(admin)/admin/*` page.

- [ ] **Step 3: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/components/Toast.tsx web/src/app/\(admin\)/layout.tsx
git commit -m "feat(admin): minimal ToastProvider + useToast hook (no deps)"
```

---

### Task 2: Wire toast into VariantsManager + visual badge for inactive variants

**Files:**
- Modify: `web/src/app/(admin)/admin/products/VariantsManager.tsx`

- [ ] **Step 1: Import useToast**

Add to top of `VariantsManager.tsx`:

```tsx
import { useToast } from '@/components/Toast'
```

- [ ] **Step 2: Use toast in deleteMut + edit modal**

Inside `VariantsManager`, after `const qc = useQueryClient()`:

```tsx
  const t = useToast()
```

Update the `deleteMut`:

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
      t.error('Xoá biến thể thất bại')
    },
    onSuccess: () => {
      t.success('Đã xoá biến thể')
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] })
    },
  })
```

Replace the `alert(...)` previously in `onError` with the toast call above (already done in this snippet).

- [ ] **Step 3: Visual badge for inactive variants**

Locate the `<li>` for each variant (around line 65-83). Replace the row with one that shows a clear "Đã xoá" pill + strike-through name when inactive:

```tsx
        {variants.map((v) => (
          <li
            key={v.id}
            className={`rounded-lg border p-2 text-sm flex items-center gap-2 ${v.isActive ? 'bg-white' : 'bg-red-50 border-red-200'}`}
          >
            <div className="flex-1 min-w-0">
              <p className={`font-medium truncate ${v.isActive ? '' : 'line-through opacity-60'}`}>
                {v.name}
                {!v.isActive && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide bg-red-600 text-white px-1.5 py-0.5 rounded">
                    Đã xoá
                  </span>
                )}
              </p>
              <p className="text-xs opacity-60">{v.price.toLocaleString('vi-VN')}đ · kho {v.stock} {v.requiresInput && `· cần ${v.inputLabel || v.inputType}`}</p>
            </div>
            <button
              type="button"
              onClick={() => setEditing(v)}
              className="text-xs opacity-70 hover:opacity-100 px-2"
            >Sửa</button>
            {v.isActive && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Xoá biến thể "${v.name}"?`)) deleteMut.mutate(v.id)
                }}
                className="text-xs text-red-600 px-2"
              >Xoá</button>
            )}
          </li>
        ))}
```

Now soft-deleted variants render with red bg + strikethrough + "Đã xoá" badge, no Xoá button (cannot re-delete an already-deleted row → eliminates the perceived "duplicate after delete" bug).

- [ ] **Step 4: Toast on save (create/update)**

Inside `VariantEditModal`, after the `useState`s, add:

```tsx
  const t = useToast()
```

Wire the `mutation.onSuccess`:

```tsx
  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name,
        description: form.description || null,
        price: Number(form.price),
        sortOrder: Number(form.sortOrder),
        requiresInput: form.requiresInput,
        inputLabel: form.inputLabel || null,
        inputPlaceholder: form.inputPlaceholder || null,
        inputType: form.inputType,
        imageUrl: form.imageUrl || null,
        ...(variant ? { isActive: form.isActive } : {}),
      }
      if (variant) return api.put(`/admin/products/${productId}/variants/${variant.id}`, payload)
      return api.post(`/admin/products/${productId}/variants`, payload)
    },
    onSuccess: () => {
      t.success(variant ? 'Đã cập nhật biến thể' : 'Đã thêm biến thể')
      onSaved()
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Lỗi'
      setErr(msg)
      t.error(`Lỗi: ${msg}`)
    },
  })
```

- [ ] **Step 5: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```
Expected: `TypeScript: No errors found`.

- [ ] **Step 6: Manual smoke**

1. Open admin product modal with variants. Tick "Hiện đã xoá".
2. Click Xoá on an active variant → toast "Đã xoá biến thể" pops top-right; row stays visible with red bg + strikethrough + "Đã xoá" badge; Xoá button gone.
3. Untick "Hiện đã xoá" → soft-deleted row disappears.
4. Click + Thêm biến thể → fill name → Lưu → toast "Đã thêm biến thể"; modal closes.
5. Edit existing → change name → Lưu → toast "Đã cập nhật biến thể".

- [ ] **Step 7: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/products/VariantsManager.tsx
git commit -m "feat(admin): toast feedback + Đã xoá badge for variant CRUD"
```

---

### Task 3: Toast in product CRUD (page.tsx mutations)

**Files:**
- Modify: `web/src/app/(admin)/admin/products/page.tsx`

- [ ] **Step 1: Import + use hook**

Add to top of file:
```tsx
import { useToast } from '@/components/Toast'
```

Inside the page component, after `const queryClient = useQueryClient()`:
```tsx
  const t = useToast()
```

- [ ] **Step 2: Wire toasts into existing mutations**

Find the mutations (around lines 99-135) and add `onSuccess`/`onError` toast calls.

Replace the `createMutation`:
```tsx
  const createMutation = useMutation({
    mutationFn: (body: ProductForm) => api.post('/admin/products', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
      closeModal()
      t.success('Đã thêm sản phẩm')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'thêm thất bại'}`),
  })
```

Update the `updateMutation` to call toast:
```tsx
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProductForm }) =>
      api.put(`/admin/products/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
      closeModal()
      t.success('Đã cập nhật sản phẩm')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'cập nhật thất bại'}`),
  })
```

Update the `toggleMutation`:
```tsx
  const toggleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/admin/products/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
      t.success('Đã đổi trạng thái')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'đổi trạng thái thất bại'}`),
  })
```

Update the `deleteMutation`:
```tsx
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
      t.success('Đã xoá sản phẩm')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'xoá thất bại'}`),
  })
```

Update the `duplicateMutation`:
```tsx
  const duplicateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/products/${id}/duplicate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
      t.success('Đã nhân đôi sản phẩm')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'nhân đôi thất bại'}`),
  })
```

(Preserve any `closeModal()` / state-reset calls already present in each mutation's `onSuccess` — read the existing block at lines 99-135 and merge, do not blindly overwrite.)

- [ ] **Step 3: Type-check + manual smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```

Expected: clean. Open `/admin/products`. Create / edit / delete / duplicate / toggle a product → toast pops for each action.

- [ ] **Step 4: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/products/page.tsx
git commit -m "feat(admin/products): toast feedback for create/update/toggle/delete/duplicate"
```

---

### Task 4: Toast in stock detail mutations

**Files:**
- Modify: `web/src/app/(admin)/admin/stock/[productId]/page.tsx`

- [ ] **Step 1: Import + use hook**

Add at top:
```tsx
import { useToast } from '@/components/Toast'
```

Inside the component, after `const queryClient = useQueryClient()`:
```tsx
  const t = useToast()
```

- [ ] **Step 2: Wire mutations**

Update the four mutations (around lines 54-86):

```tsx
  const addMutation = useMutation({
    mutationFn: (items: string[]) => {
      const payload: { items: string[]; variantId?: number } = { items }
      if (variantId) payload.variantId = Number(variantId)
      return api.post(`/admin/stock/${productId}`, payload)
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stock', productId] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      setNewItems('')
      const added = (res?.data as { added?: number } | undefined)?.added ?? 0
      t.success(`Đã thêm ${added} key`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'thêm thất bại'}`),
  })

  const clearUnsoldMutation = useMutation({
    mutationFn: () => api.delete(`/admin/stock/${productId}/unsold`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stock', productId] })
      const deleted = (res?.data as { deleted?: number } | undefined)?.deleted ?? 0
      t.success(`Đã xoá ${deleted} key chưa bán`)
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'xoá thất bại'}`),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.patch(`/admin/stock/${productId}/${id}`, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stock', productId] })
      setEditingId(null)
      setEditDraft('')
      t.success('Đã cập nhật key')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'cập nhật thất bại'}`),
  })

  const deleteItemMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/stock/${productId}/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stock', productId] })
      t.success('Đã xoá key')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'xoá thất bại'}`),
  })
```

- [ ] **Step 3: Type-check + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```

Open `/admin/stock/<id>`: add a key → toast "Đã thêm 1 key"; edit → "Đã cập nhật"; delete a row → "Đã xoá key"; clear unsold → "Đã xoá N key chưa bán".

- [ ] **Step 4: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/stock/\[productId\]/page.tsx
git commit -m "feat(admin/stock): toast feedback for add/edit/delete/clear-unsold"
```

---

### Task 5: Toast in QuickAddKeysModal

**Files:**
- Modify: `web/src/app/(admin)/admin/stock/QuickAddKeysModal.tsx`

- [ ] **Step 1: Import + use**

```tsx
import { useToast } from '@/components/Toast'
// inside component:
const t = useToast()
```

- [ ] **Step 2: Wire mutation**

Replace the existing `mutation` block:

```tsx
  const mutation = useMutation({
    mutationFn: async () => {
      const items = text.split('\n').map((s) => s.trim()).filter(Boolean)
      if (items.length === 0) throw new Error('Chưa nhập key nào')
      if (!productId) throw new Error('Chưa chọn sản phẩm')
      if (hasVariants && !variantId) throw new Error('Sản phẩm có biến thể — phải chọn biến thể')
      const payload: { items: string[]; variantId?: number } = { items }
      if (variantId) payload.variantId = Number(variantId)
      return api.post(`/admin/stock/${productId}`, payload)
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['admin', 'products'] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] })
      const added = (res?.data as { added?: number } | undefined)?.added ?? 0
      t.success(`Đã thêm ${added} key`)
      onClose()
    },
    onError: (e) => {
      const msg = e instanceof Error ? e.message : 'Lỗi'
      setErr(msg)
      t.error(`Lỗi: ${msg}`)
    },
  })
```

- [ ] **Step 3: Type-check + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```

`/admin/stock`: open Thêm key → submit → toast pops.

- [ ] **Step 4: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/stock/QuickAddKeysModal.tsx
git commit -m "feat(admin/stock): toast feedback for QuickAddKeys submit"
```

---

### Task 6: Final QA + tag

- [ ] **Step 1: Build**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit && npm run build
```
Expected: clean.

- [ ] **Step 2: Smoke matrix**

| Action | Expected toast |
|---|---|
| Variant create | Đã thêm biến thể |
| Variant update | Đã cập nhật biến thể |
| Variant delete | Đã xoá biến thể (+ row gets red bg + strikethrough + "Đã xoá" badge) |
| Product create | Đã thêm sản phẩm |
| Product update | Đã cập nhật sản phẩm |
| Product toggle | Đã đổi trạng thái |
| Product delete | Đã xoá sản phẩm |
| Product duplicate | Đã nhân đôi sản phẩm |
| Stock add | Đã thêm N key |
| Stock edit | Đã cập nhật key |
| Stock delete one | Đã xoá key |
| Stock clear unsold | Đã xoá N key chưa bán |
| QuickAddKeys submit | Đã thêm N key |

For any error path: toast "Lỗi: …" appears with red styling.

- [ ] **Step 3: Tag + CLAUDE.md**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git tag -a v0.24-admin-toast -m "Admin Toast system + reactive feedback for variant/product/stock CRUD"
```

Append to `CLAUDE.md` "Sub-projects shipped":
```
| `v0.24-admin-toast` | minimal Toast provider in admin layout + success/error toasts on every variant/product/stock mutation; soft-deleted variants get red bg + strikethrough + "Đã xoá" badge |
```

Commit:
```bash
git add CLAUDE.md
git commit -m "docs: log v0.24-admin-toast"
```
