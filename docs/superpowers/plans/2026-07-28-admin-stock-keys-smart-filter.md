# Admin Stock Keys Smart Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay select sản phẩm trên `/admin/stock/keys` bằng combobox tìm và chọn trực tiếp sản phẩm hoặc biến thể.

**Architecture:** Mở rộng response `/admin/products` với ID/tên biến thể active, sau đó xây utility client thuần để chuẩn hóa và xếp hạng kết quả. Component combobox chỉ phụ trách tương tác/ARIA; page giữ state `productId` và `variantId` hiện tại nên contract `/admin/stock` không đổi.

**Tech Stack:** Node.js 22, Express, SQLite JSON1, Next.js 16 Client Components, React 19, TypeScript, TanStack Query, Node test runner.

## Global Constraints

- Không thêm dependency UI.
- Không đổi endpoint hoặc query params của `/admin/stock`.
- `variantNames` hiện tại phải tiếp tục tồn tại.
- Chỉ liệt kê sản phẩm chưa archive và biến thể active như behavior hiện tại.
- Tìm kiếm không phân biệt hoa thường, dấu tiếng Việt và phải hỗ trợ token/prefix.
- Không sửa modal thêm key, modal sửa key hoặc trang stock theo sản phẩm.
- Không stage DB, upload, backup hoặc thay đổi không thuộc task.

---

### Task 1: Expose Variant IDs In Admin Product List

**Files:**
- Modify: `src/api/routes/admin/products.js`
- Modify: `tests/api/admin-products-variant-names.test.js`

**Interfaces:**
- Produces: `shapeProduct(row).variantOptions: Array<{ id: string; name: string }>`
- Preserves: `shapeProduct(row).variantNames: string[]`

- [ ] **Step 1: Extend the API test first**

Add an active and an inactive variant, then assert:

```js
assert.deepStrictEqual(row.variantOptions, [
  { id: String(basicId), name: 'Basic' },
  { id: String(proPlusId), name: 'Pro, Plus' },
]);
```

- [ ] **Step 2: Run the focused API test and verify RED**

Run:

```bash
node --test tests/api/admin-products-variant-names.test.js
```

Expected: assertion fails because `variantOptions` is `undefined`.

- [ ] **Step 3: Add ordered JSON aggregation and safe response parsing**

Extend the active variant subquery with `id`, aggregate:

```sql
JSON_GROUP_ARRAY(
  JSON_OBJECT('id', active_variants.id, 'name', active_variants.name)
) AS variant_options
```

Expose it from the outer select and parse with a helper that returns `[]` for malformed/missing JSON, converts every `id` to string, and ignores invalid rows.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/api/admin-products-variant-names.test.js
```

Expected: all assertions pass, including exclusion of inactive variants.

---

### Task 2: Build Accent-Insensitive Product/Variant Ranking

**Files:**
- Create: `web/src/lib/adminStockProductFilter.ts`
- Create: `tests/web/adminStockProductFilter.test.mjs`

**Interfaces:**
- Produces:

```ts
export interface AdminStockFilterProduct {
  id: string
  name: string
  category?: string
  slug?: string
  variantNames?: string[]
  variantOptions?: Array<{ id: string; name: string }>
}

export interface AdminStockFilterOption {
  key: string
  kind: 'product' | 'variant'
  productId: string
  productName: string
  variantId: string
  variantName: string
  category: string
  slug: string
}

export function normalizeAdminStockFilterText(value: string): string
export function filterAdminStockProductOptions(
  products: AdminStockFilterProduct[],
  query: string,
  limit?: number,
): AdminStockFilterOption[]
```

- [ ] **Step 1: Write behavior tests**

Cover:

```js
test('tìm tên sản phẩm không dấu', ...)
test('tìm trực tiếp bằng một phần tên biến thể', ...)
test('ưu tiên khớp tên trước category và slug', ...)
test('query rỗng chỉ trả option sản phẩm', ...)
test('mọi token phải xuất hiện trong option', ...)
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tests/web/adminStockProductFilter.test.mjs
```

Expected: missing module/export, then assertion failures once the module shell exists.

- [ ] **Step 3: Implement minimal normalization and ranking**

Normalization:

```ts
value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()
```

Build product and variant options, require every normalized query token in the combined haystack, compute deterministic scores, sort descending by score then original index, and return at most `limit`.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test tests/web/adminStockProductFilter.test.mjs
```

Expected: all tests pass.

---

### Task 3: Implement Accessible Product/Variant Combobox

**Files:**
- Create: `web/src/app/(admin)/admin/stock/keys/ProductVariantFilterCombobox.tsx`
- Modify: `web/src/lib/icons.tsx`
- Create: `tests/web/adminStockProductFilterCombobox.test.mjs`

**Interfaces:**
- Consumes: `AdminStockFilterProduct`, `filterAdminStockProductOptions`
- Produces:

```ts
interface ProductVariantFilterValue {
  productId: string
  variantId: string
}

interface ProductVariantFilterComboboxProps {
  products: AdminStockFilterProduct[]
  value: ProductVariantFilterValue
  loading?: boolean
  onChange: (value: ProductVariantFilterValue) => void
}
```

- [ ] **Step 1: Add source contract test**

Assert the component contains:

```js
assert.match(source, /role="combobox"/);
assert.match(source, /aria-autocomplete="list"/);
assert.match(source, /role="listbox"/);
assert.match(source, /ArrowDown/);
assert.match(source, /ArrowUp/);
assert.match(source, /Escape/);
assert.match(source, /filterAdminStockProductOptions/);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test tests/web/adminStockProductFilterCombobox.test.mjs
```

Expected: component file or required combobox contract is missing.

- [ ] **Step 3: Implement the client component**

Implement:

- Local input/open/active-index state.
- Current label derived from `productId` and `variantId`.
- Click-outside close using a root ref.
- `ArrowDown`, `ArrowUp`, `Enter`, `Escape`.
- Product option sets `{ productId, variantId: '' }`.
- Variant option sets both IDs.
- `Tất cả sản phẩm` sets both IDs to empty.
- Loading and empty results.
- Search, clear, chevron icons with tooltips/ARIA labels.
- Listbox options with stable IDs and selected/active styles.

- [ ] **Step 4: Run source test and TypeScript lint**

Run:

```bash
node --test tests/web/adminStockProductFilterCombobox.test.mjs
cd web && npm run lint -- 'src/app/(admin)/admin/stock/keys/ProductVariantFilterCombobox.tsx' 'src/lib/adminStockProductFilter.ts'
```

Expected: test and focused lint pass.

---

### Task 4: Replace The Stock Keys Product Select

**Files:**
- Modify: `web/src/app/(admin)/admin/stock/keys/page.tsx`
- Modify: `tests/web/adminStockProductFilterCombobox.test.mjs`

**Interfaces:**
- Consumes: `ProductVariantFilterCombobox`
- Preserves: `productId`, `variantId`, page reset, selected key reset, existing variants query and second variant select.

- [ ] **Step 1: Extend page integration test**

Assert:

```js
assert.match(page, /<ProductVariantFilterCombobox/);
assert.match(page, /setProductId\(next\.productId\)/);
assert.match(page, /setVariantId\(next\.variantId\)/);
assert.doesNotMatch(page, /<option value="">Tất cả sản phẩm<\/option>/);
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
node --test tests/web/adminStockProductFilterCombobox.test.mjs
```

Expected: page still contains the native product select.

- [ ] **Step 3: Wire the combobox**

- Extend `ProductRow` with `variantOptions`.
- Import the component.
- Replace only the first product `<select>`.
- In `onChange`, set both IDs, page 1, and clear selected IDs.
- Keep the second variant select and variants query unchanged.
- Change the grid product track from `240px` to a responsive `minmax(280px,340px)`.

- [ ] **Step 4: Run focused tests**

Run:

```bash
node --test \
  tests/api/admin-products-variant-names.test.js \
  tests/web/adminStockProductFilter.test.mjs \
  tests/web/adminStockProductFilterCombobox.test.mjs \
  tests/web/admin-stock-keys-filter-columns.test.mjs
```

Expected: all tests pass.

---

### Task 5: Full Verification And Commit

**Files:**
- Verify all files from Tasks 1-4.

**Interfaces:**
- Confirms the production bundle and runtime UI.

- [ ] **Step 1: Run backend syntax/test verification**

```bash
node --check src/api/routes/admin/products.js
node --test tests/api/admin-products-variant-names.test.js
```

- [ ] **Step 2: Run web lint and build**

```bash
cd web && npm run lint
cd web && npm run build
```

- [ ] **Step 3: Browser smoke**

Start a local web server on an unused port, authenticate with a local admin token, then verify desktop and mobile:

- Input opens and does not overflow.
- Query `notion bus` finds the matching variant/product when data exists.
- Query without Vietnamese accents matches names with accents.
- Selecting a variant updates both combobox label and variant select.
- Clearing returns the stock request to all products.
- Keyboard navigation and `Escape` work.

- [ ] **Step 4: Inspect the scoped diff**

```bash
git diff --check
git diff -- \
  src/api/routes/admin/products.js \
  tests/api/admin-products-variant-names.test.js \
  web/src/lib/adminStockProductFilter.ts \
  tests/web/adminStockProductFilter.test.mjs \
  web/src/app/'(admin)'/admin/stock/keys/ProductVariantFilterCombobox.tsx \
  tests/web/adminStockProductFilterCombobox.test.mjs \
  web/src/app/'(admin)'/admin/stock/keys/page.tsx \
  web/src/lib/icons.tsx
```

- [ ] **Step 5: Commit only scoped files**

```bash
git add \
  src/api/routes/admin/products.js \
  tests/api/admin-products-variant-names.test.js \
  web/src/lib/adminStockProductFilter.ts \
  tests/web/adminStockProductFilter.test.mjs \
  web/src/app/'(admin)'/admin/stock/keys/ProductVariantFilterCombobox.tsx \
  tests/web/adminStockProductFilterCombobox.test.mjs \
  web/src/app/'(admin)'/admin/stock/keys/page.tsx \
  web/src/lib/icons.tsx
git commit -m "feat: add smart stock product filter"
```
