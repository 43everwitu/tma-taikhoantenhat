# Variant Description Basic Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the variant short-description textarea with a compact rich-text editor that saves HTML and renders correctly in the Mini App.

**Architecture:** Add a small `RichEditorBasic` TipTap component with only formatting controls needed for variant copy: paragraphs, bold, italic, underline, lists, links, and clear formatting. Wire it into `VariantsManager` while keeping the existing API payload and public rendering unchanged.

**Tech Stack:** Next.js App Router, React, TypeScript, TipTap, existing `lucide-react` icon exports, existing admin API.

---

## File Structure

- Create `web/src/components/RichEditorBasic.tsx`: compact TipTap editor for short HTML copy.
- Modify `web/src/app/(admin)/admin/products/VariantsManager.tsx`: replace the variant `Mô tả ngắn` textarea with `RichEditorBasic`.
- Verify existing public rendering in `web/src/app/(miniapp)/components/VariantPicker.tsx` remains unchanged.

## Task 1: Add Compact Rich Text Editor Component

**Files:**
- Create: `web/src/components/RichEditorBasic.tsx`

- [ ] **Step 1: Create `RichEditorBasic`**

Create `web/src/components/RichEditorBasic.tsx`:

```tsx
'use client'

import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import LinkExt from '@tiptap/extension-link'
import UnderlineExt from '@tiptap/extension-underline'
import { Bold, Italic, Underline as UnderlineIcon, Link as LinkIcon, List, ListOrdered, RemoveFormatting } from '@/lib/icons'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded hover:bg-gray-100 ${active ? 'bg-gray-200' : ''}`}
    >
      {children}
    </button>
  )
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null

  function promptLink() {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('URL', previous || 'https://')
    if (url === null) return
    if (url.trim() === '') {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run()
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-1 bg-gray-50 rounded-t-lg">
      <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="In đậm"><Bold size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="In nghiêng"><Italic size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Gạch chân"><UnderlineIcon size={14} /></ToolbarButton>
      <span className="w-px h-4 bg-gray-300 mx-1" />
      <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Danh sách"><List size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Danh sách số"><ListOrdered size={14} /></ToolbarButton>
      <span className="w-px h-4 bg-gray-300 mx-1" />
      <ToolbarButton onClick={promptLink} active={editor.isActive('link')} title="Chèn link"><LinkIcon size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Xoá định dạng"><RemoveFormatting size={14} /></ToolbarButton>
    </div>
  )
}

export function RichEditorBasic({ value, onChange, placeholder, minHeight = 120 }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        blockquote: false,
        horizontalRule: false,
        codeBlock: false,
        link: false,
        underline: false,
      }),
      UnderlineExt,
      LinkExt.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none px-3 py-2',
        style: `min-height: ${minHeight}px`,
        'data-placeholder': placeholder || '',
      },
    },
    onUpdate: ({ editor }) => {
      onChange(editor.isEmpty ? '' : editor.getHTML())
    },
  })

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-yellow-400">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
```

- [ ] **Step 2: Run a targeted TypeScript parse check**

Run:

```bash
cd web && npx tsc --noEmit --pretty false
```

Expected: no TypeScript error from `web/src/components/RichEditorBasic.tsx`. Existing project-level TypeScript issues, if any, should be recorded separately and not fixed in this task unless they are caused by the new component.

- [ ] **Step 3: Commit Task 1**

```bash
git add web/src/components/RichEditorBasic.tsx
git commit -m "feat: add basic rich text editor"
```

Expected: commit contains only `web/src/components/RichEditorBasic.tsx`.

## Task 2: Wire Editor Into Variant Modal

**Files:**
- Modify: `web/src/app/(admin)/admin/products/VariantsManager.tsx`

- [ ] **Step 1: Import the new editor**

In `web/src/app/(admin)/admin/products/VariantsManager.tsx`, add this import near other component imports:

```tsx
import { RichEditorBasic } from '@/components/RichEditorBasic'
```

- [ ] **Step 2: Replace the variant description textarea**

Replace the current `Mô tả ngắn` field:

```tsx
        <label className="block text-sm">
          <span className="text-xs opacity-70 mb-1 inline-block">Mô tả ngắn</span>
          <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="clay-input w-full text-sm" />
        </label>
```

with:

```tsx
        <label className="block text-sm">
          <span className="text-xs opacity-70 mb-1 inline-block">Mô tả ngắn</span>
          <RichEditorBasic
            value={form.description}
            onChange={(html) => setForm({ ...form, description: html })}
            placeholder="Mô tả ngắn cho biến thể..."
          />
        </label>
```

Do not change the save payload:

```ts
description: form.description || null,
```

- [ ] **Step 3: Verify public renderer is unchanged**

Run:

```bash
git diff -- web/src/app/'(miniapp)'/components/VariantPicker.tsx web/src/app/'(miniapp)'/san-pham/'[slug]'/page.tsx
```

Expected: no diff from this feature. Public rendering already uses `.rich-text` and `dangerouslySetInnerHTML`.

- [ ] **Step 4: Run frontend lint**

Run:

```bash
cd web && npm run lint
```

Expected: pass, or fail only on pre-existing errors outside `web/src/components/RichEditorBasic.tsx` and `web/src/app/(admin)/admin/products/VariantsManager.tsx`. Any new lint error in those two files must be fixed.

- [ ] **Step 5: Commit Task 2**

```bash
git add web/src/app/'(admin)'/admin/products/VariantsManager.tsx
git commit -m "feat: use rich editor for variant descriptions"
```

Expected: commit contains only `VariantsManager.tsx`.

## Task 3: Final Verification

**Files:**
- Verify: `web/src/components/RichEditorBasic.tsx`
- Verify: `web/src/app/(admin)/admin/products/VariantsManager.tsx`
- Verify unchanged: `web/src/app/(miniapp)/components/VariantPicker.tsx`

- [ ] **Step 1: Inspect final feature diff**

Run:

```bash
git diff -- web/src/components/RichEditorBasic.tsx web/src/app/'(admin)'/admin/products/VariantsManager.tsx web/src/app/'(miniapp)'/components/VariantPicker.tsx
```

Expected:

- new compact editor component
- `VariantsManager` imports and uses it for `Mô tả ngắn`
- no public renderer changes

- [ ] **Step 2: Run frontend lint**

Run:

```bash
cd web && npm run lint
```

Expected: pass, or only known pre-existing lint errors outside the two changed files.

- [ ] **Step 3: Manual smoke checklist**

With API and web running:

```bash
npm run dev:all
```

Manual checks:

- Open admin product edit modal.
- Edit a variant.
- In `Mô tả ngắn`, add two paragraphs, bold text, a bullet list, and a link.
- Save and reopen the variant; formatting should persist.
- Open the Mini App product detail page.
- Select the edited variant; formatting should render with separate paragraphs, bold text, list, and clickable link.

Do not commit screenshots or local data created during manual smoke.
