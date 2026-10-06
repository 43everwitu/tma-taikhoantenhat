# Admin Stock, Key, and Editor UX Design

## Goal

Make `/admin/stock/keys` the primary key-management page while keeping `/admin/stock` as the product stock overview, improve quick key insertion from both pages, and make product rich-text editing easier for long content and tables.

## Scope

- Keep both routes:
  - `/admin/stock/keys`: primary page for viewing, filtering, editing, bulk editing, deleting, copying, and adding keys.
  - `/admin/stock`: product-level stock overview with direct actions for viewing stock and adding keys for a chosen product.
- Reuse one quick-add key modal across both pages.
- Add searchable product selection in the modal.
- Add copy-on-click for key values in `/admin/stock/keys`.
- Improve `RichEditorRich` used by product edit/create modals:
  - toolbar sticks to the top of the modal scroll area;
  - editor supports basic table editing.

## Stock UX

`/admin/stock/keys` remains a separate route and becomes the main key workflow. Its header gets a `Thêm key` button. Clicking a key value copies the raw key content to the clipboard and shows a toast.

`/admin/stock` remains a stock overview by product. It keeps the link to `Tất cả key` and adds row/card-level `Thêm key` actions. When the action is invoked from a product row, the quick-add modal opens with that product selected.

## Quick Add Modal

`QuickAddKeysModal` becomes a reusable modal with:

- `products`: product list;
- `initialProductId`: optional product id to preselect;
- `onClose`: close callback.

The product field changes from a native select to a searchable combobox. Search matches:

- product name;
- category;
- product id;
- slug;
- variant names.

When the selected product has variants, the modal still requires a variant before submitting.

To support variant-name search without many client requests, `/admin/products` includes `variantNames` for active variants.

## Rich Editor UX

`RichEditorRich` adds TipTap table extensions:

- `@tiptap/extension-table`;
- `@tiptap/extension-table-row`;
- `@tiptap/extension-table-header`;
- `@tiptap/extension-table-cell`.

The toolbar gains basic table controls:

- insert table;
- add row before/after;
- delete row;
- add column before/after;
- delete column;
- delete table.

The toolbar should stick at the top of the modal scroll container. Product modals provide the scroll container marker; the editor toolbar uses CSS sticky positioning scoped to that modal instead of sticking to the full browser window.

## Testing

- Unit-test product search matching in the quick-add modal helper.
- Verify `/admin/products` returns `variantNames`.
- Build the web app to catch TypeScript and dependency issues.
- Run focused backend/admin product tests for query changes.

## Out Of Scope

- Merging `/admin/stock` and `/admin/stock/keys` into tabs.
- Advanced table operations such as merge/split cells, cell alignment, or table styling UI.
- Reworking the full stock table architecture.
