# Stock key sell-priority reorder — design

## Problem

Admin cannot control which stock key sells first within a product+variant. Sale
order is implicit (SQLite rowid order = insertion order = oldest key first).
Admin wants to drag-and-drop keys — including under an active search filter —
to a chosen position so those keys sell before others of the same
product+variant.

## Scope

- Priority is per (product_id, variant_id) group. Cross-group drag is blocked
  in the UI.
- Reorder is confined to the currently-loaded admin page (50 rows) — no
  cross-page drag.
- Drag-and-drop only enabled when: `status=unsold` AND exactly one
  product+variant is selected in the filter (search text alone, spanning
  multiple groups, does not enable it).
- Multi-select (existing checkbox selection) + drag moves all selected rows
  in the current group together, preserving their relative order.

## Data model

New column `stock.sort_order REAL NOT NULL DEFAULT 0`, migration
`065_stock_sort_order.js`. Backfill: `sort_order = id` for existing rows (this
exactly reproduces current FIFO behavior, since ascending id == ascending
insertion order). New stock rows also default `sort_order` to their own `id`
at insert time (existing `productService.addStock` / `POST /admin/stock/:id`
insert path) so freshly-added stock keeps FIFO-by-default unless reordered.

Index: `CREATE INDEX idx_stock_priority ON stock(product_id, variant_id, is_sold, sort_order)`.

REAL (not INTEGER) so a single drag only needs to touch the moved row(s) —
new value is the midpoint between two neighbors — never a full resequence of
the group (which could be thousands of rows, only 50 of which are loaded).

## Consumption order (the actual behavior change)

Add `ORDER BY sort_order ASC, id ASC` to every query that currently picks
free/reserved stock without an explicit order:

- `src/services/orderService.js`: `getReserved`, `getFreeStockByVariant`,
  `getFreeStockNoVariant` (~line 194-209).
- `src/services/productService.js:111` (`addStock`/legacy single free-stock
  fetch path — confirm exact call site during implementation).

This is the only place that determines real sale order; everything else is
display/admin UX.

## Admin list API — `GET /admin/stock`

When `productId` is a positive int AND `variantId` is present (either a
positive int or `0` for "no variant") AND `sold=false`: order by
`s.sort_order ASC, s.id ASC` and include `sortOrder` (number) on each item.

All other cases (no product+variant narrowed to one group, or `sold=true`/`all`):
unchanged `ORDER BY s.id DESC`, no `sortOrder` field needed (FE won't render
drag handles).

## Reorder API — `PATCH /admin/stock/_reorder`

Request:
```
{ ids: number[], beforeId: number|null, afterId: number|null }
```
- `ids`: the dragged key ids, in display order (top→bottom) at their new
  position.
- `beforeId`/`afterId`: ids of the two rows immediately adjacent to the drop
  slot in the *current page's displayed list* (after removing the dragged
  ids), or `null` at a page edge.

Validation (400/409 on failure):
- `ids` non-empty, all rows exist, `is_sold = 0`.
- `ids` + `beforeId` + `afterId` (when non-null) all share the same
  `product_id` and `variant_id`.

Sort value assignment:
- Look up `sort_order` of `beforeId` (`beforeSort`) and `afterId`
  (`afterSort`) when present.
- Both present: `step = (afterSort - beforeSort) / (ids.length + 1)`;
  `ids[i].sort_order = beforeSort + step * (i + 1)`.
- Only `afterSort` (dropped at very top of page): `ids[i].sort_order =
  afterSort - GAP * (ids.length - i)` (GAP = 1), giving ascending values below
  `afterSort` in display order.
- Only `beforeSort` (dropped at very bottom of page):
  `ids[i].sort_order = beforeSort + GAP * (i + 1)`.
- Neither (page holds only the moved ids — e.g. filtered group ≤ page size and
  entire result is being reordered): `ids[i].sort_order = i` (sequential from
  0).

Single `UPDATE stock SET sort_order = ? WHERE id = ?` per id inside a
transaction. Audit log `stock.reorder` with before/after positions.

Known limitation (acceptable, not handled): repeated inserts into the exact
same tiny gap could theoretically approach float precision limits. Not worth
a renumber routine for manual admin drag usage.

## Frontend — `web/src/app/(admin)/admin/stock/keys/page.tsx`

- Reorder mode = `status === 'unsold' && productId && variantId !== ''`
  (mirrors the backend condition; `variantId` empty string means "all
  variants" so must be a concrete value including `'0'`).
- In reorder mode: fetch includes `sortOrder`; rows render with a drag handle
  (dnd-kit `DndContext` + `SortableContext`, pattern from
  `web/src/app/(admin)/admin/products/VariantsManager.tsx`).
- Drag start on a row that's part of the current `selectedIds` (size > 1):
  move the whole selected subset (in their current display order) as one
  block. Drag start on an unselected row: move just that row.
- `onDragEnd`: compute `remaining` = displayed row ids minus moved ids;
  find drop index in `remaining` from the `over` id; derive `beforeId`/
  `afterId` from `remaining[idx-1]`/`remaining[idx]`; call the reorder
  mutation; invalidate `['admin','stock']`.
- Drop target belongs to a different product/variant: impossible in this
  view since the list is already filtered to one group — no extra guard
  needed beyond the mode gate itself.
- Outside reorder mode: current behavior unchanged (no drag handles, `id
  DESC`).

## Testing

- Backend: `tests/services/*` — add coverage that free-stock selection
  respects `sort_order` (lower sort_order sold first, ties broken by id).
  Add a stock-route test for `_reorder` covering: happy path (before+after,
  only-before, only-after, neither), cross-group rejection, sold-item
  rejection.
- Manual: drag in the browser against `data/shop.db`, purge test data after
  (per repo `CLAUDE.md` rule).
