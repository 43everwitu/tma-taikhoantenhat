# Taikhoantenhat — WordPress Data Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import products, categories, unsold license keys, and product images from the legacy WordPress + WooCommerce + License Manager for WC (lmfwc) site into the fresh `taikhoantenhat-bot` SQLite database, producing a one-shot, idempotent, replayable migration script with a structured report.

**Architecture:** A standalone Node script `scripts/migrate-wp.js` that reads the legacy MySQL dump as a stream, extracts only the rows we care about (categories, products, postmeta, license keys, attachments), transforms them into the fork's existing schema (`categories`, `products`, `stock`), and copies/optimizes product images into `data/uploads/products/` with sharp. The script is invoked manually after a fresh DB and can be re-run safely (drops imported rows by `wp_post_id` mapping, then re-imports).

**Tech Stack:** Node.js 20+, better-sqlite3, sharp, the existing `slugify` helper from migration 002 (extract to a util), Node's built-in `node:test`, plus a minimal SQL-INSERT regex parser. No `mysql` server required — we never load the dump into MySQL.

---

## Conventions for this plan

- **Source dump:** `/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/taikhoantenhat.com__2026-05-06T15_42_06+0700/taikho35_taikhoan_wp_lmbr8.sql` (33 MB, table prefix `AGJiSNzCU_`).
- **Source uploads:** `/Users/peanut/Users/peanut/Project Local/telegram-shop-bot/taikhoantenhat.com__2026-05-06T15_42_06+0700/files/wp-content/uploads/`.
- **License key plaintext source:** `data/wp-imports/lmfwc-export.csv` — admin must produce this CSV via WP-admin → License Manager → Export (plaintext keys + product_id + status). The plugin encrypts keys at rest in the dump with the WP secret; using the CSV export sidesteps that. The migration script aborts with a clear error if the CSV is missing.
- **Image output:** `data/uploads/products/{product_id}-{slug}-original.avif` + `.webp` and `{product_id}-{slug}-thumb.avif` + `.webp`. Original 800w, thumb 400w. Existing source extension does not matter.
- **Target DB:** `data/db.sqlite`, post-migrations 001–014 (the foundation sub-project produced an empty fresh schema; this sub-project adds rows, not columns).
- All script output is JSON-line structured logs, plus a final human-readable summary.
- All paths in tasks below are relative to the fork repo `/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot/` unless prefixed `[parent]`.
- Commit messages in English imperative mood. User-facing strings (none here, since this is an internal script) would otherwise be Vietnamese.

---

## File map (what gets touched)

### Files created
- `scripts/migrate-wp.js` — top-level orchestrator (CLI entry point)
- `scripts/wp-migration/sql-stream.js` — INSERT-statement streaming parser
- `scripts/wp-migration/extract-categories.js` — pulls product_cat taxonomy rows
- `scripts/wp-migration/extract-products.js` — pulls WooCommerce products + meta
- `scripts/wp-migration/extract-images.js` — resolves `_thumbnail_id` → file path
- `scripts/wp-migration/extract-licenses.js` — reads the plaintext CSV
- `scripts/wp-migration/transform.js` — pure functions converting WP rows to fork rows
- `scripts/wp-migration/load.js` — better-sqlite3 inserts inside a transaction
- `scripts/wp-migration/images.js` — sharp pipeline (AVIF + WebP + thumb)
- `scripts/wp-migration/report.js` — structured report writer
- `src/utils/slugify.js` — extract from migration 002 so the script can reuse it (does not change migration behavior)
- `data/wp-imports/.gitkeep` — pin the directory; CSV goes here at runtime (gitignored)
- `tests/wp-migration/sql-stream.test.js`
- `tests/wp-migration/transform.test.js`
- `tests/wp-migration/images.test.js`

### Files modified
- `src/database/migrations/002_platform.js` — replace inline `slugify` with `require('../../utils/slugify')` (mechanical refactor, behavior-preserving)
- `.gitignore` — add `data/wp-imports/`, `data/uploads/products/`, and `scripts/wp-migration/.cache/`
- `package.json` — add `"migrate:wp": "node scripts/migrate-wp.js"` script and `sharp` dependency (already present in `web/package.json`; we mirror it at root for the script to use directly without `cd web`)

### Files deleted
- (none)

---

## Pre-flight checks for the engineer

Before starting Task 1, verify:

1. Sub-project #1 is complete (tag `v0-fork-foundation` exists). If not, stop and finish #1 first.
2. The WP backup directory exists at `[parent]/taikhoantenhat.com__2026-05-06T15_42_06+0700/`. If not, ask the user where the backup lives and update the path constants in Task 1 before continuing.
3. Admin has produced `data/wp-imports/lmfwc-export.csv`. If not, ask the user to run the License Manager → Export action in WP-admin and place the CSV at that path. If WP-admin is no longer accessible, see Task 9's fallback path.

---

## Task 1: Add config constants + npm script + dependency

**Files:**
- Create: `scripts/wp-migration/config.js`
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add the migration config module**

Write `scripts/wp-migration/config.js`:

```js
const path = require('node:path');

const PARENT_REPO = '/Users/peanut/Users/peanut/Project Local/telegram-shop-bot';
const BACKUP_ROOT = path.join(PARENT_REPO, 'taikhoantenhat.com__2026-05-06T15_42_06+0700');

module.exports = {
  WP_TABLE_PREFIX: 'AGJiSNzCU_',
  WP_SQL_DUMP: path.join(BACKUP_ROOT, 'taikho35_taikhoan_wp_lmbr8.sql'),
  WP_UPLOADS_ROOT: path.join(BACKUP_ROOT, 'files/wp-content/uploads'),
  LMFWC_CSV_PATH: path.resolve(__dirname, '../../data/wp-imports/lmfwc-export.csv'),
  PRODUCT_IMAGES_OUT: path.resolve(__dirname, '../../data/uploads/products'),
  REPORT_PATH: path.resolve(__dirname, '../../data/wp-imports/migration-report.json'),
  IMAGE_VARIANTS: [
    { name: 'original', width: 800, formats: ['avif', 'webp'] },
    { name: 'thumb',    width: 400, formats: ['avif', 'webp'] },
  ],
};
```

A single config module so future moves of the backup directory require one edit.

- [ ] **Step 2: Add the npm script and sharp dependency**

In `package.json`, add to `scripts`:

```json
"migrate:wp": "node scripts/migrate-wp.js"
```

And ensure sharp is a runtime dep (the script needs it without going through `web/`):

```bash
npm install --save sharp
```

Expected: `package.json` `dependencies` now contains `sharp`. Note the install will be slow the first time because sharp downloads platform binaries.

- [ ] **Step 3: Update .gitignore**

Append:

```
data/wp-imports/
data/uploads/products/
scripts/wp-migration/.cache/
```

The `.cache/` entry is reserved for Task 8 (image dedupe by source hash).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json .gitignore scripts/wp-migration/config.js
git commit -m "chore(migrate-wp): add migration config, npm script, sharp dep"
```

---

## Task 2: Extract slugify into a shared util

**Files:**
- Create: `src/utils/slugify.js`
- Modify: `src/database/migrations/002_platform.js`

- [ ] **Step 1: Create the shared util**

Copy the `slugify` function out of migration 002 verbatim into `src/utils/slugify.js`:

```js
function slugify(str) {
  if (str == null) return '';
  const vnMap = {
    'à':'a','á':'a','ả':'a','ã':'a','ạ':'a','ă':'a','ằ':'a','ắ':'a','ẳ':'a','ẵ':'a','ặ':'a',
    'â':'a','ầ':'a','ấ':'a','ẩ':'a','ẫ':'a','ậ':'a','đ':'d','è':'e','é':'e','ẻ':'e','ẽ':'e',
    'ẹ':'e','ê':'e','ề':'e','ế':'e','ể':'e','ễ':'e','ệ':'e','ì':'i','í':'i','ỉ':'i','ĩ':'i',
    'ị':'i','ò':'o','ó':'o','ỏ':'o','õ':'o','ọ':'o','ô':'o','ồ':'o','ố':'o','ổ':'o','ỗ':'o',
    'ộ':'o','ơ':'o','ờ':'o','ớ':'o','ở':'o','ỡ':'o','ợ':'o','ù':'u','ú':'u','ủ':'u','ũ':'u',
    'ụ':'u','ư':'u','ừ':'u','ứ':'u','ử':'u','ữ':'u','ự':'u','ỳ':'y','ý':'y','ỷ':'y','ỹ':'y','ỵ':'y',
  };
  return String(str)
    .toLowerCase()
    .split('')
    .map(c => vnMap[c] || c)
    .join('')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 100);
}

module.exports = { slugify };
```

The added `if (str == null) return ''` is a strict superset of the migration's original behavior — the migration only ever passed non-null strings, so this change is safe and shields the script from null inputs.

- [ ] **Step 2: Replace the inline copy in migration 002**

In `src/database/migrations/002_platform.js`:

```diff
+const { slugify } = require('../../utils/slugify');
+
 function up(db) {
   // ... existing code ...
 }

-function slugify(str) {
-  // ... full body ...
-}
-
 module.exports = { up };
```

- [ ] **Step 3: Verify migration 002 still works on a fresh DB**

```bash
rm -f data/db.sqlite data/db.sqlite-shm data/db.sqlite-wal
( node src/index.js & echo $! > /tmp/api.pid; sleep 3; kill $(cat /tmp/api.pid) ) || true
sqlite3 data/db.sqlite "SELECT slug FROM categories ORDER BY id;"
```

Expected: at least three rows printed with non-empty slugs (the migration seeds three categories).

- [ ] **Step 4: Commit**

```bash
git add src/utils/slugify.js src/database/migrations/002_platform.js
git commit -m "refactor: extract slugify util shared by migration and wp import"
```

---

## Task 3: Streaming SQL INSERT parser

**Files:**
- Create: `scripts/wp-migration/sql-stream.js`
- Create: `tests/wp-migration/sql-stream.test.js`

The dump is 33 MB — small enough for a `readFileSync`, but we still stream it to keep memory steady and to ignore tables we don't care about without buffering them. The parser yields `{ table, columns, rows }` for each `INSERT INTO` statement of a table we asked for.

- [ ] **Step 1: Write the failing test first**

Create `tests/wp-migration/sql-stream.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');
const { streamInserts } = require('../../scripts/wp-migration/sql-stream');

function fromString(s) {
  return Readable.from(Buffer.from(s, 'utf8'));
}

test('extracts a single-line INSERT', async () => {
  const sql = "INSERT INTO `AGJiSNzCU_terms` (`term_id`, `name`, `slug`, `term_group`) VALUES (1, 'Cat A', 'cat-a', 0), (2, 'Cat B', 'cat-b', 0);\n";
  const out = [];
  for await (const stmt of streamInserts(fromString(sql), new Set(['AGJiSNzCU_terms']))) {
    out.push(stmt);
  }
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].table, 'AGJiSNzCU_terms');
  assert.deepStrictEqual(out[0].columns, ['term_id', 'name', 'slug', 'term_group']);
  assert.strictEqual(out[0].rows.length, 2);
  assert.deepStrictEqual(out[0].rows[0], [1, 'Cat A', 'cat-a', 0]);
  assert.deepStrictEqual(out[0].rows[1], [2, 'Cat B', 'cat-b', 0]);
});

test('handles escaped quotes and commas inside strings', async () => {
  const sql = "INSERT INTO `AGJiSNzCU_terms` (`name`) VALUES ('it\\'s, fine'), ('plain');\n";
  const out = [];
  for await (const stmt of streamInserts(fromString(sql), new Set(['AGJiSNzCU_terms']))) {
    out.push(stmt);
  }
  assert.deepStrictEqual(out[0].rows, [["it's, fine"], ['plain']]);
});

test('handles multi-line INSERT split across chunks', async () => {
  const sql = "INSERT INTO `AGJiSNzCU_terms` (`name`) VALUES\n  ('a'),\n  ('b');\n";
  const out = [];
  for await (const stmt of streamInserts(fromString(sql), new Set(['AGJiSNzCU_terms']))) {
    out.push(stmt);
  }
  assert.deepStrictEqual(out[0].rows, [['a'], ['b']]);
});

test('skips tables not in the allowlist', async () => {
  const sql = "INSERT INTO `wp_skipme` (`x`) VALUES (1);\nINSERT INTO `AGJiSNzCU_terms` (`name`) VALUES ('keep');\n";
  const out = [];
  for await (const stmt of streamInserts(fromString(sql), new Set(['AGJiSNzCU_terms']))) {
    out.push(stmt);
  }
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].rows[0][0], 'keep');
});

test('parses NULL as JS null', async () => {
  const sql = "INSERT INTO `AGJiSNzCU_terms` (`name`) VALUES (NULL), ('x');\n";
  const out = [];
  for await (const stmt of streamInserts(fromString(sql), new Set(['AGJiSNzCU_terms']))) {
    out.push(stmt);
  }
  assert.strictEqual(out[0].rows[0][0], null);
  assert.strictEqual(out[0].rows[1][0], 'x');
});
```

- [ ] **Step 2: Run the test to verify it fails for module-not-found**

```bash
node --test tests/wp-migration/sql-stream.test.js
```

Expected: failure "Cannot find module '../../scripts/wp-migration/sql-stream'".

- [ ] **Step 3: Implement the streaming parser**

Create `scripts/wp-migration/sql-stream.js`:

```js
/**
 * Streams INSERT statements from a mysqldump file and yields them as
 * { table, columns, rows } objects. Only tables in `tables` (a Set) are
 * yielded; other rows are discarded without parsing their VALUES tuples.
 *
 * Trade-offs:
 *  - We assume mysqldump's format: one INSERT per table-block, columns
 *    listed, VALUES tuples comma-separated, statement terminated by `;\n`.
 *  - We do NOT execute SQL — we tokenize tuples and convert literals
 *    (quoted string, NULL, integer, float) into JS values.
 *  - Hex blobs (`X'...'`) become Buffers.
 *  - Backslash-escapes inside quoted strings are honored:
 *      \' \" \\ \n \r \t \0 → expanded.
 */
async function* streamInserts(readable, tables) {
  let buf = '';
  for await (const chunk of readable) {
    buf += chunk.toString('utf8');
    while (true) {
      const stmt = takeNextInsert(buf);
      if (!stmt) break;
      buf = stmt.rest;
      if (tables.has(stmt.table)) yield parseInsert(stmt);
    }
  }
}

const INSERT_RE = /INSERT INTO `([^`]+)` \(([^)]+)\) VALUES\s*/g;

function takeNextInsert(buf) {
  INSERT_RE.lastIndex = 0;
  const m = INSERT_RE.exec(buf);
  if (!m) return null;
  const table = m[1];
  const columns = m[2].split(',').map(c => c.trim().replace(/^`|`$/g, ''));
  // Find the terminating `;` not inside a string.
  const valuesStart = INSERT_RE.lastIndex;
  const end = findStatementEnd(buf, valuesStart);
  if (end === -1) return null; // not yet fully buffered
  return {
    table,
    columns,
    valuesText: buf.slice(valuesStart, end),
    rest: buf.slice(end + 1), // skip the ';'
  };
}

function findStatementEnd(s, from) {
  let i = from;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") { i = skipQuoted(s, i); if (i === -1) return -1; continue; }
    if (c === ';') return i;
    i++;
  }
  return -1;
}

function skipQuoted(s, i) {
  // s[i] is the opening quote
  i++;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { i += 2; continue; }
    if (c === "'") return i + 1;
    i++;
  }
  return -1;
}

function parseInsert({ table, columns, valuesText, rest }) {
  const rows = [];
  let i = 0;
  while (i < valuesText.length) {
    while (i < valuesText.length && /[\s,]/.test(valuesText[i])) i++;
    if (i >= valuesText.length) break;
    if (valuesText[i] !== '(') {
      throw new Error(`Expected '(' at offset ${i} in ${table} INSERT`);
    }
    const close = findTupleClose(valuesText, i);
    rows.push(parseTuple(valuesText.slice(i + 1, close)));
    i = close + 1;
  }
  return { table, columns, rows };
}

function findTupleClose(s, open) {
  let i = open + 1;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") { i = skipQuoted(s, i); continue; }
    if (c === ')') return i;
    i++;
  }
  throw new Error('Unterminated tuple');
}

function parseTuple(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (i >= text.length) break;
    if (text[i] === ',') { i++; continue; }
    if (text[i] === "'") {
      const end = skipQuoted(text, i);
      out.push(unescapeMysql(text.slice(i + 1, end - 1)));
      i = end;
    } else if (text.startsWith('NULL', i)) {
      out.push(null);
      i += 4;
    } else if (text[i] === 'X' && text[i + 1] === "'") {
      // Hex literal X'...'
      const end = skipQuoted(text, i + 1);
      out.push(Buffer.from(text.slice(i + 2, end - 1), 'hex'));
      i = end;
    } else {
      // numeric literal
      let j = i;
      while (j < text.length && /[-0-9.eE+]/.test(text[j])) j++;
      const tok = text.slice(i, j);
      const num = Number(tok);
      out.push(Number.isNaN(num) ? tok : num);
      i = j;
    }
  }
  return out;
}

function unescapeMysql(s) {
  return s.replace(/\\(.)/g, (_, c) => {
    switch (c) {
      case 'n': return '\n';
      case 'r': return '\r';
      case 't': return '\t';
      case '0': return '\0';
      default:  return c;
    }
  });
}

module.exports = { streamInserts };
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
node --test tests/wp-migration/sql-stream.test.js
```

Expected: 5 pass, 0 fail. If a test fails, fix the parser inline before committing — the parser is load-bearing for every later task.

- [ ] **Step 5: Commit**

```bash
git add scripts/wp-migration/sql-stream.js tests/wp-migration/sql-stream.test.js
git commit -m "feat(migrate-wp): streaming INSERT parser for mysqldump"
```

---

## Task 4: Pure transform functions (WP rows → fork rows)

**Files:**
- Create: `scripts/wp-migration/transform.js`
- Create: `tests/wp-migration/transform.test.js`

The transform layer is pure: given a list of WP rows in known shapes, return new rows in the fork's shapes. No DB, no filesystem. This is the easiest layer to test exhaustively.

- [ ] **Step 1: Write failing tests**

Create `tests/wp-migration/transform.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const {
  buildCategoryRows,
  buildProductRows,
  buildLicenseStockRows,
} = require('../../scripts/wp-migration/transform');

test('buildCategoryRows maps product_cat terms to fork categories', () => {
  const terms = [
    { term_id: 10, name: 'ChatGPT', slug: 'chatgpt' },
    { term_id: 11, name: 'Capcut',  slug: 'capcut' },
  ];
  const taxonomy = [
    { term_id: 10, taxonomy: 'product_cat', parent: 0 },
    { term_id: 11, taxonomy: 'product_cat', parent: 0 },
    { term_id: 12, taxonomy: 'category',    parent: 0 }, // not product_cat — ignored
  ];
  const rows = buildCategoryRows({ terms, taxonomy });
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows[0], {
    wp_term_id: 10,
    name: 'ChatGPT',
    slug: 'chatgpt',
    emoji: '📦',
    sort_order: 0,
    is_active: 1,
  });
});

test('buildProductRows maps product posts and joins price/stock postmeta', () => {
  const posts = [
    { ID: 100, post_title: 'GPT Plus', post_status: 'publish', post_type: 'product',
      post_name: 'gpt-plus', post_content: 'Long', post_excerpt: 'Short' },
    { ID: 101, post_title: 'Draft',   post_status: 'draft',   post_type: 'product',
      post_name: 'draft', post_content: '', post_excerpt: '' }, // dropped
    { ID: 102, post_title: 'Variation', post_status: 'publish', post_type: 'product_variation',
      post_name: 'var', post_content: '', post_excerpt: '' }, // dropped
  ];
  const meta = [
    { post_id: 100, meta_key: '_price', meta_value: '8000' },
    { post_id: 100, meta_key: '_thumbnail_id', meta_value: '500' },
  ];
  const wpTermIdToCategoryId = new Map([[10, 1]]);
  const termRel = [
    { object_id: 100, term_taxonomy_id: 10 },
  ];
  const taxonomy = [
    { term_taxonomy_id: 10, term_id: 10, taxonomy: 'product_cat' },
  ];
  const rows = buildProductRows({ posts, meta, termRel, taxonomy, wpTermIdToCategoryId });
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0], {
    wp_post_id: 100,
    category_id: 1,
    name: 'GPT Plus',
    slug: 'gpt-plus',
    price: 8000,
    description: 'Short',
    long_description: 'Long',
    emoji: '📦',
    promotion: null,
    contact_only: 0,
    contact_url: null,
    sheet_stock: 0,
    is_active: 1,
    image_url: null, // resolved later by image task
    wp_thumbnail_id: 500,
  });
});

test('buildProductRows falls back to slugify(name) when post_name is empty', () => {
  const posts = [
    { ID: 200, post_title: 'Nâng Cấp Tài Khoản', post_status: 'publish', post_type: 'product',
      post_name: '', post_content: '', post_excerpt: '' },
  ];
  const rows = buildProductRows({
    posts, meta: [], termRel: [], taxonomy: [], wpTermIdToCategoryId: new Map(),
  });
  assert.strictEqual(rows[0].slug, 'nang-cap-tai-khoan');
});

test('buildProductRows drops products with no price meta', () => {
  const posts = [
    { ID: 300, post_title: 'Free Sample', post_status: 'publish', post_type: 'product',
      post_name: 'free-sample', post_content: '', post_excerpt: '' },
  ];
  const rows = buildProductRows({
    posts, meta: [], termRel: [], taxonomy: [], wpTermIdToCategoryId: new Map(),
  });
  assert.strictEqual(rows.length, 0);
});

test('buildLicenseStockRows imports only unsold (status=1) keys mapped to known products', () => {
  const csvRows = [
    { license_key: 'KEY-001', wp_product_id: 100, status: '1' }, // active
    { license_key: 'KEY-002', wp_product_id: 100, status: '2' }, // sold
    { license_key: 'KEY-003', wp_product_id: 999, status: '1' }, // unknown product
  ];
  const wpProductIdToFork = new Map([[100, 7]]);
  const rows = buildLicenseStockRows({ csvRows, wpProductIdToFork });
  assert.strictEqual(rows.length, 1);
  assert.deepStrictEqual(rows[0], { product_id: 7, data: 'KEY-001' });
});
```

- [ ] **Step 2: Run the test to verify it fails for module-not-found**

```bash
node --test tests/wp-migration/transform.test.js
```

- [ ] **Step 3: Implement the transforms**

Create `scripts/wp-migration/transform.js`:

```js
const { slugify } = require('../../src/utils/slugify');

function buildCategoryRows({ terms, taxonomy }) {
  const productCatTermIds = new Set(
    taxonomy.filter(t => t.taxonomy === 'product_cat').map(t => Number(t.term_id))
  );
  return terms
    .filter(t => productCatTermIds.has(Number(t.term_id)))
    .map(t => ({
      wp_term_id: Number(t.term_id),
      name: String(t.name),
      slug: t.slug ? String(t.slug) : (slugify(t.name) || `cat-wp-${t.term_id}`),
      emoji: '📦',
      sort_order: 0,
      is_active: 1,
    }));
}

function buildProductRows({ posts, meta, termRel, taxonomy, wpTermIdToCategoryId }) {
  // Index meta by post_id for fast lookup
  const metaByPost = new Map();
  for (const m of meta) {
    const key = Number(m.post_id);
    if (!metaByPost.has(key)) metaByPost.set(key, {});
    metaByPost.get(key)[m.meta_key] = m.meta_value;
  }

  // Map term_taxonomy_id → term_id (for product_cat only)
  const ttIdToTermId = new Map();
  for (const t of taxonomy) {
    if (t.taxonomy === 'product_cat') {
      ttIdToTermId.set(Number(t.term_taxonomy_id), Number(t.term_id));
    }
  }

  // Map post → first product_cat category
  const postToCategory = new Map();
  for (const r of termRel) {
    const termId = ttIdToTermId.get(Number(r.term_taxonomy_id));
    if (termId == null) continue;
    const catId = wpTermIdToCategoryId.get(termId);
    if (catId == null) continue;
    if (!postToCategory.has(Number(r.object_id))) {
      postToCategory.set(Number(r.object_id), catId);
    }
  }

  const out = [];
  for (const p of posts) {
    if (p.post_status !== 'publish') continue;
    if (p.post_type !== 'product') continue; // skip variations and drafts
    const m = metaByPost.get(Number(p.ID)) || {};
    const priceRaw = m._price ?? m._regular_price;
    const price = priceRaw != null ? Math.round(Number(priceRaw)) : NaN;
    if (!Number.isFinite(price) || price <= 0) continue; // skip priceless
    out.push({
      wp_post_id: Number(p.ID),
      category_id: postToCategory.get(Number(p.ID)) ?? null,
      name: String(p.post_title),
      slug: p.post_name ? String(p.post_name) : (slugify(p.post_title) || `product-wp-${p.ID}`),
      price,
      description: p.post_excerpt ? String(p.post_excerpt) : '',
      long_description: p.post_content ? String(p.post_content) : '',
      emoji: '📦',
      promotion: null,
      contact_only: 0,
      contact_url: null,
      sheet_stock: 0,
      is_active: 1,
      image_url: null,
      wp_thumbnail_id: m._thumbnail_id ? Number(m._thumbnail_id) : null,
    });
  }
  return out;
}

function buildLicenseStockRows({ csvRows, wpProductIdToFork }) {
  const out = [];
  for (const r of csvRows) {
    if (String(r.status) !== '1') continue; // 1 = active/unsold in lmfwc
    const forkId = wpProductIdToFork.get(Number(r.wp_product_id));
    if (forkId == null) continue;
    const key = String(r.license_key || '').trim();
    if (!key) continue;
    out.push({ product_id: forkId, data: key });
  }
  return out;
}

module.exports = { buildCategoryRows, buildProductRows, buildLicenseStockRows };
```

- [ ] **Step 4: Run the test to verify all pass**

```bash
node --test tests/wp-migration/transform.test.js
```

Expected: 5 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add scripts/wp-migration/transform.js tests/wp-migration/transform.test.js
git commit -m "feat(migrate-wp): pure transforms for categories, products, licenses"
```

---

## Task 5: Extract layer — pull WP rows we need from the dump

**Files:**
- Create: `scripts/wp-migration/extract-categories.js`
- Create: `scripts/wp-migration/extract-products.js`
- Create: `scripts/wp-migration/extract-licenses.js`

These are thin shells over `streamInserts` plus column lookups. They read the dump exactly once each (once per process) and return arrays. Total memory peak: a few MB even for a large catalog.

- [ ] **Step 1: Write the categories extractor**

Create `scripts/wp-migration/extract-categories.js`:

```js
const fs = require('node:fs');
const { streamInserts } = require('./sql-stream');
const { WP_TABLE_PREFIX, WP_SQL_DUMP } = require('./config');

/**
 * Returns { terms: [{term_id, name, slug}], taxonomy: [{term_id, term_taxonomy_id, taxonomy, parent}] }
 * pulled from the dump.
 */
async function extractCategories() {
  const wantedTables = new Set([
    `${WP_TABLE_PREFIX}terms`,
    `${WP_TABLE_PREFIX}term_taxonomy`,
  ]);
  const terms = [];
  const taxonomy = [];

  const stream = fs.createReadStream(WP_SQL_DUMP);
  for await (const stmt of streamInserts(stream, wantedTables)) {
    const ix = indexer(stmt.columns);
    if (stmt.table === `${WP_TABLE_PREFIX}terms`) {
      for (const row of stmt.rows) {
        terms.push({
          term_id: row[ix('term_id')],
          name: row[ix('name')],
          slug: row[ix('slug')],
        });
      }
    } else {
      for (const row of stmt.rows) {
        taxonomy.push({
          term_taxonomy_id: row[ix('term_taxonomy_id')],
          term_id: row[ix('term_id')],
          taxonomy: row[ix('taxonomy')],
          parent: row[ix('parent')],
        });
      }
    }
  }
  return { terms, taxonomy };
}

function indexer(columns) {
  const map = new Map(columns.map((c, i) => [c, i]));
  return (name) => {
    const i = map.get(name);
    if (i == null) throw new Error(`Column ${name} not in INSERT (${columns.join(',')})`);
    return i;
  };
}

module.exports = { extractCategories, indexer };
```

- [ ] **Step 2: Write the products extractor**

Create `scripts/wp-migration/extract-products.js`:

```js
const fs = require('node:fs');
const { streamInserts } = require('./sql-stream');
const { indexer } = require('./extract-categories');
const { WP_TABLE_PREFIX, WP_SQL_DUMP } = require('./config');

const META_KEYS_OF_INTEREST = new Set([
  '_price', '_regular_price', '_sale_price', '_thumbnail_id', '_sku',
  '_stock', '_stock_status', '_visibility',
]);

async function extractProductsAndMeta() {
  const wantedTables = new Set([
    `${WP_TABLE_PREFIX}posts`,
    `${WP_TABLE_PREFIX}postmeta`,
    `${WP_TABLE_PREFIX}term_relationships`,
  ]);

  const posts = [];
  const meta = [];
  const termRel = [];
  const productPostIds = new Set();

  const stream = fs.createReadStream(WP_SQL_DUMP);
  for await (const stmt of streamInserts(stream, wantedTables)) {
    const ix = indexer(stmt.columns);
    if (stmt.table === `${WP_TABLE_PREFIX}posts`) {
      for (const row of stmt.rows) {
        const post = {
          ID: row[ix('ID')],
          post_title: row[ix('post_title')],
          post_status: row[ix('post_status')],
          post_type: row[ix('post_type')],
          post_name: row[ix('post_name')],
          post_content: row[ix('post_content')],
          post_excerpt: row[ix('post_excerpt')],
        };
        if (post.post_type === 'product' || post.post_type === 'attachment') {
          posts.push(post);
          if (post.post_type === 'product') productPostIds.add(Number(post.ID));
        }
      }
    } else if (stmt.table === `${WP_TABLE_PREFIX}postmeta`) {
      for (const row of stmt.rows) {
        const key = row[ix('meta_key')];
        if (!META_KEYS_OF_INTEREST.has(key) && key !== '_wp_attached_file') continue;
        meta.push({
          post_id: row[ix('post_id')],
          meta_key: key,
          meta_value: row[ix('meta_value')],
        });
      }
    } else {
      for (const row of stmt.rows) {
        termRel.push({
          object_id: row[ix('object_id')],
          term_taxonomy_id: row[ix('term_taxonomy_id')],
        });
      }
    }
  }

  return { posts, meta, termRel, productPostIds };
}

module.exports = { extractProductsAndMeta };
```

- [ ] **Step 3: Write the licenses extractor (CSV-based)**

Create `scripts/wp-migration/extract-licenses.js`:

```js
const fs = require('node:fs');
const { LMFWC_CSV_PATH } = require('./config');

/**
 * Parse the lmfwc CSV export. The plugin exports columns including:
 *   id, license_key, hash, product_id, status, expires_at, ...
 * Status codes: 1=ACTIVE, 2=INACTIVE, 3=SOLD, 4=DELIVERED.
 * We treat status=1 as "unsold and importable".
 */
function extractLicenses() {
  if (!fs.existsSync(LMFWC_CSV_PATH)) {
    throw new Error(
      `LMFWC export CSV not found at ${LMFWC_CSV_PATH}. ` +
      `Produce it via WP-admin → License Manager → Export, then re-run.`
    );
  }
  const text = fs.readFileSync(LMFWC_CSV_PATH, 'utf8');
  return parseCsv(text);
}

function parseCsv(text) {
  // Minimal RFC 4180-ish parser: handles quoted fields with escaped quotes.
  const lines = [];
  let i = 0, field = '', row = [], inQuote = false;
  while (i < text.length) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQuote = false; i++; continue; }
      field += c; i++;
    } else {
      if (c === '"') { inQuote = true; i++; continue; }
      if (c === ',') { row.push(field); field = ''; i++; continue; }
      if (c === '\n') { row.push(field); lines.push(row); row = []; field = ''; i++; continue; }
      if (c === '\r') { i++; continue; }
      field += c; i++;
    }
  }
  if (field || row.length) { row.push(field); lines.push(row); }

  if (lines.length < 2) return [];
  const header = lines[0].map(h => h.trim().toLowerCase());
  const idx = (name) => header.indexOf(name);
  const out = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r];
    if (cols.length === 1 && cols[0] === '') continue;
    out.push({
      id: cols[idx('id')],
      license_key: cols[idx('license_key')] ?? cols[idx('key')] ?? '',
      wp_product_id: Number(cols[idx('product_id')]),
      status: cols[idx('status')],
    });
  }
  return out;
}

module.exports = { extractLicenses };
```

If the column names in the CSV differ (older lmfwc versions), the extractor falls back to `key` for the license. If both are missing, the row produces an empty `license_key` and the transform layer drops it.

- [ ] **Step 4: Smoke test the extractors against the real dump**

```bash
node -e '
(async () => {
  const { extractCategories } = require("./scripts/wp-migration/extract-categories");
  const c = await extractCategories();
  console.log("terms:", c.terms.length, "taxonomy:", c.taxonomy.length);
  console.log("first product_cat:", c.taxonomy.find(t => t.taxonomy === "product_cat"));
})();
'
```

Expected: a positive count of terms (a typical WP site has dozens), and a `product_cat` taxonomy row printed. If the count is zero, the dump path or the table prefix is wrong — fix `config.js` before continuing.

```bash
node -e '
(async () => {
  const { extractProductsAndMeta } = require("./scripts/wp-migration/extract-products");
  const r = await extractProductsAndMeta();
  console.log("posts:", r.posts.length, "meta:", r.meta.length, "termRel:", r.termRel.length);
  console.log("sample product:", r.posts.find(p => p.post_type === "product" && p.post_status === "publish"));
})();
'
```

Expected: a positive count and a sample product row.

- [ ] **Step 5: Commit**

```bash
git add scripts/wp-migration/extract-categories.js scripts/wp-migration/extract-products.js scripts/wp-migration/extract-licenses.js
git commit -m "feat(migrate-wp): extractors for categories, products, license CSV"
```

---

## Task 6: Load layer — write transformed rows to SQLite

**Files:**
- Create: `scripts/wp-migration/load.js`

The load layer takes the rows from Task 4 and inserts them in a single transaction. Idempotency is achieved by tracking `wp_post_id` and `wp_term_id` in two new tables (created at runtime, NOT via migration — they are migration scaffolding, not part of the production schema). On re-run the loader deletes everything tied to those mapping tables before inserting fresh rows.

- [ ] **Step 1: Write the loader**

Create `scripts/wp-migration/load.js`:

```js
const path = require('node:path');
const Database = require('better-sqlite3');

const DB_PATH = path.resolve(__dirname, '../../data/db.sqlite');

function open() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS wp_term_map (
      wp_term_id INTEGER PRIMARY KEY,
      category_id INTEGER NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS wp_post_map (
      wp_post_id INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL UNIQUE
    );
  `);
  return db;
}

/**
 * Wipe rows previously imported by this script. Categories and products
 * outside the maps (e.g. the seed rows from migration 001) are left alone.
 * Stock rows imported in a prior run are also wiped. Orders that reference
 * imported products/stock are an error condition — the tables should be
 * empty before #2 runs (no real customers yet).
 */
function resetPreviousImport(db) {
  const stockDel = db.prepare(`
    DELETE FROM stock
    WHERE product_id IN (SELECT product_id FROM wp_post_map)
  `);
  const productDel = db.prepare(`
    DELETE FROM products
    WHERE id IN (SELECT product_id FROM wp_post_map)
  `);
  const categoryDel = db.prepare(`
    DELETE FROM categories
    WHERE id IN (SELECT category_id FROM wp_term_map)
  `);
  db.transaction(() => {
    stockDel.run();
    productDel.run();
    categoryDel.run();
    db.exec('DELETE FROM wp_post_map; DELETE FROM wp_term_map;');
  })();
}

function loadCategories(db, rows) {
  const insertCat = db.prepare(`
    INSERT INTO categories (name, slug, emoji, sort_order, is_active, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertMap = db.prepare(`
    INSERT INTO wp_term_map (wp_term_id, category_id) VALUES (?, ?)
  `);
  const wpTermIdToCategoryId = new Map();
  db.transaction(() => {
    let order = 0;
    for (const r of rows) {
      const result = insertCat.run(r.name, r.slug, r.emoji, order++, r.is_active, '');
      const id = Number(result.lastInsertRowid);
      insertMap.run(r.wp_term_id, id);
      wpTermIdToCategoryId.set(r.wp_term_id, id);
    }
  })();
  return wpTermIdToCategoryId;
}

function loadProducts(db, rows) {
  const insertProd = db.prepare(`
    INSERT INTO products (
      category_id, name, slug, price, description, long_description,
      emoji, promotion, contact_only, contact_url, sheet_stock, is_active, image_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertMap = db.prepare(`
    INSERT INTO wp_post_map (wp_post_id, product_id) VALUES (?, ?)
  `);
  const wpPostIdToProductId = new Map();
  db.transaction(() => {
    for (const r of rows) {
      const result = insertProd.run(
        r.category_id, r.name, r.slug, r.price, r.description, r.long_description,
        r.emoji, r.promotion, r.contact_only, r.contact_url, r.sheet_stock, r.is_active, r.image_url
      );
      const id = Number(result.lastInsertRowid);
      insertMap.run(r.wp_post_id, id);
      wpPostIdToProductId.set(r.wp_post_id, id);
    }
  })();
  return wpPostIdToProductId;
}

function loadStock(db, rows) {
  const insert = db.prepare(`INSERT INTO stock (product_id, data) VALUES (?, ?)`);
  let inserted = 0;
  db.transaction(() => {
    for (const r of rows) {
      insert.run(r.product_id, r.data);
      inserted++;
    }
  })();
  return inserted;
}

function updateProductImages(db, idToUrl) {
  const upd = db.prepare(`UPDATE products SET image_url = ? WHERE id = ?`);
  db.transaction(() => {
    for (const [productId, url] of idToUrl) {
      upd.run(url, productId);
    }
  })();
}

module.exports = {
  open,
  resetPreviousImport,
  loadCategories,
  loadProducts,
  loadStock,
  updateProductImages,
};
```

- [ ] **Step 2: Hand-test the loader against a temporary DB**

```bash
node -e '
const { open, loadCategories, loadProducts } = require("./scripts/wp-migration/load");
const db = open();
const m1 = loadCategories(db, [
  { wp_term_id: 999001, name: "Test Cat", slug: "test-cat-9001", emoji: "📦", sort_order: 0, is_active: 1 },
]);
const m2 = loadProducts(db, [
  { wp_post_id: 999002, category_id: [...m1.values()][0], name: "Test Product",
    slug: "test-product-9002", price: 1000, description: "", long_description: "",
    emoji: "📦", promotion: null, contact_only: 0, contact_url: null,
    sheet_stock: 0, is_active: 1, image_url: null },
]);
console.log("inserted product id:", [...m2.values()][0]);
'
sqlite3 data/db.sqlite "SELECT id, name FROM categories WHERE slug = 'test-cat-9001';"
sqlite3 data/db.sqlite "SELECT id, name, slug FROM products WHERE slug = 'test-product-9002';"
```

Expected: rows printed for both.

- [ ] **Step 3: Clean up the test rows**

```bash
sqlite3 data/db.sqlite "DELETE FROM products WHERE slug = 'test-product-9002';
                       DELETE FROM categories WHERE slug = 'test-cat-9001';
                       DELETE FROM wp_post_map; DELETE FROM wp_term_map;"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/wp-migration/load.js
git commit -m "feat(migrate-wp): SQLite loader with idempotent re-import via wp maps"
```

---

## Task 7: Image extractor — resolve product → file path

**Files:**
- Create: `scripts/wp-migration/extract-images.js`
- Create: `tests/wp-migration/extract-images.test.js`

For each product, the extracted `wp_thumbnail_id` is the post ID of an attachment. The attachment's `_wp_attached_file` postmeta gives the path under `wp-content/uploads/`. We resolve that path on disk.

- [ ] **Step 1: Write the test**

Create `tests/wp-migration/extract-images.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const { resolveProductImagePaths } = require('../../scripts/wp-migration/extract-images');

test('resolves product → uploads file path via _thumbnail_id and _wp_attached_file', () => {
  const productRows = [
    { wp_post_id: 100, wp_thumbnail_id: 500 },
    { wp_post_id: 101, wp_thumbnail_id: null },
    { wp_post_id: 102, wp_thumbnail_id: 999 }, // attachment missing _wp_attached_file
  ];
  const meta = [
    { post_id: 500, meta_key: '_wp_attached_file', meta_value: '2024/05/cover.png' },
  ];
  const out = resolveProductImagePaths({ productRows, meta });
  assert.deepStrictEqual(out, new Map([[100, '2024/05/cover.png']]));
});
```

- [ ] **Step 2: Run to fail**

```bash
node --test tests/wp-migration/extract-images.test.js
```

- [ ] **Step 3: Implement**

Create `scripts/wp-migration/extract-images.js`:

```js
function resolveProductImagePaths({ productRows, meta }) {
  const attachedFileByPostId = new Map();
  for (const m of meta) {
    if (m.meta_key === '_wp_attached_file' && m.meta_value) {
      attachedFileByPostId.set(Number(m.post_id), String(m.meta_value));
    }
  }
  const out = new Map();
  for (const p of productRows) {
    if (!p.wp_thumbnail_id) continue;
    const file = attachedFileByPostId.get(Number(p.wp_thumbnail_id));
    if (file) out.set(Number(p.wp_post_id), file);
  }
  return out;
}

module.exports = { resolveProductImagePaths };
```

- [ ] **Step 4: Run to pass**

```bash
node --test tests/wp-migration/extract-images.test.js
```

Expected: 1 pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add scripts/wp-migration/extract-images.js tests/wp-migration/extract-images.test.js
git commit -m "feat(migrate-wp): resolve product → uploads file path"
```

---

## Task 8: Image pipeline — sharp AVIF + WebP, original + thumb

**Files:**
- Create: `scripts/wp-migration/images.js`
- Create: `tests/wp-migration/images.test.js`

The pipeline is small, but it's where most runtime is spent on a real catalog (hundreds of images × 4 derivatives = thousands of sharp invocations). We process serially with concurrency=4, accept arbitrary input formats (jpg/png/webp/avif), and skip any source we already converted in a prior run by hashing the source bytes into a `.cache/` lookup file.

- [ ] **Step 1: Write the test**

Create `tests/wp-migration/images.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { processImage } = require('../../scripts/wp-migration/images');

test('processImage produces AVIF and WebP at original and thumb widths', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpimg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const srcPath = path.join(dir, 'src.png');
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 255, g: 0, b: 0 } } })
    .png().toFile(srcPath);

  const result = await processImage({
    srcPath,
    productId: 42,
    slug: 'red',
    outDir: dir,
    variants: [
      { name: 'original', width: 800, formats: ['avif', 'webp'] },
      { name: 'thumb',    width: 400, formats: ['avif', 'webp'] },
    ],
  });

  for (const v of ['42-red-original.avif', '42-red-original.webp', '42-red-thumb.avif', '42-red-thumb.webp']) {
    assert.ok(fs.existsSync(path.join(dir, v)), `missing ${v}`);
  }
  // Public URL chosen by processImage = the WebP original (universal fallback).
  assert.strictEqual(result.imageUrl, '/uploads/products/42-red-original.webp');
});
```

- [ ] **Step 2: Run to fail**

```bash
node --test tests/wp-migration/images.test.js
```

- [ ] **Step 3: Implement**

Create `scripts/wp-migration/images.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

/**
 * Convert a single source image into all (variant, format) combinations.
 * Returns { imageUrl } — the canonical URL used in `products.image_url`,
 * which we set to the WebP original (broadest browser support).
 *
 * Skips any output that already exists with the same source mtime to make
 * re-runs fast without complicating the pipeline with content hashing.
 */
async function processImage({ srcPath, productId, slug, outDir, variants }) {
  fs.mkdirSync(outDir, { recursive: true });
  const baseName = `${productId}-${slug}`;
  const srcMtimeMs = fs.statSync(srcPath).mtimeMs;

  for (const v of variants) {
    for (const fmt of v.formats) {
      const out = path.join(outDir, `${baseName}-${v.name}.${fmt}`);
      if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= srcMtimeMs) continue;
      const pipeline = sharp(srcPath).resize({ width: v.width, withoutEnlargement: true });
      if (fmt === 'avif') pipeline.avif({ quality: 60 });
      else if (fmt === 'webp') pipeline.webp({ quality: 80 });
      else throw new Error(`Unsupported format ${fmt}`);
      await pipeline.toFile(out);
    }
  }

  return { imageUrl: `/uploads/products/${baseName}-original.webp` };
}

async function processAll({ items, outDir, variants, concurrency = 4 }) {
  const results = new Map();
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const it = items[i];
      try {
        const { imageUrl } = await processImage({
          srcPath: it.srcPath, productId: it.productId, slug: it.slug,
          outDir, variants,
        });
        results.set(it.productId, imageUrl);
      } catch (err) {
        results.set(it.productId, { error: err.message });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

module.exports = { processImage, processAll };
```

- [ ] **Step 4: Run the test**

```bash
node --test tests/wp-migration/images.test.js
```

Expected: 1 pass, 0 fail. The test takes 1–2 s because sharp loads native bindings and produces real AVIF/WebP — that's expected.

- [ ] **Step 5: Commit**

```bash
git add scripts/wp-migration/images.js tests/wp-migration/images.test.js
git commit -m "feat(migrate-wp): sharp pipeline for AVIF + WebP, original + thumb"
```

---

## Task 9: Orchestrator — `scripts/migrate-wp.js`

**Files:**
- Create: `scripts/migrate-wp.js`
- Create: `scripts/wp-migration/report.js`

This is the CLI entry point. It glues every prior task together and prints the final report. Failures are reported, not thrown — a problem with one product shouldn't abort the whole run.

- [ ] **Step 1: Write the report module**

Create `scripts/wp-migration/report.js`:

```js
const fs = require('node:fs');
const path = require('node:path');
const { REPORT_PATH } = require('./config');

function makeReport() {
  const r = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    counts: {
      categoriesImported: 0,
      productsImported: 0,
      productsSkippedNoPrice: 0,
      productsSkippedNoCategory: 0,
      stockKeysImported: 0,
      stockKeysSkippedSold: 0,
      stockKeysSkippedUnknownProduct: 0,
      imagesOptimized: 0,
      imagesMissingSource: 0,
      imageErrors: 0,
    },
    errors: [],
  };
  return r;
}

function writeReport(report) {
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));
}

function printSummary(report) {
  console.log('\n=== WordPress migration report ===');
  for (const [k, v] of Object.entries(report.counts)) {
    console.log(`  ${k}: ${v}`);
  }
  if (report.errors.length) {
    console.log(`\n  errors (${report.errors.length}):`);
    for (const e of report.errors.slice(0, 10)) console.log(`    - ${e}`);
    if (report.errors.length > 10) console.log(`    ... ${report.errors.length - 10} more`);
  }
  console.log(`\n  full report: ${REPORT_PATH}`);
}

module.exports = { makeReport, writeReport, printSummary };
```

- [ ] **Step 2: Write the orchestrator**

Create `scripts/migrate-wp.js`:

```js
#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { extractCategories } = require('./wp-migration/extract-categories');
const { extractProductsAndMeta } = require('./wp-migration/extract-products');
const { extractLicenses } = require('./wp-migration/extract-licenses');
const { resolveProductImagePaths } = require('./wp-migration/extract-images');
const { buildCategoryRows, buildProductRows, buildLicenseStockRows } = require('./wp-migration/transform');
const { processAll } = require('./wp-migration/images');
const { open, resetPreviousImport, loadCategories, loadProducts, loadStock, updateProductImages } = require('./wp-migration/load');
const { makeReport, writeReport, printSummary } = require('./wp-migration/report');
const cfg = require('./wp-migration/config');

async function main() {
  const report = makeReport();
  console.log('1/6 extracting categories…');
  const { terms, taxonomy } = await extractCategories();
  const categoryRows = buildCategoryRows({ terms, taxonomy });

  console.log('2/6 extracting products + meta + relationships…');
  const { posts, meta, termRel } = await extractProductsAndMeta();

  console.log('3/6 opening DB and resetting any previous import…');
  const db = open();
  resetPreviousImport(db);

  const wpTermIdToCategoryId = loadCategories(db, categoryRows);
  report.counts.categoriesImported = categoryRows.length;

  const productRows = buildProductRows({
    posts: posts.filter(p => p.post_type === 'product'),
    meta,
    termRel,
    taxonomy,
    wpTermIdToCategoryId,
  });
  for (const p of posts) {
    if (p.post_type !== 'product' || p.post_status !== 'publish') continue;
    if (!productRows.some(r => r.wp_post_id === Number(p.ID))) {
      const m = meta.find(x => Number(x.post_id) === Number(p.ID) && x.meta_key === '_price');
      if (!m || !m.meta_value || Number(m.meta_value) <= 0) {
        report.counts.productsSkippedNoPrice++;
      } else {
        report.counts.productsSkippedNoCategory++;
      }
    }
  }

  const wpPostIdToProductId = loadProducts(db, productRows);
  report.counts.productsImported = productRows.length;

  console.log('4/6 importing license keys (CSV)…');
  let csvRows = [];
  try {
    csvRows = extractLicenses();
  } catch (err) {
    report.errors.push(`license CSV: ${err.message}`);
  }
  const stockRows = buildLicenseStockRows({ csvRows, wpProductIdToFork: wpPostIdToProductId });
  for (const r of csvRows) {
    if (String(r.status) !== '1') report.counts.stockKeysSkippedSold++;
    else if (!wpPostIdToProductId.has(Number(r.wp_product_id))) {
      report.counts.stockKeysSkippedUnknownProduct++;
    }
  }
  report.counts.stockKeysImported = loadStock(db, stockRows);

  console.log('5/6 processing product images…');
  const productImagePathRel = resolveProductImagePaths({
    productRows,
    meta: meta.filter(m => m.meta_key === '_wp_attached_file'),
  });
  const items = [];
  for (const p of productRows) {
    const rel = productImagePathRel.get(p.wp_post_id);
    if (!rel) continue;
    const srcPath = path.join(cfg.WP_UPLOADS_ROOT, rel);
    if (!fs.existsSync(srcPath)) {
      report.counts.imagesMissingSource++;
      report.errors.push(`image missing for product wp_post_id=${p.wp_post_id}: ${rel}`);
      continue;
    }
    items.push({
      productId: wpPostIdToProductId.get(p.wp_post_id),
      slug: p.slug,
      srcPath,
    });
  }
  const results = await processAll({
    items,
    outDir: cfg.PRODUCT_IMAGES_OUT,
    variants: cfg.IMAGE_VARIANTS,
    concurrency: 4,
  });
  const idToUrl = new Map();
  for (const [productId, val] of results) {
    if (typeof val === 'string') {
      idToUrl.set(productId, val);
      report.counts.imagesOptimized++;
    } else {
      report.counts.imageErrors++;
      report.errors.push(`image error for product ${productId}: ${val.error}`);
    }
  }
  updateProductImages(db, idToUrl);

  console.log('6/6 writing report…');
  writeReport(report);
  printSummary(report);
}

main().catch((err) => {
  console.error('FATAL:', err.stack || err.message);
  process.exit(1);
});
```

- [ ] **Step 3: Make it executable**

```bash
chmod +x scripts/migrate-wp.js
```

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-wp.js scripts/wp-migration/report.js
git commit -m "feat(migrate-wp): orchestrator + structured report"
```

---

## Task 10: End-to-end dry run on the real dump

**Files:**
- (none modified) — verification gate

This task runs the migration against the real backup and inspects the resulting DB. If the user has not produced `data/wp-imports/lmfwc-export.csv`, the license-key portion of the report will be zero-valued and an error will appear in `report.errors` — that's acceptable for an MVP and unblocks sub-projects #3 / #5 / #6.

- [ ] **Step 1: Reset the database**

```bash
rm -f data/db.sqlite data/db.sqlite-shm data/db.sqlite-wal
( node src/index.js & echo $! > /tmp/api.pid; sleep 3; kill $(cat /tmp/api.pid) ) || true
sqlite3 data/db.sqlite "SELECT COUNT(*) FROM products;"
```

Expected: 8 (the seed rows from migration 001).

- [ ] **Step 2: Wipe seed rows so the imported set is the only one**

```bash
sqlite3 data/db.sqlite "DELETE FROM products; DELETE FROM categories;"
```

The seeds were placeholders for sub-project #1's smoke test. They are not part of the live product catalog.

- [ ] **Step 3: Run the migration**

```bash
npm run migrate:wp
```

Expected: console prints the six step lines, then a summary block with counts > 0 for `categoriesImported`, `productsImported`, `imagesOptimized`. `stockKeysImported` is 0 unless the CSV is present.

- [ ] **Step 4: Spot-check the data**

```bash
sqlite3 data/db.sqlite "SELECT COUNT(*) FROM categories;"
sqlite3 data/db.sqlite "SELECT COUNT(*) FROM products;"
sqlite3 data/db.sqlite "SELECT COUNT(*) FROM stock;"
sqlite3 data/db.sqlite "SELECT id, name, price, image_url FROM products ORDER BY id LIMIT 5;"
sqlite3 data/db.sqlite "SELECT id, name, slug FROM categories ORDER BY id LIMIT 10;"
```

Expected:
- categories count > 0 (depends on dump; commonly 5–20).
- products count > 0 (commonly 30–100).
- stock count == 0 OR the count from the CSV.
- Sample product rows have non-zero `price` and a non-empty `image_url` if the source image existed.

```bash
ls -la data/uploads/products/ | head
```

Expected: each product with an image has 4 files (`{id}-{slug}-original.{avif,webp}` and `{id}-{slug}-thumb.{avif,webp}`).

- [ ] **Step 5: Verify re-runnability**

```bash
npm run migrate:wp
```

Expected: completes successfully, the same counts as before. Image conversions are skipped (mtime check). Categories / products / stock should be the same set of rows (different IDs are acceptable — the wp_*_map tables hide the ID churn from downstream code).

- [ ] **Step 6: Commit (if any incidental change)**

```bash
git status
git diff --quiet || git commit -am "chore(migrate-wp): incidental fixes from real-dump dry run"
```

If the dry run surfaced a parser bug, fix the parser/extractors, run `npm test`, and commit those fixes here. Do not skip this — silent fix-ups are how the next sub-project inherits a broken extract layer.

---

## Task 11: Snapshot the imported DB and tag the milestone

**Files:**
- (none modified)

- [ ] **Step 1: Snapshot the post-migration DB for fast reset**

```bash
cp data/db.sqlite data/db.sqlite.imported
```

`data/db.sqlite.imported` is gitignored alongside `data/db.sqlite`. It exists so sub-projects #3 and later can restore an imported catalog instantly without re-running the full migration.

- [ ] **Step 2: Tag the milestone**

```bash
git tag -a v0.2-wp-migration -m "WP migration complete: products, categories, license keys, images imported"
```

- [ ] **Step 3: Print smoke-test checklist for the human**

```text
Smoke checks (read-only on the post-migration DB):
  1. sqlite3 data/db.sqlite "SELECT COUNT(*) FROM products WHERE image_url != '';" → > 0
  2. sqlite3 data/db.sqlite "SELECT slug FROM categories WHERE slug = '';" → empty
  3. sqlite3 data/db.sqlite "SELECT COUNT(*) FROM products WHERE category_id IS NULL;" → small (and explained in report)
  4. ls data/uploads/products/*.avif | wc -l → matches productsImported * 2 (original + thumb)
  5. cat data/wp-imports/migration-report.json | jq '.counts'  → reasonable counts
  6. node --test tests/wp-migration/  → all green
```

This concludes sub-project #2. The fork now has a real catalog wired to product images. Ready for sub-project #3 (Mini App MVP).

---

## Risks and notes

- **Encrypted license keys in the dump.** lmfwc encrypts the `license_key` column at rest using a secret derived from the WP `wp-config.php` constants `LMFWC_PLUGIN_DEFINED_HASHING_ALGORITHM` and `LMFWC_PLUGIN_DEFINED_CRYPTOGRAPHIC_KEY` (defaults derived from `LOGGED_IN_KEY`/`LOGGED_IN_SALT`). Decrypting from the dump alone is not possible without those constants. The plan therefore uses the WP-admin CSV export, which produces plaintext keys. If WP-admin is gone, the fallback is to dump `wp-config.php` from the original server — the user must hand it over and a follow-up task can decrypt with the same algorithm. Out of scope for this sub-project's MVP.
- **Variable products (variations).** WooCommerce variations are `post_type='product_variation'` rows referencing a parent product. The transform drops them. If the catalog uses variations heavily, the report's `productsImported` will undercount real SKUs — surface this in the user-facing handoff so a follow-up decision can be made (collapse to parent, extend schema, or skip variants entirely).
- **Multiple categories per product.** A product can be in N `product_cat` taxonomies; the transform takes the first. If multi-category retention matters, extend the schema to a join table; out of scope for MVP.
- **Image size budget.** The uploads dir on the original site is reportedly ~1 GB across ~16k files. The migration only touches files referenced by `_thumbnail_id`, so the working set is far smaller (typically ~one image per product). Verify after Task 10 that `du -sh data/uploads/products/` is reasonable (< 200 MB for a hundred-product catalog).
- **Vietnamese in slugs.** `post_name` is already URL-encoded by WordPress, but old slugs sometimes contain raw Vietnamese characters that break URLs. The transform falls back to `slugify(post_title)` only when `post_name` is empty. If a downstream URL fails, regenerate the slug via slugify once after migration.
- **Idempotency edge case.** Re-running the migration deletes any rows tied to `wp_post_map` / `wp_term_map`. If real customer orders have been placed against imported products before re-running, the cascading delete will fail (foreign key from `orders`). For MVP this is fine — re-runs only happen during sub-project #2's development window, before any orders exist.
