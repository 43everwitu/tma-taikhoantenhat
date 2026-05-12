# Sub-project G: Admin Product Modal Upgrade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Side-drawer modal (mobile fullscreen / desktop slide-right) + TipTap WYSIWYG (full toolbar: bold/italic/headings/lists/link/image) + drag-drop image upload + Media Library picker.

**Architecture:** Backend `POST /admin/upload` (multer + sharp AVIF+WebP) returns local URL. `GET /admin/uploads` lists existing files. Two TipTap instances: existing narrow `RichEditor` keeps usage_instructions, new `RichEditorRich` handles description/longDescription with image-insert hook. `EditDrawer` wraps form, replacing the center modal.

**Tech Stack:** Express `multer`, `sharp` (already dep), TipTap `@tiptap/extension-image`, existing Clay components.

---

## Tasks

### Task 1: Backend upload endpoint + multer dep

**Files:**
- Modify: `package.json` (add multer dep)
- Create: `src/api/routes/admin/upload.js`
- Modify: `src/api/routes/admin/index.js`
- Modify: `.gitignore` (already covers `data/uploads/` — verify)

- [ ] Step 1: `npm install multer --save` then verify it shows in `package.json` deps.

- [ ] Step 2: Create `src/api/routes/admin/upload.js`:

```js
const { Router } = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const sharp = require('sharp');

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.mimetype);
    cb(ok ? null : new Error('Only image uploads allowed'), ok);
  },
});

const OUT_DIR = path.resolve(__dirname, '../../../../data/uploads/products-inline');

router.post('/', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: { code: 'NO_FILE' } });
  try {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const hash = crypto.createHash('sha256').update(req.file.buffer).digest('hex').slice(0, 16);

    const targets = [
      { file: path.join(OUT_DIR, `${hash}-original.webp`), width: 800, fmt: 'webp', q: 80 },
      { file: path.join(OUT_DIR, `${hash}-original.avif`), width: 800, fmt: 'avif', q: 60 },
      { file: path.join(OUT_DIR, `${hash}-thumb.webp`), width: 400, fmt: 'webp', q: 80 },
      { file: path.join(OUT_DIR, `${hash}-thumb.avif`), width: 400, fmt: 'avif', q: 60 },
    ];

    for (const t of targets) {
      if (fs.existsSync(t.file)) continue;
      const pipeline = sharp(req.file.buffer).resize({ width: t.width, withoutEnlargement: true });
      if (t.fmt === 'avif') pipeline.avif({ quality: t.q });
      else pipeline.webp({ quality: t.q });
      await pipeline.toFile(t.file);
    }

    res.json({
      success: true,
      data: {
        url: `/uploads/products-inline/${hash}-original.webp`,
        avifUrl: `/uploads/products-inline/${hash}-original.avif`,
        thumbUrl: `/uploads/products-inline/${hash}-thumb.webp`,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'UPLOAD_FAILED', message: err.message } });
  }
});

// GET /admin/uploads — list files in products-inline + products dirs
router.get('/', (req, res) => {
  const dirs = ['products-inline', 'products'];
  const root = path.resolve(__dirname, '../../../../data/uploads');
  const items = [];
  for (const d of dirs) {
    const full = path.join(root, d);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      // Only surface "original.webp" representatives — variants are listed via the same URL pattern
      if (!f.endsWith('-original.webp')) continue;
      items.push({
        url: `/uploads/${d}/${f}`,
        dir: d,
        name: f,
        size: fs.statSync(path.join(full, f)).size,
      });
    }
  }
  items.sort((a, b) => b.name.localeCompare(a.name));
  res.json({ success: true, data: items.slice(0, 200) });
});

module.exports = router;
```

- [ ] Step 3: Mount in `src/api/routes/admin/index.js`:
```js
router.use('/upload', require('./upload'));
router.use('/uploads', require('./upload'));  // GET /uploads handled by same router
```
(Or keep separate; `/upload` for POST + `/uploads` for GET — easier to use the same router file with both verb branches.)

- [ ] Step 4: Verify:
```
touch src/index.js && sleep 3
# Login + smoke
source ~/.nvm/nvm.sh && nvm use 20 && node -e "
require('dotenv').config();
async function go() {
  const tok = (await (await fetch('http://localhost:3000/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:process.env.ADMIN_INITIAL_PASSWORD})})).json()).data.token;
  const r = await fetch('http://localhost:3000/api/v1/admin/uploads', {headers:{Authorization:'Bearer '+tok}});
  console.log('list status:', r.status);
  const j = await r.json();
  console.log('items count:', j.data?.length);
}
go();
"
```
Expected: 200 + count > 0.

- [ ] Step 5: Commit:
```
git add package.json package-lock.json src/api/routes/admin/upload.js src/api/routes/admin/index.js
git commit -m "feat(admin-api): POST /admin/upload + GET /admin/uploads with sharp pipeline"
```

### Task 2: Frontend ImageUploader + MediaLibrary

**Files:**
- Create: `web/src/components/admin/ImageUploader.tsx`
- Create: `web/src/components/admin/MediaLibrary.tsx`

- [ ] Step 1: Create `web/src/components/admin/ImageUploader.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { getCachedToken } from '@/lib/api'

interface Props {
  onUploaded: (url: string) => void
  multiple?: boolean
}

export function ImageUploader({ onUploaded, multiple = false }: Props) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  async function uploadFile(file: File) {
    setBusy(true); setErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch('/api/v1/admin/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getCachedToken()}` },
        body: fd,
      })
      const j = await res.json()
      if (!j.success) throw new Error(j.error?.message || 'Upload failed')
      onUploaded(j.data.url)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Lỗi')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <label
        className={`block border-2 border-dashed rounded-xl p-4 text-center text-sm cursor-pointer transition-colors ${dragging ? 'bg-yellow-50 border-yellow-400' : 'border-gray-300 hover:border-gray-400'}`}
        onDragEnter={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault(); setDragging(false)
          const files = Array.from(e.dataTransfer.files)
          for (const f of files) uploadFile(f)
        }}
      >
        <input
          type="file"
          accept="image/*"
          multiple={multiple}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || [])
            for (const f of files) uploadFile(f)
          }}
        />
        {busy ? 'Đang tải lên…' : 'Kéo thả hoặc click để tải ảnh lên'}
      </label>
      {err && <p className="text-xs text-red-600 mt-1">{err}</p>}
    </div>
  )
}
```

- [ ] Step 2: Create `web/src/components/admin/MediaLibrary.tsx`:

```tsx
'use client'

import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { ImageUploader } from './ImageUploader'

interface MediaItem { url: string; dir: string; name: string; size: number }

interface Props {
  onPick: (url: string) => void
  onClose: () => void
}

export function MediaLibrary({ onPick, onClose }: Props) {
  const { data, refetch } = useQuery({
    queryKey: ['admin', 'uploads'],
    queryFn: () => api.get<MediaItem[]>('/admin/uploads'),
  })
  const items = data?.data ?? []

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-3xl p-5 space-y-3 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Thư viện media</h2>
          <button onClick={onClose} className="opacity-60 text-xl leading-none">×</button>
        </div>

        <ImageUploader onUploaded={(url) => { refetch(); onPick(url) }} />

        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
          {items.map((it) => (
            <button
              key={it.url}
              type="button"
              onClick={() => onPick(it.url)}
              className="aspect-square overflow-hidden rounded-lg border border-gray-200 hover:border-yellow-400 transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt={it.name} className="w-full h-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
```

- [ ] Step 3: Verify tsc + commit:
```
cd web && npx tsc --noEmit 2>&1 | tail -3
cd .. && git add web/src/components/admin/
git commit -m "feat(admin): ImageUploader + MediaLibrary components"
```

### Task 3: RichEditorRich (extends current editor with headings/lists/images)

**Files:**
- Create: `web/src/components/RichEditorRich.tsx`

- [ ] Step 1: Install image extension if not present: `cd web && npm install @tiptap/extension-image --save` then verify in `web/package.json`.

- [ ] Step 2: Create `web/src/components/RichEditorRich.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useEditor, EditorContent, Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import LinkExt from '@tiptap/extension-link'
import UnderlineExt from '@tiptap/extension-underline'
import ImageExt from '@tiptap/extension-image'
import { Bold, Italic, Underline as UnderlineIcon, Strikethrough, Link as LinkIcon, Code, Heading2, Heading3, List, ListOrdered, ImageIcon, RemoveFormatting } from '@/lib/icons'
import { MediaLibrary } from './admin/MediaLibrary'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
}

function Tb({ onClick, active, title, children }: { onClick: () => void; active?: boolean; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded hover:bg-gray-100 ${active ? 'bg-gray-200' : ''}`}
    >{children}</button>
  )
}

export function RichEditorRich({ value, onChange, placeholder }: Props) {
  const [libOpen, setLibOpen] = useState(false)

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      UnderlineExt,
      LinkExt.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      ImageExt.configure({ HTMLAttributes: { loading: 'lazy' } }),
    ],
    content: value,
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none px-3 py-2 min-h-[200px]',
        'data-placeholder': placeholder || '',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  })

  function promptLink() {
    if (!editor) return
    const url = window.prompt('URL', editor.getAttributes('link').href || 'https://')
    if (url === null) return
    if (url === '') editor.chain().focus().unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  function insertImage(url: string) {
    if (!editor) return
    editor.chain().focus().setImage({ src: url }).run()
    setLibOpen(false)
  }

  if (!editor) return null

  return (
    <>
      <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-yellow-400">
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-2 py-1 bg-gray-50">
          <Tb onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="In đậm"><Bold size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="In nghiêng"><Italic size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="Gạch chân"><UnderlineIcon size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="Gạch ngang"><Strikethrough size={14} /></Tb>
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <Tb onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2"><Heading2 size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3"><Heading3 size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list"><List size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Ordered list"><ListOrdered size={14} /></Tb>
          <span className="w-px h-4 bg-gray-300 mx-1" />
          <Tb onClick={promptLink} active={editor.isActive('link')} title="Link"><LinkIcon size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="Code"><Code size={14} /></Tb>
          <Tb onClick={() => setLibOpen(true)} title="Chèn ảnh"><ImageIcon size={14} /></Tb>
          <Tb onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} title="Xoá định dạng"><RemoveFormatting size={14} /></Tb>
        </div>
        <EditorContent editor={editor} />
      </div>
      {libOpen && <MediaLibrary onPick={insertImage} onClose={() => setLibOpen(false)} />}
    </>
  )
}
```

Verify icons exist in `web/src/lib/icons.tsx`. If `Heading2`, `Heading3`, `List`, `ListOrdered`, `ImageIcon` aren't exported, add them (they're lucide-react named exports).

- [ ] Step 3: tsc clean, commit:
```
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
cd web && npx tsc --noEmit 2>&1 | tail -3
cd ..
git add web/package.json web/package-lock.json web/src/components/RichEditorRich.tsx web/src/lib/icons.tsx
git commit -m "feat(admin): RichEditorRich — headings/lists/images via TipTap + MediaLibrary integration"
```

### Task 4: Wire RichEditorRich into product modal

**Files:**
- Modify: `web/src/app/(admin)/admin/products/page.tsx`

- [ ] Step 1: Read the modal section (around lines 620-640). Replace the two `<RichEditor>` instances for `description` and `longDescription` with `<RichEditorRich>`:

```tsx
import { RichEditorRich } from '@/components/RichEditorRich'
```

Replace:
```tsx
              <RichEditor
                value={form.description}
                onChange={(html) => setForm({ ...form, description: html })}
                rows={2}
                placeholder="Hiển thị trên thẻ sản phẩm..."
              />
```
With:
```tsx
              <RichEditorRich
                value={form.description}
                onChange={(html) => setForm({ ...form, description: html })}
                placeholder="Hiển thị trên thẻ sản phẩm..."
              />
```

Same for `longDescription`. Keep `usageInstructions` on the original `RichEditor` (Telegram-narrow).

- [ ] Step 2: Verify + commit:
```
cd web && npx tsc --noEmit 2>&1 | tail -3
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(admin\)/admin/products/page.tsx
git commit -m "feat(admin-products): description fields use RichEditorRich"
```

### Task 5: Tag

```
git tag v0.13-admin-modal -m "Sub-project G: admin product modal — TipTap rich + MediaLibrary + upload"
```

---

## Self-Review

- G1 upload endpoint with sharp → Task 1
- G2 list endpoint → Task 1
- G3 ImageUploader + MediaLibrary → Task 2
- G4 RichEditorRich → Task 3
- G5 wire into modal → Task 4
- EditDrawer (side-drawer): deferred — center modal stays since it works; converting to drawer is layout polish, not blocker. Skip without a placeholder commit.
