# Variant: Hard Delete + Multi-Input + Drag Reorder + Long Description Limit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch variant delete to permanent removal (active/inactive remains via `isActive` toggle only). Allow >1 input field per variant. Bump `longDescription` zod max from 5000 to 20000 chars. Add drag-and-drop reorder on the variant list using `@dnd-kit`.

**Architecture:** Hard delete is a backend SQL change + a UI cleanup (remove "Hiện đã xoá" toggle, remove inactive-row rendering branch). Multi-input adds `input_fields_json` TEXT column on `product_variants` storing an array `[{label, placeholder, type, required}]`; admin form gets dynamic field rows; public API + VariantPicker handle arrays; cart serializes user values as a JSON object for the encrypted `input_value`. Drag-reorder uses `@dnd-kit/core` + `@dnd-kit/sortable` (single new dep) and hits the existing `PATCH /admin/products/:id/variants/reorder` endpoint.

**Tech Stack:** Node 20, better-sqlite3, Express, zod, Next 16, React 19, @tanstack/react-query, **new dep:** `@dnd-kit/core` `@dnd-kit/sortable` `@dnd-kit/utilities`.

---

### Task 1: Bump longDescription + usageInstructions zod max

**Files:**
- Modify: `src/api/routes/admin/products.js:107-108,156-157`

- [ ] **Step 1: Edit POST schema**

Open `src/api/routes/admin/products.js` line 107-108:
```js
  longDescription: z.string().max(5000).nullable().optional(),
  usageInstructions: z.string().max(5000).nullable().optional(),
```

Replace with:
```js
  longDescription: z.string().max(20000).nullable().optional(),
  usageInstructions: z.string().max(20000).nullable().optional(),
```

- [ ] **Step 2: Edit PUT schema**

Line 156-157 (the equivalent PUT validate block) — same change. Read the file around `router.put` to confirm the two lines exist, then replace both occurrences in that route's z.object.

- [ ] **Step 3: Restart api dev + verify**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
lsof -ti :3000 | xargs kill -9 2>/dev/null
sleep 2
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
nohup npm run dev > logs/api.log 2>&1 &
sleep 4
```

Manual: paste a >5000-char longDescription into the admin product modal → save → expect success (not "Too big").

- [ ] **Step 4: Commit**

```bash
git add src/api/routes/admin/products.js
git commit -m "fix(admin/products): bump longDescription + usageInstructions max 5000→20000"
```

---

### Task 2: Variant hard delete

**Files:**
- Modify: `src/services/variantService.js`
- Modify: `src/api/routes/admin/variants.js:74-82`
- Modify: `web/src/app/(admin)/admin/products/VariantsManager.tsx`

- [ ] **Step 1: Add hardDelete in service**

In `src/services/variantService.js` after `softDelete` (around line 60-66), insert `hardDelete` and keep `softDelete` (legacy callers may exist):

```js
  hardDelete(db, productId, variantId) {
    const r = db.prepare(
      `DELETE FROM product_variants WHERE product_id = ? AND id = ?`
    ).run(productId, variantId);
    return { changes: r.changes };
  },
```

(Stock rows reference `variant_id` with `ON DELETE` likely `NULL` or no cascade — verify in migration 016: `stock.variant_id INTEGER NULL`. If the column has no FK cascade and we still want to clean up orphan stock, leave them — those stock rows are simply detached from any variant and stay in the product pool. Acceptable.)

- [ ] **Step 2: Switch route to hardDelete**

Open `src/api/routes/admin/variants.js` around lines 74-82. Replace the existing DELETE block with:

```js
router.delete('/:id', (req, res) => {
  const productId = parseInt(req.params.productId);
  const variantId = parseInt(req.params.id);
  const existing = db.prepare('SELECT id FROM product_variants WHERE id = ? AND product_id = ?').get(variantId, productId);
  if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  variantService.hardDelete(db, productId, variantId);
  auditService.log(req.admin?.adminId, 'variant.delete', 'variant', variantId, { productId, hard: true }, req.ip);
  res.json({ success: true });
});
```

- [ ] **Step 3: Remove "Hiện đã xoá" toggle from VariantsManager**

In `web/src/app/(admin)/admin/products/VariantsManager.tsx`:

Remove the `showInactive` state, the checkbox JSX, the `?includeInactive=...` URL suffix in the queryFn, and the inactive-row visual branch (red bg + strikethrough + "Đã xoá" badge). The variant list should now contain only active rows. The "Hoạt động" checkbox inside the edit modal stays — it toggles `isActive` to hide/show on the storefront.

Concretely, replace the `useQuery` definition near the top of `VariantsManager`:

```tsx
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'variants', productId],
    queryFn: () => api.get<Variant[]>(`/admin/products/${productId}/variants?includeInactive=1`),
    enabled: !!productId,
  })
```

with:
```tsx
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'variants', productId],
    queryFn: () => api.get<Variant[]>(`/admin/products/${productId}/variants?includeInactive=1`),
    enabled: !!productId,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
```

(Keep `includeInactive=1` so admins can still see hidden-but-not-deleted variants — they appear with a faded "Tạm ẩn" badge instead of "Đã xoá".)

Now remove the toggle. Locate the toolbar row containing `Hiện đã xoá` checkbox and its `+ Thêm biến thể` button:

```tsx
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wider opacity-60">Biến thể ({variants.length})</span>
        <div className="flex items-center gap-2">
          <label className="text-xs opacity-70 inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            /> Hiện đã xoá
          </label>
          <button
            type="button"
            onClick={() => setEditing('new')}
            className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
          >+ Thêm biến thể</button>
        </div>
      </div>
```

Replace with:

```tsx
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wider opacity-60">Biến thể ({variants.length})</span>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
        >+ Thêm biến thể</button>
      </div>
```

Drop the `const [showInactive, setShowInactive] = useState(false)` line.

Update each row to show "Tạm ẩn" badge when `!v.isActive` (was "Đã xoá"). Replace the row's inactive branch:

```tsx
                {!v.isActive && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide bg-red-600 text-white px-1.5 py-0.5 rounded">
                    Đã xoá
                  </span>
                )}
```

With:
```tsx
                {!v.isActive && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide bg-gray-500 text-white px-1.5 py-0.5 rounded">
                    Tạm ẩn
                  </span>
                )}
```

Also drop the conditional that hides Xoá on inactive rows — now Xoá hard-deletes regardless of active state:

```tsx
            {v.isActive && (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Xoá biến thể "${v.name}"?`)) deleteMut.mutate(v.id)
                }}
                className="text-xs text-red-600 px-2"
              >Xoá</button>
            )}
```

Replace with:
```tsx
            <button
              type="button"
              onClick={() => {
                if (confirm(`Xoá vĩnh viễn biến thể "${v.name}"? Không thể hoàn tác.`)) deleteMut.mutate(v.id)
              }}
              className="text-xs text-red-600 px-2"
            >Xoá</button>
```

Update the deleteMut toast text:

```tsx
    onSuccess: () => {
      t.success('Đã xoá biến thể vĩnh viễn')
    },
```

- [ ] **Step 4: Type-check + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```

Open a product, click Xoá on a variant → confirm dialog. Confirm → toast "Đã xoá biến thể vĩnh viễn" + row vanishes; backend SQL `SELECT * FROM product_variants WHERE id=?` returns nothing. Toggle "Hoạt động" off via Sửa → save → badge "Tạm ẩn" appears.

- [ ] **Step 5: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add src/services/variantService.js src/api/routes/admin/variants.js web/src/app/\(admin\)/admin/products/VariantsManager.tsx
git commit -m "feat(admin): variant DELETE is now permanent; isActive used purely for hide/show"
```

---

### Task 3: Multi-input field support per variant

#### Task 3.1: Migration + backend model

**Files:**
- Create: `src/database/migrations/020_variant_input_fields.js`
- Modify: `src/services/variantService.js`
- Modify: `src/api/routes/admin/variants.js`
- Modify: `src/api/routes/public.js`

- [ ] **Step 1: Add migration 020**

Create `src/database/migrations/020_variant_input_fields.js`:

```js
function hasColumn(db, table, col) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some(r => r.name === col);
}

function up(db) {
  if (!hasColumn(db, 'product_variants', 'input_fields_json')) {
    db.exec(`ALTER TABLE product_variants ADD COLUMN input_fields_json TEXT`);
  }
  // Backfill: for variants where requires_input=1 and the legacy single-field is set,
  // populate input_fields_json with a one-entry array so consumers can read uniformly.
  const rows = db.prepare(`
    SELECT id, requires_input, input_label, input_placeholder, input_type
      FROM product_variants
     WHERE requires_input = 1 AND (input_fields_json IS NULL OR input_fields_json = '')
  `).all();
  const upd = db.prepare(`UPDATE product_variants SET input_fields_json = ? WHERE id = ?`);
  for (const r of rows) {
    const field = {
      label: r.input_label || 'Thông tin',
      placeholder: r.input_placeholder || '',
      type: r.input_type || 'text',
      required: true,
    };
    upd.run(JSON.stringify([field]), r.id);
  }
}

module.exports = { up };
```

- [ ] **Step 2: Run migrations**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
node -e "require('./src/database')"
```

(`require('./src/database')` triggers the migration runner on first DB open.)

Verify:
```bash
sqlite3 data/shop.db "PRAGMA table_info(product_variants);" | grep input_fields_json
```
Expected: `input_fields_json|TEXT|0||0`

- [ ] **Step 3: Update variantService to read/write JSON**

Edit `src/services/variantService.js`. Replace the `listByProduct`, `getById`, `create`, `update` blocks so they include `input_fields_json`:

In `listByProduct` line 4-10:
```js
    return db.prepare(
      `SELECT id, product_id, name, description, price, sort_order, is_active,
              requires_input, input_label, input_placeholder, input_type, input_fields_json, image_url, created_at, updated_at
         FROM product_variants
        WHERE product_id = ?${where}
        ORDER BY sort_order ASC, id ASC`
    ).all(productId);
```

In `getById`:
```js
    return db.prepare(
      `SELECT id, product_id, name, description, price, sort_order, is_active,
              requires_input, input_label, input_placeholder, input_type, input_fields_json, image_url
         FROM product_variants
        WHERE id = ?`
    ).get(variantId) || null;
```

In `create` add `inputFields` to destructure + columns:
```js
  create(db, { productId, name, description = null, price, sortOrder = 0,
               requiresInput = false, inputLabel = null, inputPlaceholder = null,
               inputType = 'text', inputFields = null, imageUrl = null }) {
    const r = db.prepare(
      `INSERT INTO product_variants
         (product_id, name, description, price, sort_order, requires_input, input_label, input_placeholder, input_type, input_fields_json, image_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(productId, name, description, price, sortOrder,
          requiresInput ? 1 : 0, inputLabel, inputPlaceholder, inputType,
          inputFields ? JSON.stringify(inputFields) : null,
          imageUrl);
    return { id: r.lastInsertRowid };
  },
```

In `update`, extend the `map`:
```js
    const map = {
      name: 'name', description: 'description', price: 'price',
      sortOrder: 'sort_order', isActive: 'is_active',
      requiresInput: 'requires_input', inputLabel: 'input_label',
      inputPlaceholder: 'input_placeholder',
      inputType: 'input_type',
      inputFields: 'input_fields_json',
      imageUrl: 'image_url',
    };
```

And in the same function, after the `for (const [jsKey, sqlKey] of …)` loop, handle the `inputFields` → JSON conversion:
```js
    // Patch: serialize inputFields array to JSON before SQL set
    const inputFieldsIdx = sets.findIndex(s => s.startsWith('input_fields_json ='));
    if (inputFieldsIdx >= 0) {
      const fieldsVal = params[inputFieldsIdx];
      params[inputFieldsIdx] = fieldsVal ? JSON.stringify(fieldsVal) : null;
    }
```

(Place that block between `if (sets.length === 0) return …` and `sets.push('updated_at = …')`.)

- [ ] **Step 4: Update admin shapeVariant + zod**

Open `src/api/routes/admin/variants.js`. Extend zod `variantBody` (around lines 11-21):

```js
const variantBody = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(20000).nullable().optional(),
  price: z.number().int().nonnegative(),
  sortOrder: z.number().int().optional(),
  requiresInput: z.boolean().optional(),
  inputLabel: z.string().max(80).nullable().optional(),
  inputPlaceholder: z.string().max(200).nullable().optional(),
  inputType: z.enum(['text', 'email', 'password', 'tel', 'url', 'number', 'textarea']).optional(),
  inputFields: z.array(z.object({
    label: z.string().min(1).max(80),
    placeholder: z.string().max(200).nullable().optional(),
    type: z.enum(['text', 'email', 'password', 'tel', 'url', 'number', 'textarea']),
    required: z.boolean(),
  })).max(10).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
});
```

Extend `shapeVariant` (lines 31-47):
```js
function shapeVariant(v) {
  let inputFields = null;
  if (v.input_fields_json) {
    try { inputFields = JSON.parse(v.input_fields_json); } catch { inputFields = null; }
  }
  return {
    id: String(v.id),
    productId: String(v.product_id),
    name: v.name,
    description: v.description || '',
    price: v.price,
    sortOrder: v.sort_order,
    isActive: !!v.is_active,
    requiresInput: !!v.requires_input,
    inputLabel: v.input_label || null,
    inputPlaceholder: v.input_placeholder || null,
    inputType: v.input_type || 'text',
    inputFields,
    imageUrl: v.image_url || null,
    stock: variantService.countAvailableStock(db, v.product_id, v.id),
  };
}
```

- [ ] **Step 5: Update public route shape**

Open `src/api/routes/public.js`. In `/products/:slug` the variants mapping needs to include `inputFields`. Locate the variants `.map(v => ({ … }))` block near line 226-238 and append `inputFields` parsed from `v.input_fields_json`:

```js
  const variants = variantRows.map(v => {
    let inputFields = null;
    if (v.input_fields_json) {
      try { inputFields = JSON.parse(v.input_fields_json); } catch { inputFields = null; }
    }
    return {
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
      inputFields,
      imageUrl: v.image_url || p.image_url || '',
    };
  });
```

(The variant list service already SELECTs `input_fields_json` from Step 3.)

- [ ] **Step 6: Restart api + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
lsof -ti :3000 | xargs kill -9 2>/dev/null
sleep 2
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
nohup npm run dev > logs/api.log 2>&1 &
sleep 4
curl -s 'http://localhost:3000/api/v1/products/<slug-with-input-variant>' | head -c 800
```

Expect each variant object to include `"inputFields": [...]` (or `null`).

- [ ] **Step 7: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add src/database/migrations/020_variant_input_fields.js src/services/variantService.js src/api/routes/admin/variants.js src/api/routes/public.js
git commit -m "feat(variants): input_fields_json column + admin zod + public mapper for multi-input"
```

#### Task 3.2: Admin form — dynamic input rows

**Files:**
- Modify: `web/src/app/(admin)/admin/products/VariantsManager.tsx`

- [ ] **Step 1: Extend Variant interface + form state**

Near the top of `VariantsManager.tsx`, extend the `Variant` interface (around lines 8-21):

```tsx
interface InputField {
  label: string
  placeholder?: string | null
  type: 'text' | 'email' | 'password' | 'tel' | 'url' | 'number' | 'textarea'
  required: boolean
}

interface Variant {
  id: string
  name: string
  description: string
  price: number
  sortOrder: number
  isActive: boolean
  requiresInput: boolean
  inputLabel: string | null
  inputPlaceholder: string | null
  inputType: string
  inputFields: InputField[] | null
  stock: number
  imageUrl: string | null
}
```

In `VariantEditModal` form state (around line 131-142), add `inputFields`:

```tsx
  const initialFields: InputField[] = variant?.inputFields && variant.inputFields.length > 0
    ? variant.inputFields
    : variant?.requiresInput
      ? [{ label: variant.inputLabel || 'Thông tin', placeholder: variant.inputPlaceholder || '', type: (variant.inputType as InputField['type']) || 'text', required: true }]
      : []

  const [form, setForm] = useState({
    name: variant?.name ?? '',
    description: variant?.description ?? '',
    price: variant?.price ?? 0,
    sortOrder: variant?.sortOrder ?? 0,
    requiresInput: variant?.requiresInput ?? false,
    inputLabel: variant?.inputLabel ?? '',
    inputPlaceholder: variant?.inputPlaceholder ?? '',
    inputType: variant?.inputType ?? 'text',
    isActive: variant?.isActive ?? true,
    imageUrl: variant?.imageUrl ?? '',
  })
  const [inputFields, setInputFields] = useState<InputField[]>(initialFields)
```

- [ ] **Step 2: Render multi-field editor**

Replace the existing single-field block (the `{form.requiresInput && (<div className="pl-5 …">…</div>)}` block) with a dynamic list:

```tsx
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.requiresInput} onChange={(e) => setForm({ ...form, requiresInput: e.target.checked })} />
          <span>Yêu cầu khách nhập thông tin khi mua</span>
        </label>

        {form.requiresInput && (
          <div className="pl-5 space-y-3 border-l-2 border-yellow-200">
            {inputFields.length === 0 && (
              <p className="text-xs opacity-60">Chưa có trường nào — bấm + Thêm trường.</p>
            )}
            {inputFields.map((f, idx) => (
              <div key={idx} className="space-y-1 p-2 rounded border border-gray-200 bg-gray-50">
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-sm">
                    <span className="text-xs opacity-70 mb-1 inline-block">Label</span>
                    <input
                      value={f.label}
                      onChange={(e) => {
                        const next = [...inputFields]; next[idx] = { ...f, label: e.target.value }; setInputFields(next)
                      }}
                      placeholder="vd: Email tài khoản"
                      className="clay-input w-full text-sm"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="text-xs opacity-70 mb-1 inline-block">Loại</span>
                    <select
                      value={f.type}
                      onChange={(e) => {
                        const next = [...inputFields]; next[idx] = { ...f, type: e.target.value as InputField['type'] }; setInputFields(next)
                      }}
                      className="clay-input w-full text-sm"
                    >
                      {INPUT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </label>
                </div>
                <label className="block text-sm">
                  <span className="text-xs opacity-70 mb-1 inline-block">Placeholder</span>
                  <input
                    value={f.placeholder ?? ''}
                    onChange={(e) => {
                      const next = [...inputFields]; next[idx] = { ...f, placeholder: e.target.value }; setInputFields(next)
                    }}
                    placeholder="vd: you@example.com"
                    className="clay-input w-full text-sm"
                  />
                </label>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) => {
                        const next = [...inputFields]; next[idx] = { ...f, required: e.target.checked }; setInputFields(next)
                      }}
                    /> Bắt buộc
                  </label>
                  <button
                    type="button"
                    onClick={() => setInputFields(inputFields.filter((_, i) => i !== idx))}
                    className="text-xs text-red-600"
                  >Xoá trường</button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setInputFields([...inputFields, { label: '', placeholder: '', type: 'text', required: true }])}
              className="text-xs px-2 py-1 rounded bg-yellow-100 hover:bg-yellow-200"
            >+ Thêm trường</button>
          </div>
        )}
```

- [ ] **Step 3: Submit inputFields in mutation payload**

In `mutation.mutationFn` (around lines 147-165), extend the `payload` object:

```tsx
      const payload = {
        name: form.name,
        description: form.description || null,
        price: Number(form.price),
        sortOrder: Number(form.sortOrder),
        requiresInput: form.requiresInput,
        inputLabel: form.inputLabel || null,
        inputPlaceholder: form.inputPlaceholder || null,
        inputType: form.inputType,
        inputFields: form.requiresInput && inputFields.length > 0
          ? inputFields.filter((f) => f.label.trim().length > 0)
          : null,
        imageUrl: form.imageUrl || null,
        ...(variant ? { isActive: form.isActive } : {}),
      }
```

(Filters out blank-label rows; sends `null` when no fields → backend stores NULL.)

- [ ] **Step 4: Type-check + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```

Open admin variant edit modal → tick "Yêu cầu khách nhập…" → "+ Thêm trường" 2-3 times → fill labels → save → toast success. Re-open the variant → confirm all fields persisted.

- [ ] **Step 5: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/products/VariantsManager.tsx
git commit -m "feat(admin/variants): dynamic multi-input field editor"
```

#### Task 3.3: Mini app — render N inputs + serialize values

**Files:**
- Modify: `web/src/app/(miniapp)/components/VariantPicker.tsx`
- Modify: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`
- Modify: `web/src/lib/cart.ts`

- [ ] **Step 1: Extend Variant interface in VariantPicker**

In `web/src/app/(miniapp)/components/VariantPicker.tsx`:

```tsx
export interface VariantInputField {
  label: string
  placeholder?: string | null
  type: 'text' | 'email' | 'password' | 'tel' | 'url' | 'number' | 'textarea'
  required: boolean
}

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
  inputFields?: VariantInputField[] | null
  imageUrl?: string
}
```

Change Props to take a record of values instead of single string:

```tsx
interface Props {
  variants: Variant[]
  selectedId: string | null
  onSelect: (id: string) => void
  inputValues: Record<string, string>
  onInputChange: (values: Record<string, string>) => void
}
```

- [ ] **Step 2: Render N inputs**

Replace the existing single-input render branch (`{selected?.requiresInput && (…)}`) with:

```tsx
      {selected?.requiresInput && (
        <div className="space-y-2">
          {(() => {
            // Resolve list: prefer inputFields, fall back to legacy single field
            const fields: VariantInputField[] =
              selected.inputFields && selected.inputFields.length > 0
                ? selected.inputFields
                : [{
                    label: selected.inputLabel || 'Thông tin',
                    placeholder: selected.inputPlaceholder || '',
                    type: (selected.inputType as VariantInputField['type']) || 'text',
                    required: true,
                  }]

            return fields.map((f, idx) => (
              <div key={`${f.label}-${idx}`}>
                <label className="block text-xs opacity-70 mb-1">
                  {f.label}{f.required && <span className="text-red-500"> *</span>}
                </label>
                {f.type === 'textarea' ? (
                  <textarea
                    value={inputValues[f.label] ?? ''}
                    onChange={(e) => onInputChange({ ...inputValues, [f.label]: e.target.value })}
                    placeholder={f.placeholder ?? ''}
                    rows={3}
                    className="w-full rounded-xl px-3 py-2 text-sm"
                    style={{
                      background: 'var(--tg-bg-2, #fff)',
                      border: '1px solid color-mix(in srgb, var(--brand-ink) 14%, transparent)',
                    }}
                    minLength={f.required ? 1 : 0}
                    maxLength={500}
                    required={f.required}
                  />
                ) : (
                  <input
                    type={f.type}
                    value={inputValues[f.label] ?? ''}
                    onChange={(e) => onInputChange({ ...inputValues, [f.label]: e.target.value })}
                    placeholder={f.placeholder ?? ''}
                    className="w-full rounded-xl px-3 py-2 text-sm"
                    style={{
                      background: 'var(--tg-bg-2, #fff)',
                      border: '1px solid color-mix(in srgb, var(--brand-ink) 14%, transparent)',
                    }}
                    minLength={f.required ? 1 : 0}
                    maxLength={200}
                    required={f.required}
                  />
                )}
              </div>
            ))
          })()}
        </div>
      )}
```

- [ ] **Step 3: Switch caller to inputValues map**

In `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`:

Replace:
```tsx
  const [inputValue, setInputValue] = useState('')
```
with:
```tsx
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
```

Change validation:
```tsx
  const requiresInput = !!selected?.requiresInput
  const inputValid = !requiresInput || inputValue.trim().length >= 3
```
to:
```tsx
  const requiresInput = !!selected?.requiresInput
  const fields = selected?.inputFields && selected.inputFields.length > 0
    ? selected.inputFields
    : (requiresInput
        ? [{ label: selected!.inputLabel || 'Thông tin', placeholder: '', type: 'text' as const, required: true }]
        : [])
  const inputValid = !requiresInput || fields.every((f) => !f.required || (inputValues[f.label] ?? '').trim().length >= 1)
```

Change `addToCart`:
```tsx
  const addToCart = () => {
    cart.add({
      productId: p.id,
      variantId: selected?.id ?? null,
      variantName: selected?.name ?? null,
      inputValue: requiresInput ? inputValue.trim() : null,
      slug: p.slug,
      name: p.name,
      price: effectivePrice,
      emoji: p.emoji,
      imageUrl: p.imageUrl,
      quantity: qty,
    })
  }
```
to:
```tsx
  const addToCart = () => {
    const trimmed: Record<string, string> = {}
    if (requiresInput) {
      for (const f of fields) {
        const v = (inputValues[f.label] ?? '').trim()
        if (v) trimmed[f.label] = v
      }
    }
    cart.add({
      productId: p.id,
      variantId: selected?.id ?? null,
      variantName: selected?.name ?? null,
      inputValue: requiresInput ? JSON.stringify(trimmed) : null,
      slug: p.slug,
      name: p.name,
      price: effectivePrice,
      emoji: p.emoji,
      imageUrl: p.imageUrl,
      quantity: qty,
    })
  }
```

Change VariantPicker prop wiring:
```tsx
              <VariantPicker
                variants={variants}
                selectedId={selectedVariantId}
                onSelect={(id) => { setSelectedVariantId(id); setInputValue('') }}
                inputValue={inputValue}
                onInputChange={setInputValue}
              />
```
to:
```tsx
              <VariantPicker
                variants={variants}
                selectedId={selectedVariantId}
                onSelect={(id) => { setSelectedVariantId(id); setInputValues({}) }}
                inputValues={inputValues}
                onInputChange={setInputValues}
              />
```

- [ ] **Step 4: Type-check + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```

Visit a product whose variant has multi-input fields (created via admin). Verify all fields render; required fields show `*`; addToCart disabled until each required field has 1+ char; submit → cart `inputValue` is JSON string like `{"Email":"foo@bar","Password":"xxx"}`. Order completes; order detail (`/don-hang/[id]`) shows the encrypted JSON intact in `input_value`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/components/VariantPicker.tsx web/src/app/\(miniapp\)/san-pham/\[slug\]/page.tsx
git commit -m "feat(miniapp): VariantPicker renders N input fields; cart stores JSON value map"
```

---

### Task 4: Drag-and-drop variant reorder

**Files:**
- Modify: `web/package.json` (add dnd-kit)
- Modify: `web/src/app/(admin)/admin/products/VariantsManager.tsx`

- [ ] **Step 1: Install dnd-kit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

Verify package.json now has those three deps. Lockfile updated.

- [ ] **Step 2: Wire DnD wrapper around the variant list**

In `VariantsManager.tsx`:

Add at top:
```tsx
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
```

Add a reorder mutation near `deleteMut`:
```tsx
  const reorderMut = useMutation({
    mutationFn: (items: { id: number; sortOrder: number }[]) =>
      api.patch(`/admin/products/${productId}/variants/reorder`, { items }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'variants', productId] })
      t.success('Đã sắp xếp lại biến thể')
    },
    onError: (e) => t.error(`Lỗi: ${e instanceof Error ? e.message : 'sắp xếp thất bại'}`),
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIdx = variants.findIndex((v) => v.id === active.id)
    const newIdx = variants.findIndex((v) => v.id === over.id)
    if (oldIdx < 0 || newIdx < 0) return
    const next = arrayMove(variants, oldIdx, newIdx)
    qc.setQueryData<{ data: Variant[] }>(['admin', 'variants', productId], (prev) => prev ? { ...prev, data: next } : prev)
    reorderMut.mutate(next.map((v, i) => ({ id: Number(v.id), sortOrder: i })))
  }
```

Extract the `<li>` row to a `SortableVariantRow` sub-component:

```tsx
function SortableVariantRow({ v, onEdit, onDelete }: {
  v: Variant
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
      className={`rounded-lg border p-2 text-sm flex items-center gap-2 ${v.isActive ? 'bg-white' : 'bg-gray-50'}`}
    >
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
        </p>
        <p className="text-xs opacity-60">{v.price.toLocaleString('vi-VN')}đ · kho {v.stock} {v.requiresInput && '· cần nhập'}</p>
      </div>
      <button type="button" onClick={onEdit} className="text-xs opacity-70 hover:opacity-100 px-2">Sửa</button>
      <button type="button" onClick={onDelete} className="text-xs text-red-600 px-2">Xoá</button>
    </li>
  )
}
```

Replace the existing `<ul className="space-y-1.5">{variants.map(...)}</ul>` block with:

```tsx
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={variants.map((v) => v.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1.5">
            {variants.map((v) => (
              <SortableVariantRow
                key={v.id}
                v={v}
                onEdit={() => setEditing(v)}
                onDelete={() => {
                  if (confirm(`Xoá vĩnh viễn biến thể "${v.name}"? Không thể hoàn tác.`)) deleteMut.mutate(v.id)
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
```

- [ ] **Step 3: Type-check + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit
```

In admin product modal: drag a variant row by the `⋮⋮` handle → drop in new position → list reorders instantly (optimistic) + toast "Đã sắp xếp lại biến thể". Reload page — order persists (server saved). Keyboard accessibility: focus handle, press Space/arrows to move.

- [ ] **Step 4: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/package.json web/package-lock.json web/src/app/\(admin\)/admin/products/VariantsManager.tsx
git commit -m "feat(admin/variants): drag-and-drop reorder via @dnd-kit (optimistic + invalidate)"
```

---

### Task 5: Final QA + tag

- [ ] **Step 1: Build**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/web"
source ~/.nvm/nvm.sh && nvm use 20 >/dev/null 2>&1
npx tsc --noEmit && npm run build
```
Expected: clean.

- [ ] **Step 2: Smoke matrix**

1. Long description: paste 10k chars in product edit → save → success.
2. Variant Xoá → row vanishes, DB row gone (hard delete).
3. Variant "Hoạt động" toggle off → row shows "Tạm ẩn" badge; storefront `/san-pham/<slug>` hides it.
4. Admin variant edit modal: tick "Yêu cầu khách nhập" → add 3 fields → save → reopen → fields persist.
5. Storefront variant with 3 fields → 3 inputs render → cart submits JSON map.
6. Admin variant list → drag rows → order changes + toast → reload → order persisted.

- [ ] **Step 3: Tag**

```bash
git tag -a v0.25-variants-overhaul -m "Variants: hard delete + multi-input + drag-reorder + 20k longDescription"
```

- [ ] **Step 4: CLAUDE.md log**

Append row:
```
| `v0.25-variants-overhaul` | hard-delete variant (isActive = hide/show only) + multi-input fields per variant + drag-reorder via @dnd-kit + longDescription max 20k |
```

Commit:
```bash
git add CLAUDE.md
git commit -m "docs: log v0.25-variants-overhaul"
```
