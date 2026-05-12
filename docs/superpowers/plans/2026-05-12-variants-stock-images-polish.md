# Variants Stock + Images + WP Migration + Modal/Editor Polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** /stock supports per-variant key add/list/delivery; variants have their own image (falls back to product image); admin modals dismiss on backdrop click; RichEditorRich toolbar sticks; legacy WP variations imported into `product_variants`.

**Architecture:** Migration 019 adds `image_url` to `product_variants`. WP migration gains pass-4 `--variations` that parses `post_type='product_variation'` rows + their meta (`_price`, `_stock`, `attribute_*`, `_thumbnail_id`). Admin /stock grows a per-product expand drawer showing per-variant stock with add/delete actions; QuickAddKeysModal accepts a variant pick. VariantPicker swaps detail image when selected variant has its own image. Order delivery fallback in `orderService` narrows by `variant_id`. RichEditorRich's toolbar moves to `position: sticky`.

**Tech Stack:** Existing — better-sqlite3, sharp, Next 16, TipTap. No new deps.

---

## File Structure

- `src/database/migrations/019_variant_image.js` — **CREATE**. Add `image_url TEXT` to `product_variants`.
- `src/services/variantService.js` — **MODIFY**. Persist + expose `image_url`.
- `src/api/routes/admin/variants.js` — **MODIFY**. `imageUrl` in Zod + shape.
- `src/api/routes/public.js` — **MODIFY**. `variants[].imageUrl` resolved (variant own OR fallback product image).
- `src/api/routes/admin/stock.js` — **MODIFY** (lightly). The existing `GET /:productId` already accepts `?variantId=` (sub-project H). Confirm + ensure `POST` bulk accepts variantId per insert.
- `src/services/orderService.js` — **MODIFY**. `confirmAndDeliver` fallback narrows by `variant_id`.
- `scripts/wp-migration/extract-variations.js` — **CREATE**. Parses post_type='product_variation' from SQL dump + their meta.
- `scripts/wp-migration/load-variations.js` — **CREATE**. INSERTs into `product_variants`.
- `scripts/migrate-wp.js` — **MODIFY**. Add `--variations` CLI branch.
- `web/src/app/(admin)/admin/products/VariantsManager.tsx` — **MODIFY**. Add image picker (re-uses MediaLibrary + ImageUploader from sub-project G).
- `web/src/app/(admin)/admin/stock/page.tsx` — **MODIFY**. Per-row expand → variant breakdown table with "Thêm key" per variant.
- `web/src/app/(admin)/admin/stock/QuickAddKeysModal.tsx` — **MODIFY**. Variant select dropdown beneath product select.
- `web/src/app/(miniapp)/san-pham/[slug]/page.tsx` — **MODIFY**. Swap hero image when variant.imageUrl present.
- `web/src/app/(miniapp)/components/VariantPicker.tsx` — **MODIFY**. Expose `imageUrl` field on `Variant` type.
- `web/src/components/RichEditorRich.tsx` — **MODIFY**. Toolbar `position: sticky`.
- `web/src/app/(admin)/admin/products/page.tsx` — **MODIFY**. Verify backdrop click dismisses (fix if not).

---

## Notes for the Engineer

- **Read `web/AGENTS.md`** before frontend.
- **Tests:** `node --test tests/...` under Node 20.
- **Variant image fallback:** Backend computes `effectiveImageUrl = variant.imageUrl || product.imageUrl` in the `/products/:slug` response so the frontend gets ready-to-render URLs.
- **WP variations:** The SQL dump has ~200 `product_variation` rows. Each has `post_parent` pointing at a `product` row. Variation prices/stock live in `postmeta` (`_price`, `_stock`). Variation name is **not** stored as `post_title` — it's built from `attribute_*` meta (e.g. `attribute_pa_thoi-gian = "3-thang"` → display "3 tháng"). Skip ranking — store the raw attribute value as name with simple slug-to-Title conversion.
- **Delivery vs reservation:** `orderService.create` reservation already branches by `variant_id` (sub-project H). The latent gap is in `confirmAndDeliver`'s fallback `getFreeStock` when reservations are lost — narrow by `variant_id` too.

---

## Task 1: Migration 019 + variantService image_url

**Files:**
- Create: `src/database/migrations/019_variant_image.js`
- Modify: `src/services/variantService.js`
- Modify: `tests/services/variantService.test.js` (add input_type AND image_url to in-memory schema)

- [ ] Step 1: Create `src/database/migrations/019_variant_image.js`:

```js
function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'product_variants', 'image_url')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN image_url TEXT`);
  }
}

module.exports = { up };
```

- [ ] Step 2: Apply migration:

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
cp data/shop.db data/shop.db.bak-$(date +%s)
source ~/.nvm/nvm.sh && nvm use 20 && node -e "require('./src/database')"
sqlite3 data/shop.db "SELECT COUNT(*) FROM pragma_table_info('product_variants') WHERE name='image_url'"
```
Expected: 1.

- [ ] Step 3: Update `src/services/variantService.js`:

In `listByProduct` SELECT, add `image_url` to the column list.
In `getById` SELECT, add `image_url`.
In `create({...})` destructure, add `imageUrl = null`. Update the INSERT column list to include `image_url`, bind `imageUrl` as the matching positional param.
In `update()` `map` object, add: `imageUrl: 'image_url',`

(Each edit is one line + one extra spot in the INSERT — read the existing file shape and integrate cleanly.)

- [ ] Step 4: Update tests `tests/services/variantService.test.js`. In the `makeDb()` `CREATE TABLE product_variants` statement, add `image_url TEXT` to the end of the column list (before the closing paren).

Add new test:

```js
test('create with imageUrl persists it; listByProduct surfaces it', () => {
  const db = makeDb();
  variantService.create(db, { productId: 1, name: 'Z', price: 100, imageUrl: '/uploads/x.webp' });
  const row = variantService.listByProduct(db, 1)[0];
  assert.equal(row.image_url, '/uploads/x.webp');
});
```

Run:
```bash
node --test tests/services/variantService.test.js 2>&1 | tail -10
```
Expected: all pass (existing 7 + new = 8).

- [ ] Step 5: Commit:
```bash
git add src/database/migrations/019_variant_image.js src/services/variantService.js tests/services/variantService.test.js
git commit -m "feat(variants): image_url column + service support"
```

## Task 2: Admin + public API surface image_url

**Files:**
- Modify: `src/api/routes/admin/variants.js`
- Modify: `src/api/routes/public.js`

- [ ] Step 1: In `src/api/routes/admin/variants.js`, extend `variantBody` Zod:

```js
imageUrl: z.string().max(500).nullable().optional(),
```

(Add right after `inputType`.)

In `shapeVariant(v)`, add:
```js
imageUrl: v.image_url || null,
```

- [ ] Step 2: In `src/api/routes/public.js` `GET /products/:slug` variant mapper, change to:

```js
const variants = variantRows.map(v => ({
  id: String(v.id),
  name: v.name,
  description: v.description || '',
  price: v.price,
  sortOrder: v.sort_order,
  stock: variantService.countAvailableStock(db, p.id, v.id),
  requiresInput: !!v.requires_input,
  inputLabel: v.input_label || null,
  inputPlaceholder: v.input_placeholder || null,
  inputType: v.input_type || 'text',
  imageUrl: v.image_url || p.image_url || '',
}));
```

(`p.image_url` is the parent product's image — the fallback.)

- [ ] Step 3: Reload + verify:
```bash
touch src/index.js && sleep 4
node -e "
require('dotenv').config();
async function go() {
  const tok = (await (await fetch('http://localhost:3000/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:process.env.ADMIN_INITIAL_PASSWORD})})).json()).data.token;
  // Create variant with imageUrl
  await fetch('http://localhost:3000/api/v1/admin/products/9/variants',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+tok},body:JSON.stringify({name:'IMG_TEST',price:1000,imageUrl:'/uploads/products/9-tai-khoan-grammarly-premium-gia-re-original.webp'})}).then(r=>r.json()).then(j=>console.log('created:',j.data?.id));
  // Public detail returns imageUrl
  const det = await (await fetch('http://localhost:3000/api/v1/products/tai-khoan-grammarly-premium-gia-re')).json();
  const found = det.data.variants.find(v => v.name === 'IMG_TEST');
  console.log('found variant imageUrl:', found?.imageUrl);
}
go();
"
```
Expected: shows the variant's imageUrl (the URL we wrote).

- [ ] Step 4: Commit:
```bash
git add src/api/routes/admin/variants.js src/api/routes/public.js
git commit -m "feat(api): variant imageUrl in admin + public; fallback to product image"
```

## Task 3: orderService delivery fallback by variant

**Files:**
- Modify: `src/services/orderService.js`

- [ ] Step 1: Read `src/services/orderService.js`. Find `confirmAndDeliver` (or whatever delivery function pulls free stock when reservations are missing). Find the `getFreeStock`-like query that selects from `stock`. Narrow by `variant_id` matching the order's `variant_id`.

Specifically: find any `SELECT ... FROM stock WHERE product_id = ? AND is_sold = 0 ...` that runs during delivery. If it doesn't currently have a `variant_id` clause, add the branch: if the order has `variant_id`, append `AND variant_id = ?`; else `AND variant_id IS NULL`.

If the function pre-fetches the order row before querying stock, the order row already has `variant_id` available — pass it through.

- [ ] Step 2: Run full regression:
```bash
node --test tests/ 2>&1 | tail -5
```
Expected: 0 fail.

- [ ] Step 3: Commit:
```bash
git add src/services/orderService.js
git commit -m "fix(orders): confirmAndDeliver fallback narrows free-stock query by variant_id"
```

## Task 4: Admin /stock per-variant expand + add-key UI

**Files:**
- Modify: `web/src/app/(admin)/admin/stock/page.tsx`
- Modify: `web/src/app/(admin)/admin/stock/QuickAddKeysModal.tsx`

- [ ] Step 1: Open `QuickAddKeysModal.tsx`. Add `variantId` state + a select that fetches variants when product changes:

Add to imports at top:
```tsx
import { useQuery } from '@tanstack/react-query'
```

Inside the component, after `const [productId, setProductId] = useState(...)`:

```tsx
const [variantId, setVariantId] = useState<string>('')
const variantsQuery = useQuery({
  queryKey: ['admin', 'variants', productId],
  queryFn: () => api.get<{ id: string; name: string; stock: number }[]>(`/admin/products/${productId}/variants`),
  enabled: !!productId,
})
const variants = variantsQuery.data?.data ?? []
```

Update the mutation body to include `variantId`:
```tsx
mutationFn: async () => {
  const items = text.split('\n').map((s) => s.trim()).filter(Boolean)
  if (items.length === 0) throw new Error('Chưa nhập key nào')
  if (!productId) throw new Error('Chưa chọn sản phẩm')
  const payload: { items: string[]; variantId?: number } = { items }
  if (variantId) payload.variantId = Number(variantId)
  return api.post(`/admin/stock/${productId}`, payload)
},
```

Add a variant select beneath the product select:
```tsx
{variants.length > 0 && (
  <label className="block text-sm">
    <span className="text-xs text-clay-charcoal mb-1 inline-block">Biến thể</span>
    <select
      value={variantId}
      onChange={(e) => setVariantId(e.target.value)}
      className="clay-input w-full text-sm"
    >
      <option value="">(Không biến thể — sản phẩm chung)</option>
      {variants.map((v) => (
        <option key={v.id} value={v.id}>{v.name} (kho {v.stock})</option>
      ))}
    </select>
  </label>
)}
```

- [ ] Step 2: Stock page per-row expand. Open `web/src/app/(admin)/admin/stock/page.tsx`.

Replace the existing `cardActions` function with one that has both "Xem kho" + "Biến thể" toggle. Add row-expand state at the page level:

Inside `StockIndexPage()` add:
```tsx
const [expanded, setExpanded] = useState<string | null>(null)
```

Add a button column (new column entry, placed before the existing actions column):
```tsx
  {
    header: '',
    className: 'text-right',
    cell: (p) => (
      <button
        type="button"
        onClick={() => setExpanded(expanded === p.id ? null : p.id)}
        className="text-xs px-2 py-1 rounded-full bg-purple-100 text-purple-700"
      >Biến thể</button>
    ),
  },
```

After the `<ResponsiveTable>` block but inside the same `space-y-4` div, render the expanded breakdown panel:

```tsx
{expanded && (
  <VariantBreakdownPanel productId={expanded} onClose={() => setExpanded(null)} />
)}
```

Create the helper component above the default export:

```tsx
function VariantBreakdownPanel({ productId, onClose }: { productId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'variants', productId, 'panel'],
    queryFn: () => api.get<{ id: string; name: string; stock: number }[]>(`/admin/products/${productId}/variants`),
  })
  const variants = data?.data ?? []
  const [addVar, setAddVar] = useState<string | null>(null)
  const [keyText, setKeyText] = useState('')

  const addMut = useMutation({
    mutationFn: async () => {
      const items = keyText.split('\n').map((s) => s.trim()).filter(Boolean)
      const payload: { items: string[]; variantId?: number } = { items }
      if (addVar) payload.variantId = Number(addVar)
      return api.post(`/admin/stock/${productId}`, payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId, 'panel'] })
      qc.invalidateQueries({ queryKey: ['admin', 'products'] })
      setAddVar(null); setKeyText('')
    },
  })

  return (
    <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Biến thể của sản phẩm #{productId}</h3>
        <button onClick={onClose} className="text-xs opacity-60">Đóng ×</button>
      </div>

      {isLoading && <p className="text-xs opacity-60">Đang tải…</p>}

      {!isLoading && variants.length === 0 && <p className="text-xs opacity-60">Sản phẩm này chưa có biến thể.</p>}

      <ul className="space-y-1.5">
        {variants.map((v) => (
          <li key={v.id} className="rounded-lg bg-white border border-purple-100 p-2 text-sm flex items-center gap-2">
            <span className="flex-1 min-w-0 truncate font-medium">{v.name}</span>
            <span className="text-xs opacity-70">kho {v.stock}</span>
            <button
              type="button"
              onClick={() => setAddVar(v.id)}
              className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
            >+ Thêm key</button>
          </li>
        ))}
      </ul>

      {addVar && (
        <div className="bg-white rounded-lg p-3 space-y-2 border border-purple-100">
          <p className="text-xs opacity-70">Nhập keys (mỗi key một dòng) cho biến thể đã chọn:</p>
          <textarea
            value={keyText}
            onChange={(e) => setKeyText(e.target.value)}
            rows={6}
            className="clay-input w-full text-xs font-mono"
            placeholder={"key1\nkey2"}
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => { setAddVar(null); setKeyText('') }} className="clay-btn text-xs">Huỷ</button>
            <button
              onClick={() => addMut.mutate()}
              disabled={addMut.isPending || !keyText.trim()}
              className="clay-btn clay-btn--lemon text-xs"
            >{addMut.isPending ? 'Đang thêm…' : 'Thêm'}</button>
          </div>
        </div>
      )}
    </div>
  )
}
```

Add to imports at top:
```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
```

(If `useQueryClient` not yet imported.)

- [ ] Step 3: Verify + commit:
```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/stock/page.tsx web/src/app/\(admin\)/admin/stock/QuickAddKeysModal.tsx
git commit -m "feat(admin-stock): per-product variant breakdown panel + per-variant key add"
```

## Task 5: VariantsManager image picker

**Files:**
- Modify: `web/src/app/(admin)/admin/products/VariantsManager.tsx`

- [ ] Step 1: Open the file. Find the `VariantEditModal` form state. Add `imageUrl` field:

```tsx
const [form, setForm] = useState({
  name: variant?.name ?? '',
  description: variant?.description ?? '',
  price: variant?.price ?? 0,
  sortOrder: variant?.sortOrder ?? 0,
  requiresInput: variant?.requiresInput ?? false,
  inputLabel: variant?.inputLabel ?? '',
  inputPlaceholder: variant?.inputPlaceholder ?? '',
  inputType: variant?.inputType ?? 'text',
  imageUrl: (variant as { imageUrl?: string | null })?.imageUrl ?? '',
  isActive: variant?.isActive ?? true,
})
```

Update the `Variant` interface in the same file to include `imageUrl: string | null`.

In the mutation payload, include `imageUrl: form.imageUrl || null`.

Add image picker UI above the requires-input checkbox:

```tsx
import { useState as useStateAlias } from 'react'  // already imported as useState
import { MediaLibrary } from '@/components/admin/MediaLibrary'

// ...inside VariantEditModal, alongside other state:
const [pickerOpen, setPickerOpen] = useState(false)

// in JSX, after the price/sortOrder grid:
<label className="block text-sm">
  <span className="text-xs opacity-70 mb-1 inline-block">Ảnh biến thể (tuỳ chọn — nếu trống dùng ảnh sản phẩm)</span>
  <div className="flex items-center gap-2">
    {form.imageUrl ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={form.imageUrl} alt="" className="w-16 h-16 rounded-lg object-cover border border-gray-200" />
    ) : (
      <div className="w-16 h-16 rounded-lg bg-gray-100 grid place-items-center text-xs opacity-60">—</div>
    )}
    <button type="button" onClick={() => setPickerOpen(true)} className="clay-btn text-xs">Chọn ảnh</button>
    {form.imageUrl && <button type="button" onClick={() => setForm({ ...form, imageUrl: '' })} className="text-xs text-red-600">Xoá</button>}
  </div>
</label>

{pickerOpen && (
  <MediaLibrary
    onPick={(url) => { setForm({ ...form, imageUrl: url }); setPickerOpen(false) }}
    onClose={() => setPickerOpen(false)}
  />
)}
```

- [ ] Step 2: Verify + commit:
```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/products/VariantsManager.tsx
git commit -m "feat(admin-variants): image picker per variant (MediaLibrary)"
```

## Task 6: Mini app swaps image on variant select

**Files:**
- Modify: `web/src/app/(miniapp)/components/VariantPicker.tsx`
- Modify: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`

- [ ] Step 1: Extend `Variant` interface in `VariantPicker.tsx` to include `imageUrl: string`. (Optional with `?:` since the property may not exist for older clients.)

```tsx
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
```

- [ ] Step 2: In `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`, compute the effective image:

Find the existing `<Image src={p.imageUrl}` (or similar) in the product hero block. Compute the URL before render:

```tsx
const effectiveImage = (selected?.imageUrl && selected.imageUrl.length > 0) ? selected.imageUrl : p.imageUrl
```

Use `effectiveImage` in the `<Image src={...}>`.

- [ ] Step 3: Verify + commit:
```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/san-pham/tai-khoan-grammarly-premium-gia-re
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/components/VariantPicker.tsx web/src/app/\(miniapp\)/san-pham/\[slug\]/page.tsx
git commit -m "feat(miniapp): swap hero image when variant has own image"
```

## Task 7: Sticky toolbar + backdrop-click in products modal

**Files:**
- Modify: `web/src/components/RichEditorRich.tsx`
- Modify: `web/src/app/(admin)/admin/products/page.tsx`

- [ ] Step 1: Edit `RichEditorRich.tsx`. The toolbar `<div>` currently has `border-b border-gray-200 px-2 py-1 bg-gray-50`. Add `sticky top-0 z-10`:

```tsx
<div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-1 bg-gray-50 sticky top-0 z-10">
```

(The editor's parent has `overflow-hidden` — for sticky to work, the scroll happens on a higher ancestor. The product modal is `overflow-y-auto`. Sticky on the toolbar relative to the modal scroll container works because position:sticky finds the nearest scrolling ancestor.)

- [ ] Step 2: Backdrop-click in products modal. Open `web/src/app/(admin)/admin/products/page.tsx`. Find the modal backdrop:

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
  <div className="bg-white rounded-lg shadow-xl w-full ...">
```

Add `onClick={closeModal}` on the backdrop and `onClick={(e) => e.stopPropagation()}` on the panel:

```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeModal}>
  <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-lg shadow-xl w-full ...">
```

(Use the existing `closeModal` callback. If the variable name is different — `setShowModal(false)` etc — wrap in an inline arrow.)

- [ ] Step 3: Verify + commit:
```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/components/RichEditorRich.tsx web/src/app/\(admin\)/admin/products/page.tsx
git commit -m "feat(admin): RichEditorRich sticky toolbar + product modal backdrop dismisses"
```

## Task 8: WP variations migration (pass-4)

**Files:**
- Create: `scripts/wp-migration/extract-variations.js`
- Create: `scripts/wp-migration/load-variations.js`
- Modify: `scripts/migrate-wp.js`

The WP dump has `wp_posts.post_type = 'product_variation'` rows whose `post_parent` is the parent product's `post_id`. Variation price is in `postmeta` `meta_key = '_price'`, stock in `_stock`, attribute (e.g. duration) in `attribute_pa_thoi-gian` etc. Variation name is built from the attribute values (no human-friendly post_title).

- [ ] Step 1: Create `scripts/wp-migration/extract-variations.js`:

```js
const { streamInserts } = require('./sql-stream');
const cfg = require('./config');

async function extractVariationsAndMeta() {
  const rows = [];
  const meta = [];
  for await (const insert of streamInserts(cfg.WP_SQL_DUMP)) {
    if (insert.table === `${cfg.WP_TABLE_PREFIX}posts`) {
      for (const row of insert.rows) {
        if (row.post_type === 'product_variation' && (row.post_status === 'publish' || row.post_status === 'private')) {
          rows.push({
            ID: Number(row.ID),
            post_parent: Number(row.post_parent),
            post_status: row.post_status,
            menu_order: Number(row.menu_order || 0),
          });
        }
      }
    } else if (insert.table === `${cfg.WP_TABLE_PREFIX}postmeta`) {
      for (const m of insert.rows) {
        const key = m.meta_key || '';
        if (key === '_price' || key === '_stock' || key === '_thumbnail_id' || key.startsWith('attribute_')) {
          meta.push({ post_id: Number(m.post_id), meta_key: key, meta_value: m.meta_value });
        }
      }
    }
  }
  return { variations: rows, meta };
}

module.exports = { extractVariationsAndMeta };
```

(Reads same SQL stream parser as the existing extractors. Verify `streamInserts` is the exported helper; if not, use the equivalent from `sql-stream.js`.)

- [ ] Step 2: Create `scripts/wp-migration/load-variations.js`:

```js
function pascalCaseFromSlug(slug) {
  // e.g. "3-thang" → "3 Tháng" — best-effort, not strict Vietnamese spelling
  return slug.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function buildVariationRows({ variations, meta, wpPostIdToProductId }) {
  const byPost = new Map(); // wpVariationId → { price, stock, thumbnailId, attrs }
  for (const m of meta) {
    if (!byPost.has(m.post_id)) byPost.set(m.post_id, { attrs: [] });
    const slot = byPost.get(m.post_id);
    if (m.meta_key === '_price') slot.price = Number(m.meta_value);
    else if (m.meta_key === '_stock') slot.stock = Number(m.meta_value);
    else if (m.meta_key === '_thumbnail_id') slot.thumbnailId = Number(m.meta_value);
    else if (m.meta_key.startsWith('attribute_')) slot.attrs.push({ k: m.meta_key.replace(/^attribute_/, ''), v: String(m.meta_value || '') });
  }

  const out = [];
  for (const v of variations) {
    const productId = wpPostIdToProductId.get(v.post_parent);
    if (!productId) continue; // parent product wasn't imported
    const slot = byPost.get(v.ID) || { attrs: [] };
    if (!slot.price || slot.price <= 0) continue; // skip variations without a price

    const name = slot.attrs.length > 0
      ? slot.attrs.map((a) => pascalCaseFromSlug(a.v)).filter(Boolean).join(' / ')
      : `Biến thể #${v.ID}`;

    out.push({
      wp_variation_id: v.ID,
      product_id: productId,
      name: name || `Biến thể ${v.ID}`,
      price: Math.round(slot.price),
      sort_order: v.menu_order,
      is_active: 1,
    });
  }
  return out;
}

function loadVariations(db, rows) {
  const insert = db.prepare(`
    INSERT INTO product_variants (product_id, name, price, sort_order, is_active)
    VALUES (?, ?, ?, ?, ?)
  `);
  let count = 0;
  const tx = db.transaction((rs) => {
    for (const r of rs) {
      insert.run(r.product_id, r.name, r.price, r.sort_order, r.is_active);
      count++;
    }
  });
  tx(rows);
  return count;
}

module.exports = { buildVariationRows, loadVariations };
```

- [ ] Step 3: Wire into `scripts/migrate-wp.js`. Add the branch in `main()`:

```js
  if (process.argv.includes('--variations')) {
    return runVariations();
  }
```

Add helper:

```js
async function runVariations() {
  const Database = require('better-sqlite3');
  const path = require('node:path');
  const dbPath = path.resolve(__dirname, '..', 'data', 'shop.db');
  console.log(`Importing WP product variations into ${dbPath} …`);

  const { extractVariationsAndMeta } = require('./wp-migration/extract-variations');
  const { buildVariationRows, loadVariations } = require('./wp-migration/load-variations');

  const db = new Database(dbPath);
  const { variations, meta } = await extractVariationsAndMeta();

  // Build wpPostId → local product_id map. The fork's products table doesn't
  // store wp_post_id, so we use the slug-based join we kept during pass-1:
  // products with slug derived from the WP post_name.
  // Cheapest: query products + match to the originally-imported variation set.
  const productRows = db.prepare(`SELECT id, slug FROM products`).all();
  const slugToId = new Map(productRows.map((p) => [p.slug, p.id]));

  // The variation extractor returns post_parent (wpPostId of the parent product).
  // We need wpPostId → productId. Use the existing migration report's mapping
  // if available, otherwise fall back to matching via posts SQL:
  const fs = require('node:fs');
  const reportPath = require('./wp-migration/config').REPORT_PATH;
  let wpPostIdToProductId = new Map();
  if (fs.existsSync(reportPath)) {
    try {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
      if (report.wpPostIdToProductId) {
        wpPostIdToProductId = new Map(Object.entries(report.wpPostIdToProductId).map(([k, v]) => [Number(k), Number(v)]));
      }
    } catch {}
  }

  // Fallback: walk WP posts again to build the map by joining post_name → slug
  if (wpPostIdToProductId.size === 0) {
    const { extractProductsAndMeta } = require('./wp-migration/extract-products');
    const { posts } = await extractProductsAndMeta();
    for (const p of posts) {
      if (p.post_type !== 'product') continue;
      const local = slugToId.get(p.post_name);
      if (local) wpPostIdToProductId.set(Number(p.ID), local);
    }
  }

  const rows = buildVariationRows({ variations, meta, wpPostIdToProductId });
  const inserted = loadVariations(db, rows);

  console.log('Done:', { variationsScanned: variations.length, variantsInserted: inserted });
}
```

- [ ] Step 4: Smoke run (DB backed up earlier):
```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
source ~/.nvm/nvm.sh && nvm use 20 && node scripts/migrate-wp.js --variations 2>&1 | tail -10
sqlite3 data/shop.db "SELECT COUNT(*) FROM product_variants"
sqlite3 data/shop.db "SELECT product_id, name, price FROM product_variants WHERE name NOT LIKE 'TEST_%' AND name NOT LIKE 'VTEST_%' AND name NOT LIKE 'DBG_%' AND name NOT LIKE 'V_TEST_%' AND name NOT LIKE 'V_%' AND name NOT LIKE 'IMG_%' LIMIT 10"
```

Expected: variantsInserted > 0; query lists imported variations with VND prices + names like "3 Tháng" / "1 Năm".

- [ ] Step 5: Commit:
```bash
git add scripts/wp-migration/extract-variations.js scripts/wp-migration/load-variations.js scripts/migrate-wp.js
git commit -m "feat(wp-migration): pass-4 --variations imports legacy product variations"
```

## Task 9: Verify + tag

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/ 2>&1 | tail -5
cd web && npx tsc --noEmit 2>&1 | tail -3
cd web && npm run build 2>&1 | tail -5
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git tag v0.18-variants-stock-images -m "Variants stock + images + WP migration pass-4 + modal/editor polish"
git log --oneline main..HEAD
```

---

## Self-Review

- /stock per-variant key add → Task 4
- Variant images with fallback → Tasks 1, 2, 5, 6
- Dashboard popup outside-click dismiss → Task 7
- Sticky toolbar → Task 7
- WP variation migration → Task 8
- Order delivery uses correct variant keys → Task 3
- Reservation already branches by variant_id (sub-project H — preserved)

No placeholders. Types stay consistent across tasks (`Variant.imageUrl?: string` introduced Task 1, used Tasks 2, 6).
