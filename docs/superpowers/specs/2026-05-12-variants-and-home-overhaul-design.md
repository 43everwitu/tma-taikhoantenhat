# Variants + Home Overhaul — Decomposition Design

**Date:** 2026-05-12
**Status:** Master decomposition. One plan per sub-project, executed in order.

## Goal

Add product variants (each with own price/stock/description/optional user-input field), fix product-detail content (tables + auto-show + no padding + new title), and rework the mini-app home (reorder hero + categories, add recently-viewed + new sections, "all products" page).

## Decomposition

| # | Sub-project | Depends on | Risk | Size |
|---|---|---|---|---|
| H | Variant schema + API | none | M (orders table change) | L |
| I | Description tables + auto-show | none | L | S |
| K | Home rework + `/san-pham` all-products page | none (parallel-safe with H/I) | L | M |
| J | Variant picker UI + email/pass input flow | H | M | L |

Order: H → I → K → J. H is the only one that gates anything else (J needs variants data in API). I + K are parallel-safe with H.

Each gets its own plan in `docs/superpowers/plans/`.

---

## Sub-project H — Variant Schema + API

### Problem
One row per `products` table maps to one SKU. Reality: same product (e.g. ChatGPT Plus) sells in 3 tiers (1 month / 3 months / 6 months) at different prices, stocks, and key types. Customer must be able to pick a variant on the detail page and on quick-buy cards.

### Approach
- **New table `product_variants`**: id, product_id, name, description (HTML, sanitized), price, sort_order, is_active, requires_input (0/1), input_label (TEXT), input_placeholder (TEXT), created_at, updated_at.
- **`stock` table gains a nullable `variant_id`** column. NULL = product-level key (back-compat). Existing rows unchanged.
- **`orders` table gains a nullable `variant_id`** column. NULL = legacy single-SKU order. When set, the line is a specific variant.
- **`orders` table gains `input_value` TEXT** (encrypted at write — wallet flow already uses AES-GCM via `ENCRYPTION_KEY`). Holds the email/password the customer supplied for variants that require it. Decrypted only when admin delivers the key.
- **Stock counting** changes: `availableStock(productId)` returns the rollup; `availableStock(productId, variantId)` returns the per-variant count when a variant is specified. Admin stock summary returns both rollup and per-variant.
- **API**:
  - `GET /products/:slug` returns `variants: [{ id, name, description, price, stock, requiresInput, inputLabel, inputPlaceholder, sortOrder }]`. Empty array if product has no variants.
  - `POST /admin/products/:productId/variants` create.
  - `PUT /admin/products/:productId/variants/:id` update.
  - `DELETE /admin/products/:productId/variants/:id` soft-delete (sets `is_active=0`).
  - `PATCH /admin/products/:productId/variants/reorder` body `{ items: [{id, sortOrder}] }`.
- **Stock routes** accept `?variantId=` for filtering; bulk-add accepts variantId per key.

### Out of scope
- UI for picking/buying variants (Sub-project J).
- Migrating any existing inline-pricing patterns from descriptions (admin re-enters variants by hand).

---

## Sub-project I — Description tables + auto-show details

### Problem
- WP descriptions contain `<table>` markup. Current sanitizer (`sanitizeDescription`) doesn't allow table tags — they get stripped.
- Some imported tables are malformed (orphan `<tr>` without `<table>`, missing `</td>`). Need a normalization pass.
- Product-detail page currently shows description, then a `<details>` toggle wrapping `longDescription` titled "Chi tiết sản phẩm". User wants: no toggle, always-shown, no padding wrapper, title "Thông tin sản phẩm".

### Approach
- Extend `sanitizeDescription` allow-list with `table, thead, tbody, tfoot, tr, th, td, caption, colgroup, col` and attrs `colspan, rowspan, scope, align`.
- Add `.rich-text table` CSS: full-width, border-collapse, alternating row backgrounds, header bold/oat-soft.
- New util `normalizeWpTables(html)` that uses `cheerio` (already a transitive dep of `sanitize-html`? — verify; if not, do regex-based repair):
  - Wrap orphan `<tr>` sequences in `<table><tbody>…</tbody></table>`.
  - Close unclosed `<td>` / `<th>` before next sibling tag.
  - Move stray text nodes inside `<table>` into the first `<td>`.
- Re-run migration pass-3 (`scripts/wp-migration/normalize-tables.js`, similar shape to pass-2) once over existing DB rows.
- Frontend `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`: remove the `<details>` wrapper; render `longDescription` directly under a heading "Thông tin sản phẩm". No `p-3` background. Section only renders when `longDescription` is non-empty.

### Out of scope
- WYSIWYG table editor (lives in Sub-project G).

---

## Sub-project K — Home rework + `/san-pham` all-products page

### Problem
- Home currently shows hero → announcements → categories → featured. User wants: hero + categories together at top, then announcements, then `featured`, `new`, `recently viewed`.
- Categories include "Uncategorized" tile — should be hidden on home (still exists in DB for unmapped imports).
- "Featured" section currently shows up to 6 random newest. User wants exactly 4 on mobile, 8 (2 rows × 4 cols at md breakpoint) on desktop.
- "Khám phá ngay" CTA and "Tất cả →" link both point to `/danh-muc/hoc-tap`. Should point to a NEW `/san-pham` all-products page.
- No "Sản phẩm khách đã xem" section. No "Sản phẩm mới" section (the existing "Sản phẩm nổi bật" is the closest, but user wants a separate "new" section ordered by created_at DESC).

### Approach
- Frontend page `web/src/app/(miniapp)/san-pham/page.tsx`: lists every product, paginated (50/page) or infinite-scroll with category filter chips at top. Reuses the `ProductCard` component + `miniapp-product-grid` responsive grid.
- New section ordering on home: hero → categories (filtered to remove `slug='uncategorized'`) → announcements → `recently viewed` (only if localStorage has IDs) → `featured` (8 items, gridable to 4 cols on md+) → `new` (newest-by-created_at, 8 items).
- Recently-viewed: track in localStorage (key `miniapp:recently-viewed`, max 12 IDs, push on product detail mount). Home queries `GET /products?ids=…` (need new query param) to render those rows.
- Featured: API already supports `?sort=newest`. Add `?featured=1` filter (driven by a new `is_featured` column on products defaulting to 0; admin can toggle). For now, if no products marked featured, fall back to newest 8.
- "Khám phá ngay" CTA in `<section.miniapp-hero>` → href `/san-pham`. "Tất cả →" link in featured section → `/san-pham`.

### Out of scope
- Search + advanced filters on `/san-pham` (defer).
- Admin UI for `is_featured` toggle (defer to admin-overhaul sub-project G or A).

---

## Sub-project J — Variant picker UI + email/password input

### Problem
After H lands, the API exposes `variants[]`. Frontend needs to render the picker, gate add-to-cart on variant selection, and capture email/password for variants that require input.

### Approach
- **Product detail**: if `variants.length > 0`, render a horizontal pill row above the price. Selecting a variant updates the displayed price, stock, description, and "add to cart" button state. Default selection: first active variant with stock > 0.
- **Cart store**: line item shape gains `variantId`, `variantName`, `inputValue`. Variant lines are keyed by `${productId}-${variantId}` instead of just productId.
- **Input field**: when selected variant has `requiresInput=true`, show a labelled input below the variant picker. Validation: non-empty before "Add to cart" enables. Store on line item.
- **Quick add from home/category**: if `variants.length > 0`, the card's "Add to cart" button opens a small bottom-sheet (mobile) / centered modal (desktop) showing variant pills + input (if required) + confirm. No detail-page navigation needed.
- **Checkout (`/dat-hang`)**: line items render variant name beneath product name. If line has `inputValue`, render as muted text.
- **Order DM**: bot template gains `{{variantName}}` / `{{inputValue}}` placeholders. Notification service decrypts `input_value` before formatting.

---

## Implementation Order Locked

1. **H** — schema + API. No UI change yet; tests verify backend wiring.
2. **I** — content fixes (tables, auto-show). Independent.
3. **K** — home rework + all-products page. Independent (uses existing single-SKU flow).
4. **J** — variant UI on top of H. Touches cart, detail, home cards, checkout, bot.

Each plan emits its own tagged release (`v0.6-variants-api`, `v0.7-content-tables`, `v0.8-home-overhaul`, `v0.9-variant-picker`).
