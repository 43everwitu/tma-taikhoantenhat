# Admin Stock, Key, and Editor UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/admin/stock/keys` the primary key-management page, improve quick key insertion from both stock pages, and add basic table/sticky-toolbar support to the product rich editor.

**Architecture:** Keep the existing routes and API shape, adding only the minimum shared component behavior needed. `QuickAddKeysModal` becomes the shared add-key entry point, `/admin/products` exposes `variantNames` for searchable product selection, and `RichEditorRich` gains TipTap table extensions and modal-scoped sticky toolbar styling.

**Tech Stack:** Next.js 16, React 19, TanStack Query, TipTap 3, Express, SQLite/better-sqlite3, Node test runner.

---

## File Structure

- Modify `src/api/routes/admin/products.js`: include active variant names in the product list response.
- Modify `web/src/app/(admin)/admin/stock/QuickAddKeysModal.tsx`: add `initialProductId`, searchable product combobox, search helper export, and invalidation for all stock queries.
- Modify `web/src/app/(admin)/admin/stock/page.tsx`: add row/card add-key actions and pass initial product id to the modal.
- Modify `web/src/app/(admin)/admin/stock/keys/page.tsx`: make the page primary by adding the shared add-key modal, improving navigation, and copy-on-click key values.
- Modify `web/src/components/RichEditorRich.tsx`: add table extensions, table toolbar buttons, and sticky toolbar class.
- Modify `web/src/app/(admin)/admin/products/page.tsx`: mark the edit modal scroll container for sticky editor toolbar.
- Modify `web/package.json`: add TipTap table extension dependencies.
- Create `web/src/app/(admin)/admin/stock/QuickAddKeysModal.test.ts`: tests product matching helper.
- Create `tests/api/admin-products-variant-names.test.js`: tests `variantNames` from `/admin/products`.

---

### Task 1: Product Variant Names API

**Files:**
- Modify: `src/api/routes/admin/products.js`
- Create: `tests/api/admin-products-variant-names.test.js`

- [ ] **Step 1: Write failing API test**

Create `tests/api/admin-products-variant-names.test.js` with a test that inserts one product and two active variants, calls the GET handler for `/admin/products`, and asserts the returned product includes `variantNames`.

- [ ] **Step 2: Run failing test**

Run: `node --test tests/api/admin-products-variant-names.test.js`

Expected before implementation: assertion fails because `variantNames` is missing or empty.

- [ ] **Step 3: Implement query and shape change**

In `PRODUCT_JOINS_SQL`, add a second aggregate field for active variant names using `GROUP_CONCAT`. In `shapeProduct`, parse the comma-separated string into an array:

```js
variantNames: r.variant_names ? String(r.variant_names).split('|||').filter(Boolean) : [],
```

Use separator `|||` to avoid common comma collisions in names.

- [ ] **Step 4: Verify**

Run: `node --test tests/api/admin-products-variant-names.test.js tests/api/admin-products-variant-summary.test.js`

Expected: all tests pass.

---

### Task 2: Shared Searchable Quick Add Modal

**Files:**
- Modify: `web/src/app/(admin)/admin/stock/QuickAddKeysModal.tsx`
- Create: `web/src/app/(admin)/admin/stock/QuickAddKeysModal.test.ts`

- [ ] **Step 1: Write helper test**

Create a test for exported `productMatchesKeySearch(product, query)` that confirms matching by product name, category, id, slug, and variant name.

- [ ] **Step 2: Run failing helper test**

Run from `web`: `npm run lint -- --file src/app/(admin)/admin/stock/QuickAddKeysModal.test.ts`

If the project does not run TS tests directly, use the file as typechecked source and rely on `npm run build` in final verification.

- [ ] **Step 3: Implement modal props and search helper**

Update modal product type:

```ts
interface Product {
  id: string
  name: string
  category?: string
  slug?: string
  variantNames?: string[]
}
```

Add `initialProductId?: string | null` prop. Initialize and update `productId` from it when modal opens. Replace the native product select with a search input and filtered list. Use `productMatchesKeySearch` for filtering.

- [ ] **Step 4: Preserve submit behavior**

Keep existing variant loading, variant requirement, duration, notify followers, multiline key textarea, and submit endpoint `/admin/stock/${productId}`.

- [ ] **Step 5: Verify build typing later**

Run final web build after Tasks 3-5.

---

### Task 3: Stock Overview Entry Points

**Files:**
- Modify: `web/src/app/(admin)/admin/stock/page.tsx`

- [ ] **Step 1: Add selected quick-add product state**

Replace boolean modal state with `quickAddProductId: string | null | undefined`, where:

- `undefined`: modal closed;
- `null`: open with no preselected product;
- string: open with that product preselected.

- [ ] **Step 2: Add row/card action**

Add `Thêm key` next to `Xem kho` for each row/card. Clicking it sets `quickAddProductId` to the product id.

- [ ] **Step 3: Keep header add button**

Header `+ Thêm key` opens the same modal with `quickAddProductId` set to `null`.

- [ ] **Step 4: Pass initial product id**

Render:

```tsx
{quickAddProductId !== undefined && (
  <QuickAddKeysModal
    products={products}
    initialProductId={quickAddProductId}
    onClose={() => setQuickAddProductId(undefined)}
  />
)}
```

---

### Task 4: Keys Page Primary Workflow and Copy

**Files:**
- Modify: `web/src/app/(admin)/admin/stock/keys/page.tsx`

- [ ] **Step 1: Import shared modal and add state**

Import `QuickAddKeysModal`; add `quickAddOpen` state.

- [ ] **Step 2: Header actions**

Make `Tất cả Key` page header include:

- primary `+ Thêm key` button opening modal;
- secondary link back to `/admin/stock` labeled `Tổng quan kho`.

- [ ] **Step 3: Copy key on click**

Wrap key content in a button. On click, call `navigator.clipboard.writeText(row.content)` and show `Đã copy key`. If clipboard fails, show error toast.

- [ ] **Step 4: Modal invalidation**

Use the modal's existing invalidation plus page query invalidation so added keys appear after close.

---

### Task 5: Rich Editor Sticky Toolbar and Tables

**Files:**
- Modify: `web/package.json`
- Modify: `web/src/components/RichEditorRich.tsx`
- Modify: `web/src/app/(admin)/admin/products/page.tsx`

- [ ] **Step 1: Add dependencies**

Add these dependencies to `web/package.json` with the same version family as TipTap:

```json
"@tiptap/extension-table": "^3.22.4",
"@tiptap/extension-table-cell": "^3.22.4",
"@tiptap/extension-table-header": "^3.22.4",
"@tiptap/extension-table-row": "^3.22.4"
```

- [ ] **Step 2: Add table extensions**

In `RichEditorRich.tsx`, import and configure:

```ts
Table.configure({ resizable: true }),
TableRow,
TableHeader,
TableCell,
```

- [ ] **Step 3: Add table toolbar buttons**

Add buttons for:

- insert table;
- add column before;
- add column after;
- delete column;
- add row before;
- add row after;
- delete row;
- delete table.

Disable destructive table buttons when `!editor.isActive('table')`.

- [ ] **Step 4: Make toolbar sticky in modal scroll area**

Keep the toolbar `sticky top-0 z-20`, and mark product modal scroll content with a class/data attribute so the sticky positioning is scoped to the modal's scrolling container.

- [ ] **Step 5: Verify web build**

Run: `npm run build:web`

Expected: build succeeds.

---

### Task 6: Final Verification

**Files:**
- All modified files

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
node --test tests/api/admin-products-variant-names.test.js tests/api/admin-products-variant-summary.test.js
```

Expected: all tests pass.

- [ ] **Step 2: Run web build**

Run:

```bash
npm run build:web
```

Expected: build succeeds.

- [ ] **Step 3: Manual smoke checklist**

Verify in browser if dev server is available:

- `/admin/stock/keys` has `Thêm key`;
- clicking a key copies it;
- `/admin/stock` row `Thêm key` preselects product;
- modal search matches product and variant text;
- product editor can insert and edit a basic table;
- editor toolbar remains visible while scrolling the product modal.
