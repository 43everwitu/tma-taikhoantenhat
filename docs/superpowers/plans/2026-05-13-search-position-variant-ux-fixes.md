# Search Position + Variant UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move SearchBox below category strip, render all variants on product detail without horizontal scroll, fix variant delete bug, ensure /stock UX clearly supports per-variant key add.

**Architecture:** Reposition `<SearchBox>` in home `page.tsx`. New `.miniapp-variant-grid` CSS for wrap-grid + new variant-card component dropping chip-row scroll on product detail. Diagnose + repair variant delete (likely a stale-data invalidation or stock FK preventing soft-delete display). Audit `/stock` to surface variant key-add path more prominently.

**Tech Stack:** Next 16, React 19, Tailwind v4, better-sqlite3.

---

### Task 1: Move SearchBox below category strip on home

**Files:**
- Modify: `web/src/app/(miniapp)/page.tsx`

- [ ] **Step 1: Move SearchBox JSX block**

In `web/src/app/(miniapp)/page.tsx`, locate the SearchBox section at the top of the JSX:

```tsx
<div className="mb-3">
  <SearchBox value={q} onChange={setQ} placeholder="Tìm sản phẩm…" />
</div>
<section className="miniapp-hero">
  ...
</section>
```

Cut the `<div className="mb-3">…</div>` block. Paste it **after** the category section (`<section className="miniapp-section">` containing categories). The new ordering: hero → categories section → SearchBox → announcements → rails.

Resulting structure:
```tsx
<MiniAppShell>
  <section className="miniapp-hero">…</section>
  <section className="miniapp-section">
    <div className="miniapp-section-title"><span>{t.home.categoriesTitle}</span></div>
    {/* CategoryStrip render */}
  </section>
  <div className="mb-3 mt-2">
    <SearchBox value={q} onChange={setQ} placeholder="Tìm sản phẩm…" />
  </div>
  {/* announcements + rails */}
</MiniAppShell>
```

- [ ] **Step 2: Verify**

Hard-refresh `http://localhost:3001`. Confirm order: hero → categories → search → announcements → rails. Search dropdown still works.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/\(miniapp\)/page.tsx
git commit -m "feat(miniapp): move SearchBox below category strip on home"
```

---

### Task 2: Variant grid on product detail (no horizontal scroll)

**Files:**
- Modify: `web/src/app/(miniapp)/components/VariantPicker.tsx`
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add variant-grid CSS**

Append to `web/src/app/globals.css` inside `@layer components`:

```css
.miniapp-variant-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: .5rem;
}
@media (min-width: 480px) {
  .miniapp-variant-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (min-width: 768px) {
  .miniapp-variant-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.miniapp-variant-tile {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: .25rem;
  padding: .625rem .75rem;
  border-radius: 14px;
  background: var(--tg-bg-2, #fff);
  border: 1px solid color-mix(in srgb, var(--brand-ink) 10%, transparent);
  color: var(--brand-ink);
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, background .15s, transform .1s;
  min-height: 64px;
}
.miniapp-variant-tile:hover { border-color: color-mix(in srgb, var(--brand-gold-deep) 50%, transparent); }
.miniapp-variant-tile:active { transform: scale(.98); }
.miniapp-variant-tile[aria-pressed="true"] {
  border-color: var(--brand-gold-deep, #b88500);
  background: var(--brand-gold-soft, #fff7e0);
  box-shadow: 0 0 0 1px var(--brand-gold-deep, #b88500) inset;
}
.miniapp-variant-tile:disabled,
.miniapp-variant-tile[aria-disabled="true"] {
  opacity: .45;
  cursor: not-allowed;
}
.miniapp-variant-tile .v-name {
  font-size: .875rem;
  font-weight: 600;
  line-height: 1.25;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.miniapp-variant-tile .v-meta {
  display: flex;
  align-items: center;
  gap: .5rem;
  width: 100%;
  margin-top: auto;
}
.miniapp-variant-tile .v-price {
  font-size: .8125rem;
  font-weight: 700;
  color: var(--brand-gold-deep, #b88500);
}
.miniapp-variant-tile .v-stock {
  margin-left: auto;
  font-size: .6875rem;
  padding: .125rem .375rem;
  border-radius: 999px;
  background: color-mix(in srgb, var(--brand-ink) 8%, transparent);
}
.miniapp-variant-tile .v-stock--out { color: #dc2626; }
.miniapp-variant-tile .v-stock--in { color: #16a34a; }
```

- [ ] **Step 2: Rewrite VariantPicker to use grid**

Replace the contents of `web/src/app/(miniapp)/components/VariantPicker.tsx`:

```tsx
'use client'

import { formatPrice } from '@/lib/utils'

export interface Variant {
  id: string
  name: string
  description: string
  price: number
  stock: number
  requiresInput: boolean
  inputLabel: string | null
  inputPlaceholder: string | null
  inputType?: string
  imageUrl?: string
}

interface Props {
  variants: Variant[]
  selectedId: string | null
  onSelect: (id: string) => void
  inputValue: string
  onInputChange: (v: string) => void
}

export function VariantPicker({ variants, selectedId, onSelect, inputValue, onInputChange }: Props) {
  const selected = variants.find((v) => v.id === selectedId) ?? null

  return (
    <div className="space-y-2">
      <div className="miniapp-variant-grid">
        {variants.map((v) => {
          const out = v.stock <= 0
          return (
            <button
              key={v.id}
              type="button"
              className="miniapp-variant-tile"
              aria-pressed={selectedId === v.id}
              aria-disabled={out}
              disabled={out}
              onClick={() => onSelect(v.id)}
            >
              <span className="v-name">{v.name}</span>
              <span className="v-meta">
                <span className="v-price">{formatPrice(v.price)}</span>
                <span className={`v-stock ${out ? 'v-stock--out' : 'v-stock--in'}`}>
                  {out ? 'Hết' : `Còn ${v.stock}`}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      {selected?.description && (
        <div
          className="rich-text text-xs opacity-80"
          dangerouslySetInnerHTML={{ __html: selected.description }}
        />
      )}
      {selected?.requiresInput && (
        <div>
          <label className="block text-xs opacity-70 mb-1">{selected.inputLabel || 'Thông tin'}</label>
          {selected.inputType === 'textarea' ? (
            <textarea
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={selected.inputPlaceholder || ''}
              rows={3}
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={{
                background: 'var(--tg-bg-2, #fff)',
                border: '1px solid color-mix(in srgb, var(--brand-ink) 14%, transparent)',
              }}
              minLength={3}
              maxLength={500}
              required
            />
          ) : (
            <input
              type={selected.inputType || 'text'}
              value={inputValue}
              onChange={(e) => onInputChange(e.target.value)}
              placeholder={selected.inputPlaceholder || ''}
              className="w-full rounded-xl px-3 py-2 text-sm"
              style={{
                background: 'var(--tg-bg-2, #fff)',
                border: '1px solid color-mix(in srgb, var(--brand-ink) 14%, transparent)',
              }}
              minLength={3}
              maxLength={200}
              required
            />
          )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Type-check**

```bash
cd web && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Visual smoke test**

Open a product with variants (e.g. an imported WP product) at `/san-pham/<slug>`. Verify:
- All variants visible at once (wrap to multiple rows)
- No horizontal scroll
- Selected variant has gold border + soft bg
- Out-of-stock variants dimmed + "Hết" badge
- Price + stock badge visible per tile

- [ ] **Step 5: Commit**

```bash
git add web/src/app/\(miniapp\)/components/VariantPicker.tsx web/src/app/globals.css
git commit -m "feat(miniapp): variant grid with full list visible on product detail"
```

---

### Task 3: Diagnose + fix variant delete bug

**Files (likely):**
- Modify: `web/src/app/(admin)/admin/products/VariantsManager.tsx`
- Possibly: `src/api/routes/admin/variants.js` or `src/services/variantService.js`

- [ ] **Step 1: Reproduce + capture error**

Steps to reproduce:
1. Open `/admin/products`, edit a product that has variants
2. In the Variants section, click "Xoá" on a variant
3. Confirm the browser dialog
4. Open DevTools → Network tab. Watch the `DELETE /api/v1/admin/products/:pid/variants/:vid` request.

Capture: response status + body. Also check React-Query cache invalidation — does the variant disappear from the UI?

- [ ] **Step 2: Analyze response**

Three plausible failure modes:

  - (a) **404 NOT_FOUND** — softDelete `changes === 0`. Investigate: is the variant already inactive, or is `productId` mismatched in the route? Add a server log:

    ```js
    // In src/api/routes/admin/variants.js, top of DELETE handler:
    console.log('[variant.delete]', { productId, variantId, headers: req.headers.authorization?.slice(0, 12) });
    ```

  - (b) **200 OK but UI not refreshing** — query invalidation key mismatch. The mutation invalidates `['admin', 'variants', productId]` but the variants list query might use a different key (e.g. `['admin', 'variants', productId, 'panel']` or with `includeInactive` flag). Check VariantsManager's list query key.

  - (c) **Permission denied (403)** — missing `products.write` permission. Check `/admin/me` response.

- [ ] **Step 3: Apply matching fix**

For (b) — most likely. The list query in `VariantsManager` may need an explicit invalidation match. Verify by reading lines 1-50 of `VariantsManager.tsx` for the query key, and ensure the delete mutation invalidates the exact same key. If not, fix the mutation's `onSuccess`:

```tsx
onSuccess: () => {
  qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
  qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] })
  // Also invalidate the public product detail in case admin tab is open
}
```

For (a) — add a guard: if softDelete reports `changes === 0`, check whether the variant is already inactive and return 200 with a no-op message instead of 404, since the UX is unchanged either way. Patch `src/api/routes/admin/variants.js:74-81`:

```js
router.delete('/:id', (req, res) => {
  const productId = parseInt(req.params.productId);
  const variantId = parseInt(req.params.id);
  const existing = db.prepare('SELECT id, is_active FROM product_variants WHERE id = ? AND product_id = ?').get(variantId, productId);
  if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  if (existing.is_active) {
    variantService.softDelete(db, productId, variantId);
  }
  auditService.log(req.admin?.adminId, 'variant.delete', 'variant', variantId, { productId }, req.ip);
  res.json({ success: true });
});
```

For (c) — assign `products.write` to the role or check `permissionService.js`.

- [ ] **Step 4: Re-test**

Delete a variant. Confirm:
- Network: 200 success
- UI: variant disappears from list immediately
- DB: `SELECT is_active FROM product_variants WHERE id = ?` returns 0

- [ ] **Step 5: Commit**

```bash
git add <changed files>
git commit -m "fix(admin): variant delete now refreshes UI and handles already-inactive case"
```

---

### Task 4: Audit + improve /stock per-variant key-add UX

**Files:**
- Modify: `web/src/app/(admin)/admin/stock/page.tsx` (likely)
- Possibly: `web/src/app/(admin)/admin/stock/QuickAddKeysModal.tsx`

- [ ] **Step 1: Audit current UX**

Open `/admin/stock` for a product with variants (e.g. an imported WP product). Observe:
- Does the "Biến thể" expand button appear?
- Does the breakdown panel show per-variant "+ Thêm key"?
- Does the main "Thêm key" button (QuickAddKeysModal) prompt for variant when product has variants?

Document findings in `docs/superpowers/specs/2026-05-13-search-position-variant-ux-fixes-design.md` (create alongside this plan).

- [ ] **Step 2: If "Biến thể" button missing** — add it

The expand toggle should appear for any product where `variantsCount > 0`. Verify the product list query fetches variant count. If not, add a server-side enrichment to `/admin/stock` listing. Add column to the row:

```tsx
{p.variantsCount > 0 && (
  <button
    onClick={() => setExpandedProductId(expandedProductId === p.id ? null : p.id)}
    className="text-xs px-2 py-1 rounded bg-purple-100 hover:bg-purple-200"
  >
    {expandedProductId === p.id ? 'Đóng' : 'Biến thể'} ({p.variantsCount})
  </button>
)}
```

- [ ] **Step 3: If QuickAddKeysModal doesn't prompt variant** — add prominent variant chooser

Open `web/src/app/(admin)/admin/stock/QuickAddKeysModal.tsx`. Ensure the variant select renders only when `variants.length > 0`, and is required when present (e.g. red asterisk + validation):

```tsx
{variants.length > 0 && (
  <div className="space-y-1">
    <label className="text-xs font-medium">
      Biến thể <span className="text-red-500">*</span>
    </label>
    <select
      value={variantId}
      onChange={(e) => setVariantId(e.target.value)}
      className="w-full rounded-lg border px-2 py-1.5 text-sm"
      required
    >
      <option value="">— Chọn biến thể —</option>
      {variants.map((v) => (
        <option key={v.id} value={v.id}>{v.name} (kho {v.stock})</option>
      ))}
    </select>
    {!variantId && (
      <p className="text-xs text-red-600">Vui lòng chọn biến thể trước khi nhập key.</p>
    )}
  </div>
)}
```

And in the submit handler, block submission if variants exist but none selected:

```tsx
if (variants.length > 0 && !variantId) {
  alert('Sản phẩm có biến thể — phải chọn biến thể trước khi thêm key.')
  return
}
```

- [ ] **Step 4: Visual smoke test**

For a product with variants on `/admin/stock`:
1. Click main "Thêm key" → modal shows variant select with red asterisk
2. Try to submit without choosing → blocked with alert
3. Choose a variant → submit → keys land on that variant only (verify via "Biến thể" breakdown panel)
4. Click "Biến thể" expand → per-variant breakdown shows; click per-variant "+ Thêm key" → adds to that variant directly

For a product without variants: modal stays simple (no variant select shown).

- [ ] **Step 5: Commit**

```bash
git add <changed files>
git commit -m "feat(admin/stock): require variant selection when product has variants"
```

---

### Task 5: Final QA + tag

- [ ] **Step 1: Type-check + build**

```bash
cd web && npx tsc --noEmit && npm run build
```
Expected: clean.

- [ ] **Step 2: Tag**

```bash
git tag -a v0.20-search-position-variant-ux -m "Move SearchBox below categories, variant grid on detail, fix variant delete, /stock per-variant key-add"
```

- [ ] **Step 3: Update CLAUDE.md sub-projects table**

Append row:
```
| `v0.20-search-position-variant-ux` | search-below-categories, variant grid on detail, fix variant delete, /stock per-variant key-add |
```

Commit:
```bash
git add CLAUDE.md
git commit -m "docs: log v0.20-search-position-variant-ux"
```
