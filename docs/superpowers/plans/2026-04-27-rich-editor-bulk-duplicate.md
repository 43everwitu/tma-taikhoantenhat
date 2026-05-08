# Rich Editor + Bulk Ops + Duplicate + Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin can rich-edit (bold/italic/URL/spoiler) the three product description fields with identical rendering on Telegram and webapp, duplicate products, and multi-select for bulk delete/toggle on `/admin/products`.

**Architecture:** Store the three text fields as Telegram-safe HTML (allowed tags: `b`, `strong`, `i`, `em`, `u`, `s`, `a`, `code`, `pre`, `tg-spoiler`, `br`). Tiptap-based editor on the admin modal outputs HTML in that subset. Telegram path sends HTML directly via `parse_mode=HTML`; the existing `richifyText` is replaced with `renderTelegramHtml` that preserves admin HTML and auto-links bare URLs in text nodes only. Webapp renders via `dangerouslySetInnerHTML` after `sanitize-html` whitelists the same tag set. Duplicate is a backend route that clones a product row with a new slug. Bulk delete/toggle is client-side fan-out over existing per-item endpoints.

**Tech Stack:** Tiptap 3 (`@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/extension-link`), `sanitize-html` (server + client), existing Express/zod/SQLite/React-Query stack. No test framework exists in the repo, so verification = `node --check`, `npx tsc --noEmit`, and manual smoke via the running dev server.

---

## File Structure

**New files:**
- `src/utils/richHtml.js` — server-side sanitizer + Telegram HTML renderer (auto-link bare URLs in text nodes, strip disallowed tags). Single responsibility: take admin-authored HTML and produce (a) DB-safe HTML, (b) Telegram-ready HTML.
- `web/src/lib/richHtml.ts` — client-side mirror: sanitize for safe rendering in the customer pages.
- `web/src/components/RichEditor.tsx` — Tiptap-based controlled editor. Props: `value: string`, `onChange: (html: string) => void`, optional `rows?: number`. Toolbar: Bold, Italic, Underline, Strike, Link (prompt URL), Spoiler, Inline code, Clear formatting.
- `web/src/components/RichText.tsx` — read-only renderer. Props: `html: string`, optional `className?: string`. Sanitizes then renders via `dangerouslySetInnerHTML`.

**Modified files:**
- `src/api/routes/admin/products.js` — add `POST /:id/duplicate` route; sanitize incoming description fields on create + update.
- `src/utils/messages.js` — keep `escapeHtml` and `formatKeysForTelegram`; replace `richifyText` with delegation to `richHtml.toTelegramHtml`. Existing call sites (`paymentConfirm.js`, `messages.selectQuantity`, `messages.contactOnly`) keep working.
- `web/src/app/admin/products/page.tsx` — replace three `<textarea>` (description, longDescription, usageInstructions) with `<RichEditor>`; add row-checkbox column + bulk action bar (delete + toggle); add Duplicate button per row + per card.
- `web/src/app/san-pham/[slug]/page.tsx` — render `description` and `longDescription` via `<RichText>` (replaces plain `whitespace-pre-wrap`).

**No DB migration:** existing `TEXT` columns hold HTML.

**No test files:** repository has no test runner. Each task ends with `node --check` (backend) and/or `npx tsc --noEmit` (web), plus a manual smoke step in the dev server.

---

## Task 1: Server-side rich HTML sanitizer + Telegram renderer

**Files:**
- Create: `src/utils/richHtml.js`
- Modify: `package.json` (add `sanitize-html` dep)

- [ ] **Step 1: Install `sanitize-html` for backend**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && npm install sanitize-html@^2.13.0
```

Expected: `sanitize-html` added to `dependencies`, no audit errors that break install.

- [ ] **Step 2: Create `src/utils/richHtml.js`**

```javascript
const sanitizeHtml = require('sanitize-html');

// Tag set is the intersection of (a) what Telegram parse_mode=HTML accepts
// and (b) what the webapp will safely render. Adding tags here also requires
// updating web/src/lib/richHtml.ts.
const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'a', 'code', 'pre', 'br', 'tg-spoiler'];
const ALLOWED_ATTR = { a: ['href'] };

const SANITIZE_OPTS = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTR,
  allowedSchemes: ['http', 'https'],
  // sanitize-html normalizes <br/> → <br>; both render identically on Telegram.
  selfClosing: ['br'],
  // No comments, no nested <a>.
  exclusiveFilter: (frame) => frame.tag === 'a' && (!frame.attribs.href || frame.attribs.href.trim() === ''),
};

/**
 * Strip everything outside the allowed tag set. Used on every admin write so
 * the DB never holds tags the renderers can't display.
 */
function sanitizeRich(html) {
  if (html == null) return '';
  return sanitizeHtml(String(html), SANITIZE_OPTS).trim();
}

/**
 * Convert sanitized rich HTML to Telegram-ready HTML. The sanitized form is
 * already Telegram-compatible; the only extra step is auto-linking bare URLs
 * that appear inside plain text nodes (admin may paste a link without using
 * the toolbar). URLs already inside <a href> are skipped to avoid nesting.
 */
function toTelegramHtml(html) {
  const clean = sanitizeRich(html);
  if (!clean) return '';
  // Walk the string, copying text outside <a>...</a> and auto-linking URLs in it.
  const parts = clean.split(/(<a\s[^>]*>.*?<\/a>)/gi);
  return parts.map(seg => {
    if (/^<a\s/i.test(seg)) return seg;
    return seg.replace(/(https?:\/\/[^\s<]+|www\.[^\s<]+)/g, (m) => {
      const href = m.startsWith('http') ? m : `https://${m}`;
      return `<a href="${href}">${m}</a>`;
    });
  }).join('');
}

module.exports = { sanitizeRich, toTelegramHtml, ALLOWED_TAGS };
```

- [ ] **Step 3: Smoke-test the helpers via Node REPL**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && node -e "
  const { sanitizeRich, toTelegramHtml } = require('./src/utils/richHtml');
  console.log('1:', sanitizeRich('<b>bold</b><script>x</script><div>x</div>'));
  console.log('2:', toTelegramHtml('Visit https://example.com please'));
  console.log('3:', toTelegramHtml('<a href=\"https://x.com\">x</a> and https://y.com'));
  console.log('4:', sanitizeRich('<tg-spoiler>secret</tg-spoiler>'));
"
```

Expected output:
```
1: <b>bold</b>x
2: Visit <a href="https://example.com">https://example.com</a> please
3: <a href="https://x.com">x</a> and <a href="https://y.com">https://y.com</a>
4: <tg-spoiler>secret</tg-spoiler>
```

- [ ] **Step 4: Syntax check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && node --check src/utils/richHtml.js && echo OK
```

Expected: `OK`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && git add package.json package-lock.json src/utils/richHtml.js && git commit -m "feat(server): add rich HTML sanitizer + Telegram renderer"
```

---

## Task 2: Wire sanitizer into admin product create + update

**Files:**
- Modify: `src/api/routes/admin/products.js`

- [ ] **Step 1: Import sanitizer at top of file**

Locate the top imports block (around line 1-10) and add the require:

```javascript
const { sanitizeRich } = require('../../../utils/richHtml');
```

- [ ] **Step 2: Sanitize fields in `POST /` (create) before insert**

Find the `db.prepare(\`INSERT INTO products ...\`)...run(...)` call inside the create handler. Replace the three description args with sanitized versions. Locate the existing line:

```javascript
    .run(categoryId, d.name, d.price, d.description || null, d.emoji, slug,
      d.imageUrl || null, d.longDescription || null, d.lowStockThreshold,
      d.usageInstructions || null,
      d.promotion || null, d.contactOnly ? 1 : 0, d.contactUrl || null);
```

Replace with:

```javascript
    .run(categoryId, d.name, d.price,
      d.description ? sanitizeRich(d.description) : null,
      d.emoji, slug,
      d.imageUrl || null,
      d.longDescription ? sanitizeRich(d.longDescription) : null,
      d.lowStockThreshold,
      d.usageInstructions ? sanitizeRich(d.usageInstructions) : null,
      d.promotion || null, d.contactOnly ? 1 : 0, d.contactUrl || null);
```

- [ ] **Step 3: Sanitize fields in `PUT /:id` (update)**

Find the three `if (d.description !== undefined) { sets.push('description = ?'); params.push(d.description); }` lines (and same for longDescription, usageInstructions). Replace each with sanitized push:

```javascript
  if (d.description !== undefined) { sets.push('description = ?'); params.push(d.description == null ? null : sanitizeRich(d.description)); }
  ...
  if (d.longDescription !== undefined) { sets.push('long_description = ?'); params.push(d.longDescription == null ? null : sanitizeRich(d.longDescription)); }
  ...
  if (d.usageInstructions !== undefined) { sets.push('usage_instructions = ?'); params.push(d.usageInstructions == null ? null : sanitizeRich(d.usageInstructions)); }
```

(Keep the order of `sets.push(...)` calls as in the original file; the only change is what gets pushed into `params`.)

- [ ] **Step 4: Syntax check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && node --check src/api/routes/admin/products.js && echo OK
```

Expected: `OK`.

- [ ] **Step 5: Manual smoke via curl after dev server reloads**

The repo runs `node --watch src/index.js`, so the file save above triggers a restart. Confirm the API didn't crash:

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && tail -5 logs/api.log
```

Expected: last lines include `🌐 API Server running on port 3000` after the latest restart.

- [ ] **Step 6: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && git add src/api/routes/admin/products.js && git commit -m "feat(admin): sanitize description fields on product create/update"
```

---

## Task 3: Replace `richifyText` with the new renderer in messages.js

**Files:**
- Modify: `src/utils/messages.js`

- [ ] **Step 1: Re-export the new renderer**

Locate the `richifyText` function (around line 140-151) and replace its body to delegate. Keep the function name so existing call sites compile unchanged.

Replace:

```javascript
function richifyText(s) {
  if (!s) return '';
  const escaped = escapeHtml(s);
  return escaped.replace(
    /(https?:\/\/[^\s<]+|www\.[^\s<]+)/g,
    (m) => {
      const href = m.startsWith('http') ? m : `https://${m}`;
      return `<a href="${href}">${m}</a>`;
    }
  );
}
```

With:

```javascript
const { toTelegramHtml } = require('./richHtml');

/**
 * Render an admin-authored field for Telegram. Inputs may already contain
 * Telegram-safe HTML (b/i/u/s/a/tg-spoiler/code/pre/br) — those tags survive.
 * Plain text and bare URLs get auto-linked. Disallowed tags are stripped.
 */
function richifyText(s) {
  if (!s) return '';
  return toTelegramHtml(s);
}
```

(The require can sit either at the top of the file or just before `richifyText`. The function declaration itself moves from inside the file body to wherever it currently lives — no other shift.)

- [ ] **Step 2: Convert plain newlines to `<br>` in `selectQuantity` so existing legacy plain-text descriptions still render with line breaks**

Find `messages.selectQuantity` (around line 30-43). Inside it, the line:

```javascript
(desc ? `\n${richifyText(desc)}\n\n` : '\n') +
```

stays as-is — `richifyText` now returns sanitized HTML where existing `\n` inside the unwrapped text segments are still preserved by Telegram's HTML parser. No change needed unless smoke testing in Step 4 reveals broken line breaks; if so, add `.replace(/\n/g, '<br>')` after `toTelegramHtml(s)` inside `richifyText`.

- [ ] **Step 3: Syntax check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && node --check src/utils/messages.js && echo OK
```

Expected: `OK`.

- [ ] **Step 4: Manual smoke — open Telegram bot, run `/menu`, click an existing product**

Goal: verify the existing plain-text `long_description` (e.g. for "Fam Netflix 5 slot renew") still renders with bare URLs auto-linked. No styling expected at this stage because no admin has saved rich content yet.

If line breaks disappear, apply the `\n` → `<br>` fallback noted in Step 2 and re-test.

- [ ] **Step 5: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && git add src/utils/messages.js && git commit -m "feat(bot): route description rendering through richHtml.toTelegramHtml"
```

---

## Task 4: Client-side rich HTML sanitizer

**Files:**
- Create: `web/src/lib/richHtml.ts`
- Modify: `web/package.json` (add `sanitize-html` + `@types/sanitize-html`)

- [ ] **Step 1: Install deps in web app**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/web" && npm install sanitize-html@^2.13.0 && npm install -D @types/sanitize-html@^2.13.0
```

Expected: both packages added.

- [ ] **Step 2: Create `web/src/lib/richHtml.ts`**

```typescript
import sanitizeHtml from 'sanitize-html'

// Mirror of src/utils/richHtml.js ALLOWED_TAGS — kept identical so server
// and client agree on the tag whitelist.
const ALLOWED_TAGS = ['b', 'strong', 'i', 'em', 'u', 's', 'a', 'code', 'pre', 'br', 'tg-spoiler']

const OPTS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https'],
  selfClosing: ['br'],
}

/**
 * Sanitize admin-authored HTML for safe rendering in the customer pages.
 * Same allowed-tag set as the server-side sanitizer, so what survives storage
 * also survives display.
 */
export function sanitizeRich(html: string | null | undefined): string {
  if (!html) return ''
  return sanitizeHtml(html, OPTS).trim()
}
```

- [ ] **Step 3: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/web" && npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 4: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && git add web/package.json web/package-lock.json web/src/lib/richHtml.ts && git commit -m "feat(web): add client-side rich HTML sanitizer"
```

---

## Task 5: `<RichText>` read-only renderer + use it on customer detail page

**Files:**
- Create: `web/src/components/RichText.tsx`
- Modify: `web/src/app/san-pham/[slug]/page.tsx`

- [ ] **Step 1: Create `web/src/components/RichText.tsx`**

```tsx
'use client'

import { sanitizeRich } from '@/lib/richHtml'

interface Props {
  html: string | null | undefined
  className?: string
}

// Renders admin-authored rich HTML. Sanitization happens here so callers
// don't have to remember to do it. The wrapper carries the typography
// styling: spoilers blur until clicked, links pick up the page's accent.
export function RichText({ html, className = '' }: Props) {
  const safe = sanitizeRich(html)
  if (!safe) return null
  return (
    <div
      className={`rich-text ${className}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}
```

- [ ] **Step 2: Add base styles for `.rich-text` in `web/src/app/globals.css`**

Append at end of `@layer components { ... }`:

```css
.rich-text { white-space: pre-wrap; line-height: 1.55; }
.rich-text a { text-decoration: underline; color: var(--color-clay-ink); }
.rich-text code { background: var(--color-clay-oat-light); padding: 0 .25rem; border-radius: 4px; font-family: var(--font-mono); font-size: .9em; }
.rich-text pre { background: var(--color-clay-oat-light); padding: .75rem; border-radius: 8px; font-family: var(--font-mono); font-size: .85em; overflow-x: auto; }
.rich-text tg-spoiler { background: var(--color-clay-charcoal); color: var(--color-clay-charcoal); border-radius: 4px; cursor: pointer; transition: color .2s; }
.rich-text tg-spoiler:hover, .rich-text tg-spoiler.revealed { color: #fff; }
```

- [ ] **Step 3: Add a tiny client-side toggle for spoilers**

Append to `web/src/components/RichText.tsx` an effect that wires click-to-reveal:

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { sanitizeRich } from '@/lib/richHtml'

interface Props {
  html: string | null | undefined
  className?: string
}

export function RichText({ html, className = '' }: Props) {
  const safe = sanitizeRich(html)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t && t.tagName.toLowerCase() === 'tg-spoiler') t.classList.toggle('revealed')
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [safe])

  if (!safe) return null
  return (
    <div
      ref={ref}
      className={`rich-text ${className}`}
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  )
}
```

- [ ] **Step 4: Use `<RichText>` on the customer detail page**

In `web/src/app/san-pham/[slug]/page.tsx`, find the description block (around line 170-176):

```tsx
{product.description && (
  <div className="mb-6">
    <h2 className="font-semibold mb-2">Mô tả</h2>
    <p className="text-clay-charcoal leading-relaxed whitespace-pre-wrap">
      {product.description}
    </p>
  </div>
)}
```

Replace with:

```tsx
{(product.longDescription || product.description) && (
  <div className="mb-6">
    <h2 className="font-semibold mb-2">Mô tả</h2>
    <RichText
      html={product.longDescription || product.description}
      className="text-clay-charcoal"
    />
  </div>
)}
```

Add the import near the other component imports at the top of the file:

```tsx
import { RichText } from '@/components/RichText'
```

- [ ] **Step 5: Verify the `Product` interface includes `longDescription`**

In the same file, the `Product` interface should already have `usageInstructions` but may be missing `longDescription`. Add it if absent:

```tsx
interface Product {
  // ...existing fields
  longDescription?: string
}
```

- [ ] **Step 6: Type-check + visual smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/web" && npx tsc --noEmit
```

Then open `http://localhost:3001/san-pham/<any-slug>` and confirm the description renders. For an existing legacy plain-text description (e.g. "Fam Netflix"), the text should display unchanged because `sanitizeRich` is a no-op on plain text.

- [ ] **Step 7: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && git add web/src/components/RichText.tsx web/src/app/globals.css web/src/app/san-pham/\[slug\]/page.tsx && git commit -m "feat(web): RichText renderer + use on customer detail page"
```

---

## Task 6: `<RichEditor>` Tiptap component

**Files:**
- Create: `web/src/components/RichEditor.tsx`
- Modify: `web/package.json` (add Tiptap deps)

- [ ] **Step 1: Install Tiptap**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/web" && npm install @tiptap/react@^3.0.0 @tiptap/starter-kit@^3.0.0 @tiptap/extension-link@^3.0.0 @tiptap/extension-underline@^3.0.0
```

Expected: 4 Tiptap packages installed. (StarterKit already includes Bold/Italic/Strike/Code; Underline + Link + custom Spoiler get added separately.)

- [ ] **Step 2: Create `web/src/components/RichEditor.tsx`**

```tsx
'use client'

import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { Mark, mergeAttributes } from '@tiptap/core'
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Link as LinkIcon, EyeOff, Code, RemoveFormatting } from '@/lib/icons'

// Custom <tg-spoiler> mark — Telegram's native spoiler syntax. Tiptap has
// no built-in spoiler, so we declare a one-line Mark that round-trips the tag.
const Spoiler = Mark.create({
  name: 'spoiler',
  parseHTML() { return [{ tag: 'tg-spoiler' }] },
  renderHTML({ HTMLAttributes }) { return ['tg-spoiler', mergeAttributes(HTMLAttributes), 0] },
})

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  rows?: number
}

function ToolbarButton({ onClick, active, disabled, title, children }: {
  onClick: () => void; active?: boolean; disabled?: boolean; title: string; children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded hover:bg-gray-100 disabled:opacity-40 ${active ? 'bg-gray-200' : ''}`}
    >{children}</button>
  )
}

function Toolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null
  const promptLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('URL', prev || 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-1 bg-gray-50 rounded-t-lg">
      <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="In đậm"><Bold size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="In nghiêng"><Italic size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Gạch chân"><UnderlineIcon size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Gạch ngang"><Strikethrough size={14} /></ToolbarButton>
      <ToolbarButton onClick={promptLink} active={editor.isActive('link')} title="Chèn link"><LinkIcon size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleMark('spoiler').run()} active={editor.isActive('spoiler')} title="Ẩn nội dung (spoiler)"><EyeOff size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Code inline"><Code size={14} /></ToolbarButton>
      <ToolbarButton onClick={() => editor.chain().focus().unsetAllMarks().run()} title="Xoá định dạng"><RemoveFormatting size={14} /></ToolbarButton>
    </div>
  )
}

export function RichEditor({ value, onChange, placeholder, rows = 4 }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        blockquote: false,
        horizontalRule: false,
        codeBlock: false,
      }),
      Underline,
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Spoiler,
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose-editor focus:outline-none px-3 py-2',
        style: `min-height: ${rows * 1.5}rem`,
        'data-placeholder': placeholder || '',
      },
    },
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      // Tiptap emits <p> wrappers for paragraphs; the storage format is
      // line-break-only, so collapse <p>...</p> → ...<br>.
      const flat = html
        .replace(/<p[^>]*><\/p>/g, '<br>')
        .replace(/<p[^>]*>/g, '')
        .replace(/<\/p>/g, '<br>')
        .replace(/(<br>)+$/, '')
      onChange(flat)
    },
  })

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-indigo-500">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  )
}
```

- [ ] **Step 3: Confirm the lucide icons used above are exported from `@/lib/icons`**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && grep -nE "Bold|Italic|Underline|Strikethrough|^.*Link\b|EyeOff|Code|RemoveFormatting" web/src/lib/icons.ts | head
```

Expected: each icon name appears (re-exported from `lucide-react`). For any missing icon, add a re-export line in `web/src/lib/icons.ts` of the form:

```ts
export { Bold, Italic, Underline, Strikethrough, Link, EyeOff, Code, RemoveFormatting } from 'lucide-react'
```

(Only add the names that grep reports missing.)

- [ ] **Step 4: Type-check**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/web" && npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 5: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && git add web/package.json web/package-lock.json web/src/components/RichEditor.tsx web/src/lib/icons.ts && git commit -m "feat(web): RichEditor (Tiptap) component"
```

---

## Task 7: Use `<RichEditor>` on admin product modal

**Files:**
- Modify: `web/src/app/admin/products/page.tsx`

- [ ] **Step 1: Import the editor**

Near the existing imports at the top of the file, add:

```tsx
import { RichEditor } from '@/components/RichEditor'
```

- [ ] **Step 2: Replace `description` textarea**

Find the block:

```tsx
<label className="block text-sm font-medium text-gray-700 mt-3">Mô tả ngắn</label>
<textarea
  rows={2}
  value={form.description}
  onChange={e => setForm({ ...form, description: e.target.value })}
  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
  placeholder="Hiển thị trên thẻ sản phẩm..."
/>
```

Replace the `<textarea>` with:

```tsx
<RichEditor
  value={form.description}
  onChange={(html) => setForm({ ...form, description: html })}
  rows={2}
  placeholder="Hiển thị trên thẻ sản phẩm..."
/>
```

- [ ] **Step 3: Replace `longDescription` textarea**

Find the block beginning `<label ...>Mô tả chi tiết</label>` and replace its `<textarea>` with:

```tsx
<RichEditor
  value={form.longDescription}
  onChange={(html) => setForm({ ...form, longDescription: html })}
  rows={4}
  placeholder="Mô tả đầy đủ hiển thị trên trang sản phẩm..."
/>
```

- [ ] **Step 4: Replace `usageInstructions` textarea**

Find the block beginning `<label ...>Hướng dẫn sử dụng (gửi sau khi giao hàng)</label>` and replace its `<textarea>` with:

```tsx
<RichEditor
  value={form.usageInstructions}
  onChange={(html) => setForm({ ...form, usageInstructions: html })}
  rows={5}
  placeholder="Cách đăng nhập, lưu ý bảo mật, link app..."
/>
```

- [ ] **Step 5: Type-check + smoke test**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/web" && npx tsc --noEmit
```

Open `http://localhost:3001/admin/products`, click an existing product's "Sửa" button. Confirm:
1. Existing plain-text descriptions load into the editor unchanged.
2. Selecting text + clicking Bold wraps in `<b>` and saves.
3. Spoiler button wraps in `<tg-spoiler>` (verify via DevTools network on the PUT request).
4. Save → reopen the same product → formatting persists.

- [ ] **Step 6: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && git add web/src/app/admin/products/page.tsx && git commit -m "feat(admin): replace description textareas with RichEditor"
```

---

## Task 8: Backend `POST /:id/duplicate`

**Files:**
- Modify: `src/api/routes/admin/products.js`

- [ ] **Step 1: Add the route just before `module.exports = router;`**

Insert:

```javascript
// POST /admin/products/:id/duplicate — clone a product with a fresh slug.
// Stock rows are NOT copied; the duplicate starts empty so admins can re-stock
// independently. sort_order is appended to the end so the new row doesn't
// silently displace siblings.
router.post('/:id/duplicate', (req, res) => {
  const id = parseInt(req.params.id);
  const src = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
  if (!src) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const newName = `${src.name} (bản sao)`;
  const newSlug = buildUniqueProductSlug(newName);
  const maxSort = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products').get().m;

  const result = db.prepare(`
    INSERT INTO products
      (category_id, name, price, description, emoji, slug, image_url,
       long_description, low_stock_threshold, usage_instructions,
       promotion, contact_only, contact_url, is_active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    src.category_id, newName, src.price, src.description, src.emoji, newSlug, src.image_url,
    src.long_description, src.low_stock_threshold, src.usage_instructions,
    src.promotion, src.contact_only, src.contact_url, src.is_active,
    maxSort + 10,
  );

  auditService.log(req.admin.adminId, 'product.duplicate', 'product', result.lastInsertRowid,
    { sourceId: id, name: newName }, req.ip);

  const product = fetchProductForResponse(result.lastInsertRowid);
  eventBus.publish({ type: 'product.create', productId: result.lastInsertRowid });
  res.json({ success: true, data: shapeProduct(product) });
});
```

- [ ] **Step 2: Syntax check + dev-server reload smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && node --check src/api/routes/admin/products.js && tail -3 logs/api.log
```

Expected: `node --check` exits 0; api log shows a recent `🌐 API Server running` line.

- [ ] **Step 3: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && git add src/api/routes/admin/products.js && git commit -m "feat(admin): POST /products/:id/duplicate"
```

---

## Task 9: Duplicate button in admin UI

**Files:**
- Modify: `web/src/app/admin/products/page.tsx`

- [ ] **Step 1: Add `Copy` icon to the import**

```tsx
import { Search, Plus, Pencil, Trash2, Boxes, Sparkles, GripVertical, Copy } from '@/lib/icons'
```

If `Copy` is not yet exported from `@/lib/icons`, add it: `export { Copy } from 'lucide-react'`.

- [ ] **Step 2: Add the duplicate mutation**

After the existing `deleteMutation`, add:

```tsx
const duplicateMutation = useMutation({
  mutationFn: (id: string) => api.post(`/admin/products/${id}/duplicate`),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'products'] }),
})
```

- [ ] **Step 3: Add Duplicate button to desktop row actions**

In the desktop table row's actions cell (the `<div className="flex items-center justify-center gap-2">` block), insert before the Trash button:

```tsx
<button
  onClick={() => duplicateMutation.mutate(product.id)}
  disabled={duplicateMutation.isPending}
  className="clay-btn text-xs py-1 px-3 flex items-center gap-1 disabled:opacity-50"
  title="Nhân đôi sản phẩm"
><Copy size={14} />Nhân đôi</button>
```

- [ ] **Step 4: Add Duplicate button to the mobile card actions**

Inside the `cardActions` function, insert the same button before the Trash one (so both desktop and mobile have parity).

- [ ] **Step 5: Type-check + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/web" && npx tsc --noEmit
```

Click "Nhân đôi" on a product. A new row appears at the bottom (highest sort_order) named `<original> (bản sao)`. Stock for the new product is 0.

- [ ] **Step 6: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && git add web/src/app/admin/products/page.tsx web/src/lib/icons.ts && git commit -m "feat(admin): duplicate product button"
```

---

## Task 10: Bulk select + bulk delete/toggle

**Files:**
- Modify: `web/src/app/admin/products/page.tsx`

- [ ] **Step 1: Add selection state + helpers**

Inside the `ProductsPage` component, near the other `useState` declarations:

```tsx
const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
const allSelected = products.length > 0 && products.every(p => selectedIds.has(p.id))
const someSelected = selectedIds.size > 0
function toggleOne(id: string) {
  setSelectedIds(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
}
function toggleAll() {
  setSelectedIds(allSelected ? new Set() : new Set(products.map(p => p.id)))
}
function clearSelection() { setSelectedIds(new Set()) }
```

- [ ] **Step 2: Add bulk action handlers**

Below the existing mutations:

```tsx
async function bulkDelete() {
  if (!someSelected) return
  if (!confirm(`Xoá ${selectedIds.size} sản phẩm đã chọn?`)) return
  await Promise.all([...selectedIds].map(id => api.delete(`/admin/products/${id}`)))
  clearSelection()
  queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
}
async function bulkToggle() {
  if (!someSelected) return
  await Promise.all([...selectedIds].map(id => api.patch(`/admin/products/${id}/toggle`)))
  clearSelection()
  queryClient.invalidateQueries({ queryKey: ['admin', 'products'] })
}
```

- [ ] **Step 3: Add bulk action bar above the desktop table**

Just above the desktop table's wrapping `<div className="hidden md:block clay-card p-0 overflow-hidden">`, insert:

```tsx
{someSelected && (
  <div className="flex flex-wrap items-center gap-3 p-3 rounded-2xl bg-clay-oat-light">
    <span className="text-sm font-medium">Đã chọn {selectedIds.size}</span>
    <button onClick={bulkToggle} className="clay-btn text-xs py-1 px-3">Bật / tắt</button>
    <button onClick={bulkDelete} className="clay-btn clay-btn--pomegranate text-xs py-1 px-3">Xoá</button>
    <button onClick={clearSelection} className="clay-btn text-xs py-1 px-3">Bỏ chọn</button>
  </div>
)}
```

- [ ] **Step 4: Add header checkbox to the desktop table**

In the existing `<thead>`, add a new `<th>` as the first column (before the empty drag-handle `<th>`):

```tsx
<th className="text-center text-xs uppercase tracking-wider text-clay-charcoal py-3 px-2 w-8">
  <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Chọn tất cả" />
</th>
```

- [ ] **Step 5: Add per-row checkbox cell**

In the row map, prepend a `<td>` before the existing drag-handle cell:

```tsx
<td className="py-3 px-2 text-center">
  <input
    type="checkbox"
    checked={selectedIds.has(product.id)}
    onChange={() => toggleOne(product.id)}
    onClick={(e) => e.stopPropagation()}
  />
</td>
```

- [ ] **Step 6: Bump the empty-state `colSpan` from 8 to 9**

In the same table:

```tsx
<td colSpan={9} className="text-center py-12 text-clay-silver">
  Chưa có sản phẩm nào
</td>
```

Also bump the loading skeleton's `[...Array(8)]` (per row cells) to `[...Array(9)]`.

- [ ] **Step 7: Type-check + smoke**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/web" && npx tsc --noEmit
```

In the browser:
1. Tick 2-3 rows → bulk action bar appears.
2. Click "Bật / tắt" → toggles all selected; bar clears.
3. Click "Xoá" → confirm → all selected products removed.
4. Tick header checkbox → all rows tick; un-tick → all clear.

- [ ] **Step 8: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && git add web/src/app/admin/products/page.tsx && git commit -m "feat(admin): bulk select + bulk delete/toggle"
```

---

## Task 11: End-to-end verification

**Files:** none (manual)

- [ ] **Step 1: Type-check whole web app**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/web" && npx tsc --noEmit
```

Expected: `TypeScript: No errors found`.

- [ ] **Step 2: Backend syntax sweep**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && for f in src/utils/richHtml.js src/utils/messages.js src/api/routes/admin/products.js; do node --check "$f" || echo "FAIL $f"; done && echo OK
```

Expected: `OK`.

- [ ] **Step 3: Round-trip a rich product**

In `/admin/products`:
1. Create product "Plan Test" with longDescription containing all formats: bold word, italic word, underlined word, struck word, a link, a `<tg-spoiler>` segment, a code span. Save.
2. Reopen the product → editor shows each format toggled correctly.
3. View `/san-pham/plan-test` → bold/italic/underline/strike/link/code render. Spoiler shows blurred until clicked.
4. Open the Telegram bot, run `/menu`, click "Plan Test". The product detail message uses the same formatting (bold renders bold, link is tappable, spoiler obscures text until tapped).

- [ ] **Step 4: Round-trip duplicate + bulk**

1. Click "Nhân đôi" on Plan Test → "Plan Test (bản sao)" appears at bottom with the same formatted longDescription.
2. Tick both Plan Test and the duplicate, click "Xoá", confirm. Both removed.

- [ ] **Step 5: Final commit (cleanup if any pending)**

```bash
cd "/Users/peanut/Users/peanut/Project Local/telegram-shop-bot" && git status
```

If only modified files are untracked logs, leave as-is. Otherwise stage + commit any remaining tweaks discovered during smoke-testing.

---

## Self-Review Notes

- **Spec coverage:** Duplicate (Task 8-9), bulk select+CRUD (Task 10), sync description rendering Telegram↔webapp (Tasks 1, 3, 4, 5, 7), rich editing — bold/italic/underline/strike/link/spoiler/code (Tasks 6, 7).
- **Type consistency:** `sanitizeRich` exists in both `src/utils/richHtml.js` (CommonJS export) and `web/src/lib/richHtml.ts` (ES export); both honour the same `ALLOWED_TAGS` list — kept literally identical strings to avoid drift.
- **No placeholders:** every step has runnable commands or full code blocks. The only "if missing then add" branch is in Task 6 Step 3, which gives the exact `export` line to write.
- **Risk:** Tiptap version compatibility with React 19 — Tiptap 3.x officially supports React 19. If install fails, fall back to `^2.10.0` which also works on React 19 with the `peerDependencies` warning ignored.

