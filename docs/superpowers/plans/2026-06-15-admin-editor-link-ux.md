# Admin Editor Link UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sửa TipTap editor trong admin/products để toolbar giữ selection và link có thể nhìn, mở, sửa, gỡ bình thường.

**Architecture:** Thêm helper UI nhỏ dùng chung cho link popover và toolbar mouse handling. Các editor hiện có vẫn giữ extension/schema riêng, chỉ đổi cách toolbar gọi command và cách link được quản lý.

**Tech Stack:** Next 16 App Router, React 19, TipTap 3.22, TypeScript, ESLint.

---

## File Structure

- Create: `web/src/components/editor/linkTools.tsx`
  - `normalizeLinkUrl()`
  - `runEditorCommand()`
  - `LinkPopover`

- Modify: `web/src/components/RichEditorRich.tsx`
  - Toolbar button dùng `onMouseDown`.
  - Link prompt dùng normalize + link popover.

- Modify: `web/src/components/RichEditorBasic.tsx`
  - Toolbar button dùng `onMouseDown`.
  - Link prompt dùng normalize + link popover.

- Modify: `web/src/components/RichEditor.tsx`
  - Toolbar button dùng `onMouseDown`.
  - Link prompt dùng normalize + link popover.

- Modify: `web/src/app/globals.css`
  - Style `.ProseMirror a`, active link và `.admin-editor-link-popover`.

## Task 1: Shared Link Tools

**Files:**
- Create: `web/src/components/editor/linkTools.tsx`

- [ ] **Step 1: Create helper module**

Create `web/src/components/editor/linkTools.tsx`:

```tsx
'use client'

import type { Editor } from '@tiptap/react'
import type { MouseEvent, ReactNode } from 'react'

export function normalizeLinkUrl(raw: string) {
  const url = raw.trim()
  if (!url) return ''
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url
  return `https://${url}`
}

export function runEditorCommand(event: MouseEvent<HTMLButtonElement>, command: () => void) {
  event.preventDefault()
  command()
}

export function LinkPopover({
  editor,
  onEdit,
}: {
  editor: Editor | null
  onEdit: () => void
}) {
  if (!editor || !editor.isActive('link')) return null

  const href = String(editor.getAttributes('link').href || '')
  if (!href) return null

  return (
    <div className="admin-editor-link-popover">
      <span className="admin-editor-link-popover__url" title={href}>{href}</span>
      <button
        type="button"
        onMouseDown={(event) => runEditorCommand(event, () => window.open(href, '_blank', 'noopener,noreferrer'))}
      >
        Mở
      </button>
      <button type="button" onMouseDown={(event) => runEditorCommand(event, onEdit)}>
        Sửa
      </button>
      <button
        type="button"
        onMouseDown={(event) => runEditorCommand(event, () => editor.chain().focus().extendMarkRange('link').unsetLink().run())}
      >
        Gỡ
      </button>
    </div>
  )
}

export function ToolbarMouseButton({
  onRun,
  active,
  disabled,
  title,
  children,
}: {
  onRun: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(event) => runEditorCommand(event, onRun)}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed ${active ? 'bg-gray-200' : ''}`}
    >
      {children}
    </button>
  )
}
```

## Task 2: Product Rich Editor

**Files:**
- Modify: `web/src/components/RichEditorRich.tsx`

- [ ] **Step 1: Use shared toolbar/link tools**

In `RichEditorRich.tsx`:

- Remove local `Tb`.
- Import `LinkPopover`, `ToolbarMouseButton`, `normalizeLinkUrl`.
- Update `promptLink()` to trim/normalize URL and use `extendMarkRange('link')`.
- Render `<LinkPopover editor={editor} onEdit={promptLink} />` below toolbar.
- Replace `<Tb ...>` calls with `<ToolbarMouseButton onRun={...}>`.
- For `setLibOpen(true)`, also use mouse-down button so selection is not lost before media dialog.

Expected link command body:

```tsx
function promptLink() {
  if (!editor) return
  const url = window.prompt('URL', editor.getAttributes('link').href || 'https://')
  if (url === null) return
  const href = normalizeLinkUrl(url)
  if (!href) editor.chain().focus().extendMarkRange('link').unsetLink().run()
  else editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
}
```

## Task 3: Variant Basic Editor

**Files:**
- Modify: `web/src/components/RichEditorBasic.tsx`

- [ ] **Step 1: Use shared toolbar/link tools**

In `RichEditorBasic.tsx`:

- Remove local `ToolbarButton`.
- Import `LinkPopover`, `ToolbarMouseButton`, `normalizeLinkUrl`.
- Update prompt link to normalize URL.
- Render `LinkPopover` below toolbar.
- Replace toolbar buttons with `ToolbarMouseButton`.

## Task 4: Telegram/Usage Editor

**Files:**
- Modify: `web/src/components/RichEditor.tsx`

- [ ] **Step 1: Use shared toolbar/link tools**

In `RichEditor.tsx`:

- Remove local `ToolbarButton`.
- Import `LinkPopover`, `ToolbarMouseButton`, `normalizeLinkUrl`.
- Update prompt link to normalize URL.
- Render `LinkPopover` below toolbar.
- Replace toolbar buttons with `ToolbarMouseButton`.

## Task 5: Editor Link CSS

**Files:**
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Add editor styles**

Add CSS near rich-text styles:

```css
.ProseMirror a {
  color: var(--brand-gold-deep, #b88500);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.ProseMirror a:hover {
  color: var(--brand-ink, #1c222b);
  background: var(--brand-gold-soft, #fff1b8);
}
.ProseMirror .ProseMirror-selectednode,
.ProseMirror a[data-active="true"] {
  background: var(--brand-gold-soft, #fff1b8);
}
.admin-editor-link-popover {
  display: flex;
  align-items: center;
  gap: .5rem;
  padding: .375rem .5rem;
  border-bottom: 1px solid var(--color-clay-oat, #e7e0d2);
  background: var(--brand-gold-soft, #fff7e0);
  font-size: .8125rem;
}
.admin-editor-link-popover__url {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--brand-ink, #1c222b);
}
.admin-editor-link-popover button {
  border-radius: 6px;
  padding: .25rem .5rem;
  background: #fff;
  color: var(--brand-ink, #1c222b);
  border: 1px solid color-mix(in srgb, var(--brand-ink, #1c222b) 14%, transparent);
}
```

## Task 6: Verification

**Files:**
- Verify changed web files.

- [ ] **Step 1: TypeScript**

Run:

```bash
cd web && npx tsc --noEmit --pretty false
```

Expected: exit 0.

- [ ] **Step 2: ESLint focused files**

Run:

```bash
cd web && npx eslint src/components/RichEditorRich.tsx src/components/RichEditorBasic.tsx src/components/RichEditor.tsx src/components/editor/linkTools.tsx
```

Expected: exit 0.

- [ ] **Step 3: Diff scope**

Run:

```bash
git diff -- web/src/components/RichEditorRich.tsx web/src/components/RichEditorBasic.tsx web/src/components/RichEditor.tsx web/src/components/editor/linkTools.tsx web/src/app/globals.css docs/superpowers/plans/2026-06-15-admin-editor-link-ux.md
```

Expected: diff only covers editor link UX and CSS.
