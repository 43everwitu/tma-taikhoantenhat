# Variant Description Basic Editor Design

## Context

Admin product descriptions already use `RichEditorRich`, so formatting such as paragraphs, bold text, lists, and links can be saved as HTML and rendered correctly in the Mini App.

Variant descriptions are different today. In `web/src/app/(admin)/admin/products/VariantsManager.tsx`, the field `Mô tả ngắn` is still a plain `<textarea>`. Admins can type line breaks, but the value is sent as plain text in `description`. The Mini App already renders selected variant descriptions as HTML in `VariantPicker`:

```tsx
<div
  className="rich-text opacity-80"
  dangerouslySetInnerHTML={{ __html: selected.description }}
/>
```

That means the storefront can display formatted variant descriptions, but the admin UI does not provide a safe editor for producing the intended HTML. The result is content that appears as one flat paragraph or loses intended formatting.

## Goals

- Replace the variant `Mô tả ngắn` textarea with a compact rich-text editor.
- Support basic formatting needed for short variant copy:
  - paragraph/line breaks
  - bold
  - italic
  - underline
  - bullet list
  - numbered list
  - link
  - clear formatting
- Save the value as HTML in the existing `product_variants.description` field.
- Keep Mini App rendering through the existing `.rich-text` HTML path.
- Keep the editor lightweight for the variant modal.

## Non-Goals

- Do not add image upload, tables, or headings to the variant description editor.
- Do not change DB schema.
- Do not change product description or long-description editors.
- Do not rewrite public product detail rendering.
- Do not change the variant input-field editor.

## Proposed Approach

Create a small reusable component such as `web/src/components/RichEditorBasic.tsx`.

It should reuse the existing TipTap stack already installed in `web/package.json`:

- `@tiptap/react`
- `@tiptap/starter-kit`
- `@tiptap/extension-link`
- `@tiptap/extension-underline`

The toolbar should be intentionally smaller than `RichEditorRich`:

- bold
- italic
- underline
- bullet list
- ordered list
- link
- clear formatting

No image picker, table extension, or heading buttons should be included.

## Admin Flow

In `VariantsManager.tsx`:

- Import `RichEditorBasic`.
- Replace the `textarea` for `form.description` with:

```tsx
<RichEditorBasic
  value={form.description}
  onChange={(html) => setForm({ ...form, description: html })}
  placeholder="Mô tả ngắn cho biến thể..."
/>
```

Existing save payload stays unchanged:

```ts
description: form.description || null
```

This keeps API and DB shape stable.

## Public Rendering

No public rendering rewrite is required. `VariantPicker` already renders `selected.description` as HTML inside `.rich-text`.

Expected result:

- Admin enters two paragraphs -> Mini App shows separate paragraphs.
- Admin marks text bold -> Mini App shows bold text.
- Admin adds a link -> Mini App shows a clickable link with existing rich-text styling.

## Backend And Sanitization

`src/api/routes/admin/variants.js` currently accepts `description` as a string up to 20,000 characters. Public product shaping uses `sanitizeDescription` for variant descriptions before client output through `productService`.

This change keeps that model:

- Admin route accepts the editor HTML.
- Public/client route continues to sanitize before returning it to the Mini App.
- No new backend schema or sanitizer is introduced.

## Error Handling

- Empty editor content should continue saving as `null` through the existing `form.description || null` behavior.
- Invalid or unsafe HTML should not be trusted by the frontend; public output remains sanitized by the existing public product shaping path.
- If the editor is not initialized yet, the component may render `null` briefly, matching the existing `RichEditorRich` behavior.

## Testing

Verification should cover:

- Type/lint check for the new component and `VariantsManager` import.
- Manual smoke in admin:
  - open product edit modal
  - edit a variant
  - add line break, bold text, and a link in `Mô tả ngắn`
  - save
  - reopen and confirm formatting remains
- Manual smoke in Mini App:
  - open product detail
  - select the edited variant
  - confirm line breaks, bold text, and link render correctly.

If practical, add a focused component-level or utility test only if the existing project already has a suitable frontend test harness. Do not add a new frontend test framework for this small UI change.

## Success Criteria

- Variant `Mô tả ngắn` can be edited with basic formatting controls.
- Saved formatted descriptions display correctly in Mini App variant detail.
- Product description editors remain unchanged.
- No DB migration is required.
- The variant modal stays compact and does not include image/table/heading controls.
