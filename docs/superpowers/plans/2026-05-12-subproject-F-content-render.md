# Sub-project F: Content Render + WP Image Migration Pass-2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render WP-imported product descriptions as proper HTML (with inline images served from local storage) instead of literal tags.

**Architecture:** Three pieces that compose: (1) a richer sanitizer profile for descriptions that allow `<p>`, `<h2-4>`, `<img>`, lists, etc. — the existing `sanitizeRich` keeps its narrow Telegram-friendly allow-list; (2) a one-shot migration script that walks every product description, downloads each legacy `taikhoantenhat.com/wp-content/uploads/...` image through the existing Sharp AVIF+WebP pipeline, stores it under `data/uploads/products-inline/<hash>.{avif,webp}`, and rewrites the `<img src>` in the DB; (3) a frontend swap from `{p.description}` (plain text) to `dangerouslySetInnerHTML` over the sanitized HTML.

**Tech Stack:** Node 20, `sanitize-html`, `sharp`, `better-sqlite3`, Next 16, Tailwind v4. All deps already in `package.json` / `web/package.json`.

---

## File Structure

- `src/utils/richHtml.js` — **MODIFY**. Add a second sanitizer profile `sanitizeDescription` with a richer allow-list (paragraphs, headings, images, lists). Keep the existing `sanitizeRich` untouched (bot needs its narrow Telegram allow-list).
- `tests/utils/richHtml-description.test.js` — **CREATE**. Unit tests for `sanitizeDescription`.
- `src/utils/wpShortcodes.js` — **CREATE**. Pure function `stripWpShortcodes(html)` that turns `[caption …]…[/caption]` into its inner `<img>` and drops `[gallery …]`.
- `tests/utils/wpShortcodes.test.js` — **CREATE**. Unit tests for the shortcode stripper.
- `scripts/wp-migration/inline-images.js` — **CREATE**. Pass-2 migration: walk every product description, download + transform inline images, rewrite `src`, persist to DB. Idempotent.
- `tests/wp-migration/inline-images.test.js` — **CREATE**. Tests for URL extraction + rewrite logic (pure parts), not for network/sharp.
- `scripts/migrate-wp.js` — **MODIFY**. Recognise a `--inline-images` CLI flag that runs only pass-2.
- `src/services/productService.js` — **MODIFY** (read path). Apply `sanitizeDescription` on every read of `description` / `long_description` returned to public clients.
- `src/api/routes/public.js` — **MODIFY**. Use the sanitized form via productService instead of the raw column.
- `src/api/routes/admin/products.js` — **MODIFY**. Replace `sanitizeRich` calls on description/long_description with `sanitizeDescription` so admin saves don't strip away paragraph and heading tags.
- `web/src/app/(miniapp)/san-pham/[slug]/page.tsx` — **MODIFY**. Render `description` and `longDescription` through `dangerouslySetInnerHTML` inside a `.rich-text` container.
- `web/src/app/globals.css` — **MODIFY**. Extend the existing `.rich-text` rule with image, heading, paragraph, and list styles tuned for the miniapp.

---

## Notes for the Engineer

- **Read `web/AGENTS.md` first.** Next 16 has breaking changes.
- **Tests use `node --test`.** Run with `node --test tests/path.test.js`. Existing tests live in `tests/` — copy the style from `tests/utils/initData.test.js`.
- **Node 20 required.** Run `nvm use 20` if your shell defaults to 18. The dev stack (`npm run dev:all`) already handles this.
- **`data/shop.db` is the live DB.** Do not touch `db.sqlite` / `db.sqlite.fresh` (stale fork artifacts).
- **Backup before pass-2.** Run `cp data/shop.db data/shop.db.bak-$(date +%s)` before running the migration script. The script is idempotent but the rewrite mutates `products.description` / `products.long_description` in place.
- **WP backup uploads** live under `taikhoantenhat.com__2026-05-06T15_42_06+0700/files/wp-content/uploads/` at repo root (see `scripts/wp-migration/config.js`). The pass-2 script first tries the local backup before any network fetch. **If a referenced image isn't in the local backup, skip with a logged warning — do NOT fetch from the live `taikhoantenhat.com` domain.** This is a safety boundary: we don't want migration touching production. The user can re-export from WP if anything is missing.
- **Sanitize on read, not on write, for legacy data.** The DB already contains pre-migration HTML; rewriting it at admin-write time wouldn't catch read-time sanitisation of legacy rows. Read-time sanitisation is cheap (sub-ms) and handles both legacy + new writes.
- **Don't change `sanitizeRich` allow-list.** Bot side depends on it being narrow (Telegram parse_mode HTML restrictions). The new `sanitizeDescription` is a separate exported function.
- **Image hashing.** Use SHA-256 of the source bytes for the on-disk filename. Two products embedding the same WP image dedupe automatically. Keep the original file extension (jpg/png) on the source side for sharp; outputs are always avif + webp.

---

## Task 1: Add the `sanitizeDescription` profile

**Files:**
- Modify: `src/utils/richHtml.js`
- Create: `tests/utils/richHtml-description.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/utils/richHtml-description.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeDescription, sanitizeRich } = require('../../src/utils/richHtml');

test('sanitizeDescription keeps paragraphs and headings', () => {
  const html = '<p>Hello <b>world</b></p><h3>Section</h3>';
  assert.equal(sanitizeDescription(html), '<p>Hello <b>world</b></p><h3>Section</h3>');
});

test('sanitizeDescription keeps img with src and alt', () => {
  const html = '<img src="/uploads/products-inline/abc.webp" alt="Demo" width="800" height="600">';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('src="/uploads/products-inline/abc.webp"'));
  assert.ok(out.includes('alt="Demo"'));
});

test('sanitizeDescription strips script and iframe', () => {
  const html = '<p>ok</p><script>alert(1)</script><iframe src="x"></iframe>';
  assert.equal(sanitizeDescription(html), '<p>ok</p>');
});

test('sanitizeDescription keeps lists and links', () => {
  const html = '<ul><li>One <a href="https://example.com">link</a></li><li>Two</li></ul>';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('<ul>'));
  assert.ok(out.includes('<li>'));
  assert.ok(out.includes('href="https://example.com"'));
});

test('sanitizeDescription drops empty string and null', () => {
  assert.equal(sanitizeDescription(''), '');
  assert.equal(sanitizeDescription(null), '');
  assert.equal(sanitizeDescription(undefined), '');
});

test('sanitizeRich is untouched — bot allow-list still narrow', () => {
  const html = '<p>removed</p><b>kept</b>';
  // <p> is not in the bot allow-list; only inner text survives
  assert.equal(sanitizeRich(html), 'removed<b>kept</b>');
});
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/utils/richHtml-description.test.js 2>&1 | tail -10
```
Expected: `sanitizeDescription` import fails because the function doesn't exist yet.

- [ ] **Step 3: Add `sanitizeDescription` to `src/utils/richHtml.js`**

Insert this block after the existing `sanitizeRich` definition (and update the `module.exports`):

```js
const DESCRIPTION_TAGS = [
  'p', 'br', 'span', 'div',
  'h2', 'h3', 'h4',
  'b', 'strong', 'i', 'em', 'u', 's',
  'a',
  'ul', 'ol', 'li',
  'code', 'pre', 'blockquote',
  'img',
];
const DESCRIPTION_ATTR = {
  a: ['href', 'title', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  span: ['class'],
  div: ['class'],
};
const DESCRIPTION_OPTS = {
  allowedTags: DESCRIPTION_TAGS,
  allowedAttributes: DESCRIPTION_ATTR,
  allowedSchemes: ['http', 'https'],
  selfClosing: ['br', 'img'],
  // Force img to be lazy-loaded by default — admins paste lots of images and
  // lazy loading is universally beneficial for product descriptions.
  transformTags: {
    img: (tagName, attribs) => ({
      tagName: 'img',
      attribs: { ...attribs, loading: attribs.loading || 'lazy' },
    }),
  },
};

function sanitizeDescription(html) {
  if (html == null) return '';
  return sanitizeHtml(String(html), DESCRIPTION_OPTS).trim();
}
```

And extend the bottom-of-file exports:

```js
module.exports = { sanitizeRich, sanitizeDescription, toTelegramHtml, ALLOWED_TAGS };
```

- [ ] **Step 4: Run tests and confirm they pass**

```bash
node --test tests/utils/richHtml-description.test.js 2>&1 | tail -10
```
Expected: `pass 6 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/richHtml.js tests/utils/richHtml-description.test.js
git commit -m "feat(richHtml): add sanitizeDescription with rich allow-list for product copy"
```

---

## Task 2: WordPress shortcode stripper

**Files:**
- Create: `src/utils/wpShortcodes.js`
- Create: `tests/utils/wpShortcodes.test.js`

- [ ] **Step 1: Write the failing tests**

`tests/utils/wpShortcodes.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { stripWpShortcodes } = require('../../src/utils/wpShortcodes');

test('strips [caption ...] but keeps inner img', () => {
  const html = '[caption id="x" align="aligncenter" width="1024"]<img src="/a.jpg" alt="A" width="1024" height="682" /> Cap text[/caption]';
  const out = stripWpShortcodes(html);
  assert.equal(out, '<img src="/a.jpg" alt="A" width="1024" height="682" />');
});

test('drops [gallery ...] entirely', () => {
  const html = 'Before [gallery ids="1,2,3"] After';
  assert.equal(stripWpShortcodes(html), 'Before  After');
});

test('handles multiple captions in one string', () => {
  const html = '[caption id="1"]<img src="a.jpg" /> a[/caption] middle [caption id="2"]<img src="b.jpg" /> b[/caption]';
  const out = stripWpShortcodes(html);
  assert.ok(out.includes('<img src="a.jpg" />'));
  assert.ok(out.includes('<img src="b.jpg" />'));
  assert.ok(!out.includes('[caption'));
  assert.ok(!out.includes('[/caption]'));
});

test('preserves text when no shortcodes', () => {
  assert.equal(stripWpShortcodes('<p>Just html</p>'), '<p>Just html</p>');
});

test('handles null/empty', () => {
  assert.equal(stripWpShortcodes(''), '');
  assert.equal(stripWpShortcodes(null), '');
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
node --test tests/utils/wpShortcodes.test.js 2>&1 | tail -10
```
Expected: import error — `wpShortcodes` doesn't exist yet.

- [ ] **Step 3: Implement `src/utils/wpShortcodes.js`**

```js
// Replace [caption ...]INNER[/caption] with the first <img …> tag found in
// INNER. The caption text after the img tag is dropped intentionally —
// imported descriptions already have textual context above/below the image,
// and rendering captions as floating text below the image looks broken
// outside WordPress's own caption.css.
function unwrapCaption(html) {
  return html.replace(/\[caption[^\]]*\]([\s\S]*?)\[\/caption\]/gi, (_, inner) => {
    const m = inner.match(/<img\b[^>]*\/?>/i);
    return m ? m[0] : '';
  });
}

// [gallery ids="1,2,3" columns="3"] etc — drop entirely. We don't have a
// numeric-id → URL map for inline gallery attachments (only the featured
// _thumbnail_id was extracted in pass-1).
function dropGallery(html) {
  return html.replace(/\[gallery\b[^\]]*\]/gi, '');
}

function stripWpShortcodes(html) {
  if (html == null) return '';
  let out = String(html);
  out = unwrapCaption(out);
  out = dropGallery(out);
  return out;
}

module.exports = { stripWpShortcodes };
```

- [ ] **Step 4: Run tests and confirm pass**

```bash
node --test tests/utils/wpShortcodes.test.js 2>&1 | tail -10
```
Expected: `pass 5 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/utils/wpShortcodes.js tests/utils/wpShortcodes.test.js
git commit -m "feat(utils): stripWpShortcodes — unwrap [caption], drop [gallery]"
```

---

## Task 3: Inline-image migration helper (pure parts)

**Files:**
- Create: `scripts/wp-migration/inline-images.js`
- Create: `tests/wp-migration/inline-images.test.js`

We test the pure parts (URL extraction, src rewrite). The network + sharp piece is exercised in Task 5 (manual smoke run against real data).

- [ ] **Step 1: Write the failing tests**

`tests/wp-migration/inline-images.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { extractWpImageUrls, rewriteImageSrcs } = require('../../scripts/wp-migration/inline-images');

test('extractWpImageUrls finds taikhoantenhat.com uploads URLs', () => {
  const html = '<p>Hi</p><img src="https://taikhoantenhat.com/wp-content/uploads/2024/10/a.jpg" /><img src="/local/b.webp"><img src="https://taikhoantenhat.com/wp-content/uploads/2025/01/c.png" alt="c">';
  const urls = extractWpImageUrls(html);
  assert.deepEqual(urls, [
    'https://taikhoantenhat.com/wp-content/uploads/2024/10/a.jpg',
    'https://taikhoantenhat.com/wp-content/uploads/2025/01/c.png',
  ]);
});

test('extractWpImageUrls deduplicates', () => {
  const html = '<img src="https://taikhoantenhat.com/wp-content/uploads/x.jpg"><img src="https://taikhoantenhat.com/wp-content/uploads/x.jpg">';
  assert.deepEqual(extractWpImageUrls(html), ['https://taikhoantenhat.com/wp-content/uploads/x.jpg']);
});

test('extractWpImageUrls ignores non-wp-content URLs', () => {
  const html = '<img src="https://taikhoantenhat.com/some-page.jpg">';
  assert.deepEqual(extractWpImageUrls(html), []);
});

test('rewriteImageSrcs replaces according to map', () => {
  const html = 'Pre <img src="https://taikhoantenhat.com/wp-content/uploads/a.jpg" alt="A"> mid <img src="https://taikhoantenhat.com/wp-content/uploads/b.png" alt="B"> end';
  const map = new Map([
    ['https://taikhoantenhat.com/wp-content/uploads/a.jpg', '/uploads/products-inline/aaa.webp'],
    ['https://taikhoantenhat.com/wp-content/uploads/b.png', '/uploads/products-inline/bbb.webp'],
  ]);
  const out = rewriteImageSrcs(html, map);
  assert.ok(out.includes('src="/uploads/products-inline/aaa.webp"'));
  assert.ok(out.includes('src="/uploads/products-inline/bbb.webp"'));
  assert.ok(!out.includes('taikhoantenhat.com/wp-content'));
});

test('rewriteImageSrcs leaves unmapped URLs alone (drop later or keep)', () => {
  const html = '<img src="https://taikhoantenhat.com/wp-content/uploads/missing.jpg">';
  const out = rewriteImageSrcs(html, new Map());
  assert.equal(out, '<img src="https://taikhoantenhat.com/wp-content/uploads/missing.jpg">');
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
node --test tests/wp-migration/inline-images.test.js 2>&1 | tail -10
```
Expected: import errors.

- [ ] **Step 3: Implement the pure helpers in `scripts/wp-migration/inline-images.js`**

Write the top of the file (function `migrateInlineImages` comes in Task 4):

```js
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const WP_HOST_RE = /https:\/\/taikhoantenhat\.com\/wp-content\/uploads\/[^\s"'<>)]+/g;

function extractWpImageUrls(html) {
  if (!html) return [];
  const matches = String(html).match(WP_HOST_RE) || [];
  return Array.from(new Set(matches));
}

function rewriteImageSrcs(html, urlMap) {
  if (!html) return '';
  return String(html).replace(/src=("|')(https:\/\/taikhoantenhat\.com\/wp-content\/uploads\/[^"']+)\1/g,
    (full, q, url) => {
      const replacement = urlMap.get(url);
      return replacement ? `src=${q}${replacement}${q}` : full;
    });
}

module.exports = { extractWpImageUrls, rewriteImageSrcs };
```

- [ ] **Step 4: Run tests and confirm pass**

```bash
node --test tests/wp-migration/inline-images.test.js 2>&1 | tail -10
```
Expected: `pass 5 / fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/wp-migration/inline-images.js tests/wp-migration/inline-images.test.js
git commit -m "feat(wp-migration): extractWpImageUrls + rewriteImageSrcs helpers"
```

---

## Task 4: Inline-image migration orchestrator

**Files:**
- Modify: `scripts/wp-migration/inline-images.js`
- Modify: `scripts/wp-migration/config.js` (one new path)
- Modify: `scripts/migrate-wp.js` (CLI flag)

- [ ] **Step 1: Add output dir to config**

Edit `scripts/wp-migration/config.js`. Add one new entry to the export:

```js
  PRODUCT_INLINE_IMAGES_OUT: path.resolve(__dirname, '../../data/uploads/products-inline'),
```

Place it immediately after the `PRODUCT_IMAGES_OUT` line.

- [ ] **Step 2: Add the orchestrator to `scripts/wp-migration/inline-images.js`**

Append (do not remove the existing helpers from Task 3):

```js
const cfg = require('./config');
const { stripWpShortcodes } = require('../../src/utils/wpShortcodes');

// Resolve a WP CDN-style URL to a local backup file path. Returns null
// if not present in the local mirror — we never network-fetch.
function resolveLocalBackup(wpUrl) {
  // URLs look like https://taikhoantenhat.com/wp-content/uploads/2024/10/file.jpg
  const m = wpUrl.match(/\/wp-content\/uploads\/(.+)$/);
  if (!m) return null;
  const rel = decodeURIComponent(m[1]);
  const full = path.join(cfg.WP_UPLOADS_ROOT, rel);
  return fs.existsSync(full) ? full : null;
}

async function processSourceFile(srcPath, outDir) {
  const buf = fs.readFileSync(srcPath);
  const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
  fs.mkdirSync(outDir, { recursive: true });

  const targets = [
    { fmt: 'webp', file: path.join(outDir, `${hash}-original.webp`), width: 800, quality: 80 },
    { fmt: 'avif', file: path.join(outDir, `${hash}-original.avif`), width: 800, quality: 60 },
    { fmt: 'webp', file: path.join(outDir, `${hash}-thumb.webp`),    width: 400, quality: 80 },
    { fmt: 'avif', file: path.join(outDir, `${hash}-thumb.avif`),    width: 400, quality: 60 },
  ];

  for (const t of targets) {
    if (fs.existsSync(t.file)) continue;
    const pipeline = sharp(buf).resize({ width: t.width, withoutEnlargement: true });
    if (t.fmt === 'avif') pipeline.avif({ quality: t.quality });
    else pipeline.webp({ quality: t.quality });
    await pipeline.toFile(t.file);
  }

  return `/uploads/products-inline/${hash}-original.webp`;
}

/**
 * Walks every product row, downloads + transforms inline images, rewrites
 * description / long_description in place. Idempotent — re-runs skip
 * already-processed URLs because the hash filename is deterministic.
 *
 * Returns { rowsUpdated, urlsTotal, urlsFetched, urlsMissing }.
 */
async function migrateInlineImages(db) {
  const outDir = cfg.PRODUCT_INLINE_IMAGES_OUT;
  const rows = db.prepare('SELECT id, description, long_description FROM products').all();

  // Pre-process: strip shortcodes so URL extraction sees clean <img> tags.
  const stripped = rows.map(r => ({
    id: r.id,
    description: stripWpShortcodes(r.description || ''),
    long_description: stripWpShortcodes(r.long_description || ''),
  }));

  // Gather every unique URL across the entire catalog
  const allUrls = new Set();
  for (const r of stripped) {
    for (const u of extractWpImageUrls(r.description)) allUrls.add(u);
    for (const u of extractWpImageUrls(r.long_description)) allUrls.add(u);
  }

  console.log(`  → ${allUrls.size} unique WP image URLs across ${rows.length} products`);

  const urlMap = new Map();
  let urlsFetched = 0;
  let urlsMissing = 0;
  for (const url of allUrls) {
    const localSrc = resolveLocalBackup(url);
    if (!localSrc) {
      urlsMissing++;
      console.warn(`  ! missing in backup: ${url}`);
      continue;
    }
    try {
      const finalUrl = await processSourceFile(localSrc, outDir);
      urlMap.set(url, finalUrl);
      urlsFetched++;
    } catch (err) {
      urlsMissing++;
      console.error(`  ! processing failed for ${url}: ${err.message}`);
    }
  }

  // Rewrite per-row and persist
  const update = db.prepare('UPDATE products SET description = ?, long_description = ? WHERE id = ?');
  let rowsUpdated = 0;
  for (const r of stripped) {
    const newDesc = rewriteImageSrcs(r.description, urlMap);
    const newLong = rewriteImageSrcs(r.long_description, urlMap);
    update.run(newDesc, newLong, r.id);
    rowsUpdated++;
  }

  return { rowsUpdated, urlsTotal: allUrls.size, urlsFetched, urlsMissing };
}

module.exports = { extractWpImageUrls, rewriteImageSrcs, migrateInlineImages, processSourceFile, resolveLocalBackup };
```

- [ ] **Step 3: Wire into `scripts/migrate-wp.js`**

Open `scripts/migrate-wp.js`. At the top of `main()`, branch on `--inline-images`:

```js
async function main() {
  if (process.argv.includes('--inline-images')) {
    return runInlineImages();
  }
  // ... existing full-migration body unchanged
}

async function runInlineImages() {
  const Database = require('better-sqlite3');
  const path = require('node:path');
  const dbPath = path.resolve(__dirname, '..', 'data', 'shop.db');
  console.log(`Running inline-image migration pass-2 against ${dbPath} …`);
  const db = new Database(dbPath);
  const { migrateInlineImages } = require('./wp-migration/inline-images');
  const summary = await migrateInlineImages(db);
  console.log('Done:', summary);
}
```

Place `runInlineImages` next to `main()` (just below). Keep the existing `main().catch(...)` invocation untouched.

- [ ] **Step 4: Smoke-run against current DB**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
# Backup first
cp data/shop.db data/shop.db.bak-$(date +%s)
# Run pass-2
source ~/.nvm/nvm.sh && nvm use 20 && node scripts/migrate-wp.js --inline-images 2>&1 | tail -30
```
Expected (approximate):
- `→ N unique WP image URLs across 41 products`
- `Done: { rowsUpdated: 41, urlsTotal: N, urlsFetched: M, urlsMissing: K }`
- If `urlsMissing` > 0, log the URLs to inspect. They'll remain unrewritten in DB and render as broken images in the next frontend task; the user must export missing images from WP-admin if they care about them.

Then verify on disk:

```bash
ls data/uploads/products-inline | head
sqlite3 data/shop.db "SELECT COUNT(*) FROM products WHERE description LIKE '%taikhoantenhat.com%' OR long_description LIKE '%taikhoantenhat.com%'"
```
Expected: `0` (or only the count of `urlsMissing`).

- [ ] **Step 5: Commit**

```bash
git add scripts/wp-migration/config.js scripts/wp-migration/inline-images.js scripts/migrate-wp.js
git commit -m "feat(wp-migration): pass-2 inline image migration with sharp pipeline"
```

(Do not commit `data/shop.db` or `data/shop.db.bak-*` — they're already in `.gitignore` via the `data/` rule. Sanity check: `git status` should show nothing under `data/`.)

---

## Task 5: Read-time sanitisation in productService

**Files:**
- Modify: `src/services/productService.js`
- Modify: `src/api/routes/public.js`
- Test: `tests/api/products-sanitize.test.js` (create)

The current public route reads `p.description || ''` and `p.long_description || ''` directly. Route this through `sanitizeDescription` so legacy rows still get scrubbed.

- [ ] **Step 1: Inspect current `src/services/productService.js`**

```bash
grep -nE "exports|module.exports|function" src/services/productService.js | head -20
```

This is to understand the existing export shape before extending it. We will add a helper that the public route uses.

- [ ] **Step 2: Add the sanitised reader**

Append to `src/services/productService.js`:

```js
const { sanitizeDescription } = require('../utils/richHtml');

// Apply description sanitisation on the API boundary. Legacy WP-imported rows
// still hold raw HTML; new admin writes are already sanitised, so this is a
// no-op for those. Returns the same shape with description/longDescription
// scrubbed.
function sanitizeProductForClient(row) {
  return {
    ...row,
    description: sanitizeDescription(row.description),
    longDescription: sanitizeDescription(row.longDescription),
  };
}

module.exports.sanitizeProductForClient = sanitizeProductForClient;
```

(If `productService.js` uses a single object `module.exports = { ... }` form, add the function as a property inside that object instead. Don't introduce a duplicate `module.exports`.)

- [ ] **Step 3: Use it from the public route**

Open `src/api/routes/public.js`. Find the product-detail handler (`router.get('/products/:slug', …)` — line ~102 per earlier grep). Replace the response shaping for `description` and `longDescription` so it goes through the new helper.

The current pattern looks like:
```js
res.json({ success: true, data: {
  // ...
  description: p.description || '',
  longDescription: p.long_description || '',
}});
```

Change to:
```js
const { sanitizeProductForClient } = require('../../services/productService');
// ... inside the handler:
const shaped = {
  // ... existing fields (id, name, slug, etc.)
  description: p.description || '',
  longDescription: p.long_description || '',
};
res.json({ success: true, data: sanitizeProductForClient(shaped) });
```

Add the `require` once at the top of the file alongside the other route-level requires.

Do the same for the list endpoint (`GET /products`) — if it returns `description` in summaries, route it through the same helper (`sanitizeProductForClient`).

- [ ] **Step 4: Test the boundary**

Create `tests/api/products-sanitize.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeProductForClient } = require('../../src/services/productService');

test('sanitizeProductForClient strips script and keeps p/h3', () => {
  const out = sanitizeProductForClient({
    id: '1', name: 'X',
    description: '<p>Ok</p><script>alert(1)</script>',
    longDescription: '<h3>Heading</h3><img src="/uploads/x.webp">',
  });
  assert.equal(out.description, '<p>Ok</p>');
  assert.ok(out.longDescription.includes('<h3>'));
  assert.ok(out.longDescription.includes('src="/uploads/x.webp"'));
});

test('sanitizeProductForClient preserves non-text fields', () => {
  const out = sanitizeProductForClient({ id: '7', name: 'A', price: 100, description: '<p>d</p>', longDescription: '' });
  assert.equal(out.id, '7');
  assert.equal(out.name, 'A');
  assert.equal(out.price, 100);
});
```

Run:
```bash
node --test tests/api/products-sanitize.test.js 2>&1 | tail -10
```
Expected: `pass 2 / fail 0`.

- [ ] **Step 5: End-to-end check**

The dev stack is running (`npm run dev:all`). Restart only the api process so the new code loads:

```bash
# Find and kill the watch-mode node
pkill -f "node --watch src/index.js"
# Or just touch a file under src/ and let `node --watch` reload — easier:
touch src/index.js
sleep 2
curl -s "http://localhost:3000/api/v1/products/tai-khoan-grammarly-premium-gia-re" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print('desc head:', repr(d['description'][:80])); print('long head:', repr(d['longDescription'][:80]))"
```

Expected: the output starts with `<p>` or `<h3>` (not raw `<p class="p1">` because `class` is not in the description allow-list — sanitize will keep `<p>` but drop the `class` attribute). No `<script>`, no stray `[caption ...]` (those were already stripped at migration time in Task 4).

- [ ] **Step 6: Commit**

```bash
git add src/services/productService.js src/api/routes/public.js tests/api/products-sanitize.test.js
git commit -m "feat(api): sanitize product description on read for legacy WP rows"
```

---

## Task 6: Admin writes use the richer profile

**Files:**
- Modify: `src/api/routes/admin/products.js`

Admin POST/PUT/PATCH calls currently run `sanitizeRich` on description/long_description (`src/api/routes/admin/products.js:134,137,188,194`). Because `sanitizeRich` has the Telegram-narrow allow-list, even an admin who pastes proper HTML (`<p>...</p>`) gets it stripped on save. Swap to `sanitizeDescription` for the description fields. Keep `sanitizeRich` for `usageInstructions` — that field flows to Telegram messages where the narrow profile is correct.

- [ ] **Step 1: Update the import + calls**

Open `src/api/routes/admin/products.js`. Find the line:
```js
const { sanitizeRich } = require('../../../utils/richHtml');
```

Change to:
```js
const { sanitizeRich, sanitizeDescription } = require('../../../utils/richHtml');
```

Then change each `sanitizeRich` call **on description/long_description** to `sanitizeDescription`. Specifically:

- Line ~134 (POST handler insert): `d.description ? sanitizeRich(d.description) : null,` → `d.description ? sanitizeDescription(d.description) : null,`
- Line ~137: `d.longDescription ? sanitizeRich(d.longDescription) : null,` → `d.longDescription ? sanitizeDescription(d.longDescription) : null,`
- Line ~188 (PATCH/PUT description branch): same swap.
- Line ~194 (PATCH/PUT longDescription branch): same swap.

Leave line ~139 / ~195 (usage_instructions) calling `sanitizeRich` — that field is reused for Telegram messages.

- [ ] **Step 2: Manual smoke**

Restart api (`touch src/index.js`). Then in the admin UI (or via curl with a JWT) PUT a product with `description: "<p>Test</p><h3>Hello</h3>"`. Re-fetch via `GET /products/:slug` and confirm both `<p>` and `<h3>` survive.

- [ ] **Step 3: Commit**

```bash
git add src/api/routes/admin/products.js
git commit -m "feat(admin-products): use sanitizeDescription for description fields"
```

---

## Task 7: Mini-app renders HTML

**Files:**
- Modify: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Replace plain text with HTML render**

Open `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`. Find the description block:

```tsx
      {p.description && (
        <p className="mb-3 whitespace-pre-line text-[0.9375rem] leading-relaxed">{p.description}</p>
      )}
```

Replace with:

```tsx
      {p.description && (
        <div
          className="rich-text mb-3 text-[0.9375rem]"
          dangerouslySetInnerHTML={{ __html: p.description }}
        />
      )}
```

Find the long-description `<details>` block:

```tsx
          <div className="mt-2 whitespace-pre-line text-sm opacity-90">{p.longDescription}</div>
```

Replace with:

```tsx
          <div
            className="rich-text mt-2 text-sm opacity-90"
            dangerouslySetInnerHTML={{ __html: p.longDescription }}
          />
```

The `rich-text` class already exists in `globals.css`; the next step extends it with rules tuned for the miniapp.

- [ ] **Step 2: Extend `.rich-text` in `globals.css`**

Inside the existing `@layer components { ... }` block, locate the current `.rich-text` rule (around line 183). Replace it (and append heading + image rules) with:

```css
  .rich-text { white-space: normal; line-height: 1.55; }
  .rich-text p { margin-block: .5rem; }
  .rich-text p:first-child { margin-top: 0; }
  .rich-text p:last-child { margin-bottom: 0; }
  .rich-text h2 { font-size: 1.125rem; font-weight: 600; margin: 1rem 0 .5rem; line-height: 1.3; }
  .rich-text h3 { font-size: 1rem; font-weight: 600; margin: .875rem 0 .375rem; line-height: 1.3; }
  .rich-text h4 { font-size: .9375rem; font-weight: 600; margin: .75rem 0 .25rem; }
  .rich-text ul, .rich-text ol { padding-left: 1.25rem; margin-block: .5rem; }
  .rich-text li { margin-block: .125rem; }
  .rich-text a { text-decoration: underline; color: var(--brand-gold-deep, var(--color-clay-ink)); }
  .rich-text code { background: var(--color-clay-oat-light); padding: 0 .25rem; border-radius: 4px; font-family: var(--font-mono); font-size: .9em; }
  .rich-text pre { background: var(--color-clay-oat-light); padding: .75rem; border-radius: 8px; font-family: var(--font-mono); font-size: .85em; overflow-x: auto; }
  .rich-text img { display: block; max-width: 100%; height: auto; border-radius: 12px; margin: .75rem 0; }
  .rich-text tg-spoiler { background: var(--color-clay-charcoal); color: var(--color-clay-charcoal); border-radius: 4px; cursor: pointer; transition: color .2s; }
  .rich-text tg-spoiler:hover, .rich-text tg-spoiler.revealed { color: #fff; }
```

(Keep the existing `tg-spoiler` rules — they're already there; if duplicated after edit, dedupe by keeping just the new combined block above.)

- [ ] **Step 3: Visual check**

Reload http://localhost:3001/san-pham/tai-khoan-grammarly-premium-gia-re. The description should now show:
- Heading "Giới thiệu gói tài khoản ChatGPT Plus" rendered as h3
- Paragraphs with proper spacing
- Inline image (the GPT-4 chart from the screenshot) at `/uploads/products-inline/<hash>-original.webp`, max-width 100%, rounded
- No literal `<p>`, `<b>`, `[caption ...]` tags visible

If an image 404s, it's because Task 4's `urlsMissing` left it unrewritten. The frontend will show a broken image — acceptable; admin can re-upload via the future Sub-project G UI.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/\(miniapp\)/san-pham/\[slug\]/page.tsx web/src/app/globals.css
git commit -m "feat(miniapp): render product description as sanitized HTML"
```

---

## Task 8: Verify + tag

- [ ] **Step 1: Backend tests green**

```bash
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/utils/ tests/wp-migration/ tests/api/ 2>&1 | tail -15
```
Expected: every test in those dirs passes. If anything fails that was passing before this branch, fix.

- [ ] **Step 2: Frontend tsc + build**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -5
cd web && npm run build 2>&1 | tail -15
```
Expected: clean / `Compiled successfully`.

- [ ] **Step 3: Audit no `taikhoantenhat.com/wp-content` strings remain in product copy**

```bash
sqlite3 data/shop.db "SELECT id, name FROM products WHERE description LIKE '%taikhoantenhat.com/wp-content%' OR long_description LIKE '%taikhoantenhat.com/wp-content%'"
```
Expected: empty (or only the products whose images were `urlsMissing`).

- [ ] **Step 4: Tag**

```bash
git tag v0.5-content-render -m "Sub-project F: HTML description render + WP image pass-2"
```

- [ ] **Step 5: Done**

Report:
- Tests: backend + frontend green
- Migration ran: <N> products updated, <M> URLs fetched, <K> missing
- Branch ready to merge

---

## Self-Review Checklist

- [x] Spec coverage:
  - F1 sanitiser profile → Task 1
  - F2 shortcode stripper → Task 2
  - F3 inline image migration → Tasks 3, 4
  - F4 sanitise on API boundary → Task 5
  - F5 admin write path uses rich profile → Task 6
  - F6 mini-app HTML render → Task 7
  - F7 `.rich-text` CSS rules → Task 7 step 2
  - F8 verification → Task 8
- [x] No placeholders — every step has full code or exact commands.
- [x] Type consistency — `sanitizeDescription`, `sanitizeProductForClient`, `migrateInlineImages`, `stripWpShortcodes`, `extractWpImageUrls`, `rewriteImageSrcs`, `processSourceFile`, `resolveLocalBackup` all defined where first used and referenced consistently.
- [x] Safety — pass-2 is read-only on the WP backup, write-only on `data/shop.db`. Backup snapshot in Task 4 step 4.
- [x] Reversibility — `data/shop.db.bak-<ts>` lets the engineer roll back. Hashed filenames are deterministic so re-running pass-2 is safe.
