# Sub-project I: Description Tables + "Thông tin sản phẩm" Section

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let product descriptions render real HTML tables, normalize legacy malformed table markup, and replace the collapsing "Chi tiết sản phẩm" toggle with an always-shown "Thông tin sản phẩm" section that has no padding wrapper.

**Architecture:** Three independent pieces stacked behind one outcome — sanitizer allow-list extended for table tags (so the API stops stripping them), a pure-JS normalizer that fixes the common WP malformations (orphan `<tr>` outside a `<table>`), and a frontend change that drops the `<details>` wrapper. A migration pass-3 walks every product row once to apply the normalizer in-place so existing rows benefit without admin re-editing.

**Tech Stack:** `sanitize-html` (already a dep), `better-sqlite3`, Next 16 + Tailwind v4, `node --test`.

---

## Notes for the Engineer

- **Read `web/AGENTS.md` before frontend work.** Next 16 has breaking changes from training data.
- **Tests use `node --test`** under Node 20. Run via `source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/...`.
- **`sanitizeDescription` profile** lives in `src/utils/richHtml.js` (added in sub-project F). It currently allows `p, h2-4, ul, ol, li, img, a, code, pre, blockquote, b, strong, i, em, u, s, span[class], div[class]`. We extend it here.
- **`.rich-text` CSS class** lives in `web/src/app/globals.css` inside the `@layer components { ... }` block. Was extended in sub-project F. Extend further here.
- **`data/shop.db`** is the live DB. Snapshot before pass-3: `cp data/shop.db data/shop.db.bak-$(date +%s)`.
- **No new npm deps.** The normalizer uses regex/string ops only. The legacy WP rows in this DB don't contain truly malformed HTML — every `<tr>` is already inside a `<table>` (verified by `SELECT … WHERE long_description LIKE '%<tr%' AND long_description NOT LIKE '%<table%'` returns 0 rows). The normalizer is therefore a low-risk safety net that mostly trims whitespace and strips empty `<p>` siblings polluting cell layouts.
- **Render path** is `dangerouslySetInnerHTML` (set up in sub-project F). HTML is sanitized at the API read boundary before reaching the client, so frontend doesn't need to re-sanitize.

---

## File Structure

- `src/utils/richHtml.js` — **MODIFY**. Extend `DESCRIPTION_TAGS` + `DESCRIPTION_ATTR` with table tags. Existing `sanitizeRich` stays narrow (Telegram path).
- `tests/utils/richHtml-tables.test.js` — **CREATE**. Locks down what survives sanitization (table family) and what doesn't (style/onclick).
- `src/utils/normalizeTables.js` — **CREATE**. Pure function `normalizeTables(html)` that wraps orphan `<tr>` runs in a `<table><tbody>…</tbody></table>` and collapses empty `<p>` siblings between table rows.
- `tests/utils/normalizeTables.test.js` — **CREATE**.
- `scripts/wp-migration/normalize-tables.js` — **CREATE**. Migration pass-3 helper: walks every product row, applies `normalizeTables` to both description fields, persists.
- `scripts/migrate-wp.js` — **MODIFY**. Add a `--normalize-tables` CLI branch (same shape as `--inline-images`).
- `web/src/app/globals.css` — **MODIFY**. Add `.rich-text table/th/td/caption` CSS inside the existing `.rich-text` block.
- `web/src/app/(miniapp)/san-pham/[slug]/page.tsx` — **MODIFY**. Replace the `<details>` toggle block (lines 96-103) with an always-shown section titled "Thông tin sản phẩm" with zero padding wrapper.
- `web/src/i18n/vi.ts` — **MODIFY** (if a relevant `t.product.*` key exists). Add `t.product.infoSection = 'Thông tin sản phẩm'`. If the i18n file doesn't carry product strings, hard-code the string in the page (matches existing pattern for "Chi tiết sản phẩm").

---

## Task 1: Extend sanitizer allow-list with table tags

**Files:**
- Modify: `src/utils/richHtml.js`
- Create: `tests/utils/richHtml-tables.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/utils/richHtml-tables.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { sanitizeDescription } = require('../../src/utils/richHtml');

test('preserves a complete table', () => {
  const html = '<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('<table>'));
  assert.ok(out.includes('<thead>'));
  assert.ok(out.includes('<th>A</th>'));
  assert.ok(out.includes('<tbody>'));
  assert.ok(out.includes('<td>1</td>'));
});

test('keeps colspan/rowspan/scope/align attributes', () => {
  const html = '<table><tr><th scope="col" align="left">H</th></tr><tr><td colspan="2" rowspan="3">x</td></tr></table>';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('scope="col"'));
  assert.ok(out.includes('align="left"'));
  assert.ok(out.includes('colspan="2"'));
  assert.ok(out.includes('rowspan="3"'));
});

test('drops style + onclick on td', () => {
  const html = '<table><tr><td style="color:red" onclick="alert(1)">x</td></tr></table>';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('<td>x</td>'));
  assert.ok(!out.includes('style='));
  assert.ok(!out.includes('onclick='));
});

test('keeps caption + colgroup + col', () => {
  const html = '<table><caption>Pricing</caption><colgroup><col><col></colgroup><tr><td>a</td><td>b</td></tr></table>';
  const out = sanitizeDescription(html);
  assert.ok(out.includes('<caption>Pricing</caption>'));
  assert.ok(out.includes('<colgroup>'));
});
```

Run:
```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/utils/richHtml-tables.test.js 2>&1 | tail -10
```
Expected: 4 fail — table tags are stripped because the allow-list doesn't include them yet.

- [ ] **Step 2: Extend `src/utils/richHtml.js`**

Open the file. Find the `DESCRIPTION_TAGS` array (added in sub-project F). It currently looks like:

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
```

Append the table family entries:

```js
const DESCRIPTION_TAGS = [
  'p', 'br', 'span', 'div',
  'h2', 'h3', 'h4',
  'b', 'strong', 'i', 'em', 'u', 's',
  'a',
  'ul', 'ol', 'li',
  'code', 'pre', 'blockquote',
  'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
];
```

Find `DESCRIPTION_ATTR` (looks like `{ a: [...], img: [...], span: [...], div: [...] }`). Add the per-tag attribute allow-list:

```js
const DESCRIPTION_ATTR = {
  a: ['href', 'title', 'rel'],
  img: ['src', 'alt', 'width', 'height', 'loading'],
  span: ['class'],
  div: ['class'],
  th: ['colspan', 'rowspan', 'scope', 'align'],
  td: ['colspan', 'rowspan', 'align'],
  col: ['span', 'align'],
  table: ['align'],
};
```

(Don't replace the whole `DESCRIPTION_ATTR` object — extend it. If the existing object literal is multi-line, add the four new lines before the closing `}`.)

- [ ] **Step 3: Run tests, expect pass**

```bash
node --test tests/utils/richHtml-tables.test.js 2>&1 | tail -10
```
Expected: 4/4 pass.

- [ ] **Step 4: Existing description tests still pass**

```bash
node --test tests/utils/richHtml-description.test.js 2>&1 | tail -10
```
Expected: 6/6 pass (no regression).

- [ ] **Step 5: Commit**

```bash
git add src/utils/richHtml.js tests/utils/richHtml-tables.test.js
git commit -m "feat(richHtml): allow table/thead/tbody/tr/th/td/caption/colgroup/col"
```

---

## Task 2: `normalizeTables` util

**Files:**
- Create: `src/utils/normalizeTables.js`
- Create: `tests/utils/normalizeTables.test.js`

This util fixes the two malformations seen in real WP exports:
1. A run of `<tr>...</tr>` not enclosed in a `<table>` (rare in our data, but defensive).
2. Empty `<p></p>` or whitespace `<p> </p>` tags interleaved between rows by WP's `wpautop` filter — these break `.rich-text table` layout.

- [ ] **Step 1: Write failing tests**

```js
const test = require('node:test');
const assert = require('node:assert');
const { normalizeTables } = require('../../src/utils/normalizeTables');

test('passthrough — fully-formed table unchanged', () => {
  const html = '<table><tr><td>a</td></tr></table>';
  assert.equal(normalizeTables(html), html);
});

test('wraps orphan <tr> run in <table><tbody>', () => {
  const html = 'Before <tr><td>1</td></tr><tr><td>2</td></tr> after';
  const out = normalizeTables(html);
  assert.ok(out.includes('<table><tbody><tr><td>1</td></tr><tr><td>2</td></tr></tbody></table>'));
  assert.ok(!out.match(/<tr>(?![\s\S]*<\/?table)/));
});

test('does not double-wrap when already in table', () => {
  const html = '<table><tbody><tr><td>x</td></tr></tbody></table>';
  assert.equal(normalizeTables(html), html);
});

test('strips empty <p></p> between rows in a table', () => {
  const html = '<table><tr><td>1</td></tr><p></p><tr><td>2</td></tr></table>';
  const out = normalizeTables(html);
  assert.ok(!out.includes('<p></p>'));
  assert.ok(out.includes('<tr><td>1</td></tr><tr><td>2</td></tr>'));
});

test('strips whitespace-only <p> </p> between rows', () => {
  const html = '<table><tr><td>1</td></tr><p>   </p><tr><td>2</td></tr></table>';
  const out = normalizeTables(html);
  assert.ok(!out.match(/<p>\s*<\/p>/));
});

test('null/empty input', () => {
  assert.equal(normalizeTables(null), '');
  assert.equal(normalizeTables(''), '');
  assert.equal(normalizeTables(undefined), '');
});
```

Run:
```bash
node --test tests/utils/normalizeTables.test.js 2>&1 | tail -10
```
Expected: import error.

- [ ] **Step 2: Implement `src/utils/normalizeTables.js`**

```js
// Two passes. Order matters: strip empty <p> siblings inside tables FIRST so
// the orphan-<tr> detector doesn't accidentally swallow them; then wrap any
// remaining orphan <tr> runs.

function stripEmptyPInTables(html) {
  // Remove <p></p> or <p>  </p> appearing between </tr> and <tr> (where wpautop
  // typically injects them). Scoped to inside a <table>...</table> region.
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, (table) =>
    table.replace(/<p>\s*<\/p>/gi, '')
  );
}

function wrapOrphanTrRuns(html) {
  // A "table region" is anything inside <table>...</table>. We need to find
  // <tr> sequences OUTSIDE such regions. The simplest correct strategy: walk
  // the string, mask out existing <table> regions, then wrap remaining <tr>
  // runs. We use placeholders to avoid the masked text being touched by the
  // wrap-replace regex.
  const tables = [];
  const masked = html.replace(/<table\b[\s\S]*?<\/table>/gi, (m) => {
    tables.push(m);
    return ` T${tables.length - 1} `;
  });

  // Now any <tr>...</tr> still in `masked` is an orphan run.
  // Group consecutive <tr>...</tr> blocks (whitespace allowed between).
  const wrapped = masked.replace(/(?:<tr\b[\s\S]*?<\/tr>\s*)+/gi, (run) =>
    `<table><tbody>${run.trim()}</tbody></table>`
  );

  return wrapped.replace(/ T(\d+) /g, (_, i) => tables[Number(i)]);
}

function normalizeTables(html) {
  if (html == null || html === '') return '';
  let out = String(html);
  out = stripEmptyPInTables(out);
  out = wrapOrphanTrRuns(out);
  return out;
}

module.exports = { normalizeTables };
```

- [ ] **Step 3: Run tests**

```bash
node --test tests/utils/normalizeTables.test.js 2>&1 | tail -10
```
Expected: 6/6 pass.

- [ ] **Step 4: Commit**

```bash
git add src/utils/normalizeTables.js tests/utils/normalizeTables.test.js
git commit -m "feat(utils): normalizeTables — strip empty p, wrap orphan tr runs"
```

---

## Task 3: Migration pass-3

**Files:**
- Create: `scripts/wp-migration/normalize-tables.js`
- Modify: `scripts/migrate-wp.js` (add `--normalize-tables` CLI branch)

- [ ] **Step 1: Create `scripts/wp-migration/normalize-tables.js`**

```js
const { normalizeTables } = require('../../src/utils/normalizeTables');

/**
 * Walks every product row, applies normalizeTables() to description and
 * long_description, persists. Idempotent — running twice produces the same
 * output (normalizeTables itself is idempotent on well-formed input).
 *
 * Returns { rowsScanned, rowsChanged }.
 */
function migrateNormalizeTables(db) {
  const rows = db.prepare('SELECT id, description, long_description FROM products').all();
  const update = db.prepare('UPDATE products SET description = ?, long_description = ? WHERE id = ?');

  let rowsChanged = 0;
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const newDesc = normalizeTables(r.description || '');
      const newLong = normalizeTables(r.long_description || '');
      if (newDesc !== (r.description || '') || newLong !== (r.long_description || '')) {
        update.run(newDesc, newLong, r.id);
        rowsChanged++;
      }
    }
  });
  tx(rows);

  return { rowsScanned: rows.length, rowsChanged };
}

module.exports = { migrateNormalizeTables };
```

- [ ] **Step 2: Wire CLI flag**

Open `scripts/migrate-wp.js`. The `--inline-images` branch already exists (added in sub-project F). Add a parallel branch.

In `main()`, immediately after the existing `if (process.argv.includes('--inline-images'))` block:

```js
  if (process.argv.includes('--normalize-tables')) {
    return runNormalizeTables();
  }
```

Add this helper next to `runInlineImages()`:

```js
async function runNormalizeTables() {
  const Database = require('better-sqlite3');
  const path = require('node:path');
  const dbPath = path.resolve(__dirname, '..', 'data', 'shop.db');
  console.log(`Running normalize-tables pass-3 against ${dbPath} …`);
  const db = new Database(dbPath);
  const { migrateNormalizeTables } = require('./wp-migration/normalize-tables');
  const summary = migrateNormalizeTables(db);
  console.log('Done:', summary);
}
```

- [ ] **Step 3: Smoke run**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
cp data/shop.db data/shop.db.bak-$(date +%s)
source ~/.nvm/nvm.sh && nvm use 20 && node scripts/migrate-wp.js --normalize-tables 2>&1 | tail -10
```

Expected: `Done: { rowsScanned: 41, rowsChanged: N }` where N is between 0 and 26 (count of table-bearing rows). Re-running the same command immediately should print `rowsChanged: 0` — proving idempotency.

```bash
# Idempotency check
node scripts/migrate-wp.js --normalize-tables 2>&1 | tail -5
```
Expected: `rowsChanged: 0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/wp-migration/normalize-tables.js scripts/migrate-wp.js
git commit -m "feat(wp-migration): pass-3 normalize-tables CLI"
```

---

## Task 4: CSS for tables in `.rich-text`

**Files:**
- Modify: `web/src/app/globals.css`

- [ ] **Step 1: Locate the `.rich-text img` rule**

It was added in sub-project F. Append the table block immediately after it (inside the same `@layer components { ... }` scope):

```css
  .rich-text table { width: 100%; border-collapse: collapse; margin: .75rem 0; font-size: .875rem; }
  .rich-text caption { font-size: .8125rem; color: var(--color-clay-charcoal, #55534e); margin-bottom: .25rem; text-align: left; }
  .rich-text th, .rich-text td { border: 1px solid color-mix(in srgb, var(--brand-ink, #000) 12%, transparent); padding: .5rem .625rem; text-align: left; vertical-align: top; }
  .rich-text th { background: var(--brand-gold-soft, #fff1b8); font-weight: 600; }
  .rich-text tbody tr:nth-child(even) td { background: color-mix(in srgb, var(--brand-gold-soft, #fff1b8) 18%, transparent); }
  .rich-text table img { margin: 0; }
```

- [ ] **Step 2: Visual check**

Dev stack running (`lsof -i :3001 -P -n | grep LISTEN`). Load any product whose description contains a table — try the Grammarly slug or another:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/san-pham/tai-khoan-grammarly-premium-gia-re
```
Expected: 200. Manually open in browser: tables should now show borders, header row gold-soft, alternating row tint.

- [ ] **Step 3: Commit**

```bash
git add web/src/app/globals.css
git commit -m "feat(miniapp): .rich-text table styles (Clay borders + gold-soft header)"
```

---

## Task 5: Replace `<details>` with always-shown "Thông tin sản phẩm" section

**Files:**
- Modify: `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`

- [ ] **Step 1: Patch the block**

Open `web/src/app/(miniapp)/san-pham/[slug]/page.tsx`. Find the `<details>` block (lines 96-103 in current state):

```tsx
          {p.longDescription && (
            <details className="mb-4 rounded-xl p-3" style={{ background: 'var(--tg-bg-2)' }}>
              <summary className="cursor-pointer font-medium text-sm">Chi tiết sản phẩm</summary>
              <div
                className="rich-text mt-2 text-sm opacity-90"
                dangerouslySetInnerHTML={{ __html: p.longDescription }}
              />
            </details>
          )}
```

Replace with:

```tsx
          {p.longDescription && (
            <section className="mb-4">
              <h2 className="font-medium text-sm mb-2">Thông tin sản phẩm</h2>
              <div
                className="rich-text text-sm opacity-90"
                dangerouslySetInnerHTML={{ __html: p.longDescription }}
              />
            </section>
          )}
```

Key changes:
- `<details>`/`<summary>` removed → always shown
- No `rounded-xl p-3` background wrapper (padding 0)
- Title text changed from "Chi tiết sản phẩm" to "Thông tin sản phẩm", rendered as `<h2>`
- `mt-2` on inner div removed (no gap juggling since wrapper is gone)

- [ ] **Step 2: Verify**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/san-pham/tai-khoan-grammarly-premium-gia-re
```
Expected: tsc clean, curl 200.

Reload the page in browser — section renders flat (no card background), title is "Thông tin sản phẩm" in normal weight, content shows immediately without click.

- [ ] **Step 3: Commit**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/app/\(miniapp\)/san-pham/\[slug\]/page.tsx
git commit -m "feat(miniapp): auto-show 'Thông tin sản phẩm' section (no toggle, no padding)"
```

---

## Task 6: Verify + tag

- [ ] **Step 1: Full backend suite**

```bash
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/ 2>&1 | tail -10
```
Expected: 0 fail. New test count includes 4 (table sanitize) + 6 (normalize) = +10 vs the H baseline of 68 → expect ~78 tests.

- [ ] **Step 2: Frontend tsc + build**

```bash
cd web && npx tsc --noEmit 2>&1 | tail -3
cd web && npm run build 2>&1 | tail -10
```
Expected: clean / `Compiled successfully`.

- [ ] **Step 3: Spot-check public API for an unmolested table**

```bash
curl -s "http://localhost:3000/api/v1/products/tai-khoan-grammarly-premium-gia-re" | node -e "let d=''; process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log('has <table>:', j.data.longDescription.includes('<table>'))})"
```
Expected: `has <table>: true` (only if the Grammarly product happens to have a table — pick a different slug from the 26 table-bearing products if not).

If you need a target slug:
```bash
sqlite3 data/shop.db "SELECT slug FROM products WHERE long_description LIKE '%<table%' LIMIT 3"
```

- [ ] **Step 4: Tag**

```bash
git tag v0.7-content-tables -m "Sub-project I: table sanitize + normalize + always-shown info section"
```

- [ ] **Step 5: Done**

Report: test count delta, rowsChanged from migration pass-3, tag created.

---

## Self-Review

- **Spec coverage:**
  - I1 sanitizer allow-list extension → Task 1
  - I2 CSS for tables → Task 4
  - I3 normalizer util → Task 2
  - I4 migration pass-3 → Task 3
  - I5 `<details>` → always-shown "Thông tin sản phẩm" → Task 5
  - I6 padding 0 → Task 5 (replaced `p-3` wrapper with no wrapper)
- **Placeholders:** none — every step has code or exact command + expected output.
- **Type consistency:** `normalizeTables` exported once, consumed by both pass-3 (`migrateNormalizeTables`) and (if future reads ever call it directly) elsewhere. `migrateNormalizeTables` defined in script module, called via the CLI helper.
- **Backwards compat:** Existing rows without tables get no change. The sanitizer change is additive (more tags allowed; nothing removed). The frontend change drops the `<details>` interaction but the underlying content + URL still works identically — bookmarks and SEO not affected.
