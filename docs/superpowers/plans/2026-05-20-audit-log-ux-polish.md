# Audit Log UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/admin/audit` rows information-dense — one row per logical action, with the affected entity's name/code visible at a glance.

**Architecture:** Three coordinated fixes. (1) Remove the global `auditLog` middleware so each admin action logs exactly once (the semantic per-route call). (2) Auto-enrich `details.entityLabel` inside `auditService.log()` via a per-entity SELECT — works for create/update where the row still exists. (3) Capture a pre-delete snapshot at each delete site so deleted entities still carry a label after they're gone. Frontend renders the label below the `entity_type #id` and pretty-prints the `details` JSON in the modal as a definition list.

**Tech Stack:** Express + better-sqlite3 (`src/api/middleware`, `src/services/auditService`, `src/api/routes/admin/*`), Node native test runner. Next 16 + React 19 + TanStack Query for the audit page and modal. No new dependencies.

**Spec source:** The "fix this" request was made inline with two example pain points:
- Pair rows for one action (`stock.delete` row from the per-route log + `delete.stock` row from the middleware).
- Entity column shows `product #147` with no clue what was deleted.

**Branch:** `feat/admin-audit-page` (PR #1 still open — these commits will append to that PR).

**Files touched:**

| Action | Path | Responsibility |
|---|---|---|
| Delete | `src/api/middleware/audit.js` | The duplicate-source middleware — replaced by per-route logs. |
| Modify | `src/api/server.js` | Drop `auditLog` import and middleware mount on `/admin`. |
| Modify | `src/services/auditService.js` | Add `enrichDetailsWithLabel(entityType, entityId, details)` helper; call it from `log()` so create/update logs auto-gain `details.entityLabel`. |
| Modify | `tests/services/auditService.test.js` | Cover auto-enrichment for known entity types + the "already provided" short-circuit. |
| Modify | `src/api/routes/admin/products.js` | Pre-delete snapshot on `product.delete`. |
| Modify | `src/api/routes/admin/categories.js` | Pre-delete snapshot on `category.delete`. |
| Modify | `src/api/routes/admin/discounts.js` | Pre-delete snapshot on `discount.delete`. |
| Modify | `src/api/routes/admin/stock.js` | Pre-delete snapshot on `stock.delete` (keep existing `product_id`). |
| Modify | `src/api/routes/admin/orders.js` | Pre-cancel snapshot on `order.cancel` (status → cancelled). |
| Modify | `src/api/routes/admin/variants.js` | Pre-delete snapshot on `variant.delete`. |
| Modify | `src/api/routes/admin/announcements.js` | Pre-delete snapshot on `announcement.delete`. |
| Modify | `web/src/app/(admin)/admin/audit/page.tsx` | Parse `details`, render entity label below the `entity_type #id`. |
| Modify | `web/src/components/AuditDetailModal.tsx` | Render `details` object as a definition-list when parseable. |

**TDD note:** Backend has Node native test runner. Frontend has none — verification is `npx tsc --noEmit`, `npx eslint`, plus `npm run build`.

---

## Task 1: Remove the global `auditLog` middleware

**Files:**
- Delete: `src/api/middleware/audit.js`
- Modify: `src/api/server.js`

- [ ] **Step 1: Verify the duplicate-log source**

Run: `cat src/api/middleware/audit.js`
Expected: a module that overrides `res.json` to log every successful 2xx mutation with `action = '${method}.${path-first-segment}'`, `entity_type = null`, `entity_id = null`, `details = { path, method }`. This is the source of duplicated rows like `delete.stock` paired with each semantic `stock.delete`.

- [ ] **Step 2: Confirm the mount site**

Run: `grep -n "auditLog" src/api/server.js`
Expected:
- `const { auditLog } = require('./middleware/audit');` — the import line.
- `router.use('/admin', adminLimiter, requireAdmin, loadAdminPermissions, auditLog, require('./routes/admin'));` — the mount.

- [ ] **Step 3: Edit `src/api/server.js`**

Find:

```js
const { auditLog } = require('./middleware/audit');
```

Delete that entire line.

Find:

```js
  router.use('/admin', adminLimiter, requireAdmin, loadAdminPermissions, auditLog, require('./routes/admin'));
```

Replace with:

```js
  router.use('/admin', adminLimiter, requireAdmin, loadAdminPermissions, require('./routes/admin'));
```

- [ ] **Step 4: Delete the middleware file**

Run: `rm src/api/middleware/audit.js`

- [ ] **Step 5: Confirm no remaining references**

Run: `grep -rn "auditLog\b" src/ 2>/dev/null`
Expected: no output. (The middleware is the only `auditLog` symbol; per-route calls go through `auditService.log`, a different name.)

- [ ] **Step 6: Syntax check**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --check src/api/server.js`
Expected: exit 0 (no syntax errors).

- [ ] **Step 7: Boot the API briefly to confirm it starts**

Run:
```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && lsof -ti :3000 | xargs kill -9 2>/dev/null; nohup node src/index.js > /tmp/api-boot.log 2>&1 & sleep 4 && head -20 /tmp/api-boot.log && lsof -ti :3000 | xargs kill -9 2>/dev/null
```
Expected: log shows the "🚀 API listening on :3000" line (or whatever the boot success message is — check by reading current src/index.js startup logs first). No `Cannot find module './middleware/audit'` errors.

- [ ] **Step 8: Commit**

```bash
git add src/api/server.js src/api/middleware/audit.js
git commit -m "fix(audit): remove duplicate-log middleware

src/api/middleware/audit.js wrapped res.json on /admin/* and logged
every successful mutation with action='delete.stock' / 'post.products'
etc — duplicating the semantic per-route auditService.log calls. The
per-route calls already carry richer info (entity_type, entity_id,
action-specific details) so the middleware was redundant noise.

Each admin action now produces exactly one audit row."
```

---

## Task 2: Auto-enrich `details.entityLabel` in `auditService.log`

**Files:**
- Modify: `src/services/auditService.js`
- Modify: `tests/services/auditService.test.js`

- [ ] **Step 1: Add failing tests**

Open `tests/services/auditService.test.js` and append (after the existing `getEntityTypes` test, before any module-end marker):

```js
test('log: auto-fills details.entityLabel for known entity types when row exists', () => {
  const slug = 'audit-label-' + Math.floor(Math.random() * 1e9);
  const catInfo = db.prepare("INSERT INTO categories (name, slug) VALUES (?, ?)").run('Auto Label Cat', slug);
  const productInfo = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, 'Auto Label Product', ?, 1000, 1)
  `).run(catInfo.lastInsertRowid, 'p-' + slug);
  const productId = productInfo.lastInsertRowid;
  const seededAudit = [];

  try {
    auditService.log(1, 'product.test_update', 'product', productId, { foo: 'bar' }, '::1');
    const row = db.prepare("SELECT details FROM audit_log WHERE action = 'product.test_update' ORDER BY id DESC LIMIT 1").get();
    seededAudit.push(db.prepare("SELECT id FROM audit_log WHERE action = 'product.test_update'").all().map(r => r.id));
    assert.ok(row, 'audit row created');
    const parsed = JSON.parse(row.details);
    assert.strictEqual(parsed.entityLabel, 'Auto Label Product');
    assert.strictEqual(parsed.foo, 'bar', 'existing details fields preserved');
  } finally {
    db.prepare("DELETE FROM audit_log WHERE action = 'product.test_update'").run();
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(catInfo.lastInsertRowid);
  }
});

test('log: leaves details.entityLabel alone when caller already supplied it', () => {
  const slug = 'audit-label-noop-' + Math.floor(Math.random() * 1e9);
  const catInfo = db.prepare("INSERT INTO categories (name, slug) VALUES (?, ?)").run('Untouched Cat', slug);
  const productInfo = db.prepare(`
    INSERT INTO products (category_id, name, slug, price, is_active)
    VALUES (?, 'Real Name', ?, 1000, 1)
  `).run(catInfo.lastInsertRowid, 'p-' + slug);
  const productId = productInfo.lastInsertRowid;

  try {
    auditService.log(1, 'product.test_pre', 'product', productId, { entityLabel: 'Snapshot Before Delete', extra: 1 }, '::1');
    const row = db.prepare("SELECT details FROM audit_log WHERE action = 'product.test_pre' ORDER BY id DESC LIMIT 1").get();
    const parsed = JSON.parse(row.details);
    assert.strictEqual(parsed.entityLabel, 'Snapshot Before Delete', 'caller value preserved, not overwritten by SELECT');
    assert.strictEqual(parsed.extra, 1);
  } finally {
    db.prepare("DELETE FROM audit_log WHERE action = 'product.test_pre'").run();
    db.prepare('DELETE FROM products WHERE id = ?').run(productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(catInfo.lastInsertRowid);
  }
});

test('log: silently no-ops enrichment when entity row is missing or entityType unknown', () => {
  try {
    // Unknown entity_type — no lookup defined.
    auditService.log(1, 'misc.action', 'unmapped_type', 99999, { keep: true }, '::1');
    // Known entity_type but missing row (very high id).
    auditService.log(1, 'product.test_missing', 'product', 9999999, { keep: true }, '::1');

    const r1 = JSON.parse(db.prepare("SELECT details FROM audit_log WHERE action = 'misc.action' ORDER BY id DESC LIMIT 1").get().details);
    assert.strictEqual(r1.entityLabel, undefined, 'no enrichment for unknown type');
    assert.strictEqual(r1.keep, true);

    const r2 = JSON.parse(db.prepare("SELECT details FROM audit_log WHERE action = 'product.test_missing' ORDER BY id DESC LIMIT 1").get().details);
    assert.strictEqual(r2.entityLabel, undefined, 'no enrichment when product row missing');
    assert.strictEqual(r2.keep, true);
  } finally {
    db.prepare("DELETE FROM audit_log WHERE action IN ('misc.action','product.test_missing')").run();
  }
});
```

- [ ] **Step 2: Run the failing tests**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --test tests/services/auditService.test.js`
Expected: 3 new tests fail (`details.entityLabel` is undefined for the first; the second test passes only by coincidence if the existing code preserves caller details; the third fails for the same reason). The 3 pre-existing tests from earlier work still pass.

- [ ] **Step 3: Replace `src/services/auditService.js` with the enriched version**

Overwrite with this exact content (preserves existing behavior + adds enrichment):

```js
const db = require('../database');

const insertAudit = db.prepare(`
  INSERT INTO audit_log (admin_id, action, entity_type, entity_id, details, ip_address)
  VALUES (?, ?, ?, ?, ?, ?)
`);

// Per-entity SQL to pull a human-readable label. Run only when entity_id is
// non-null and the caller did not already supply details.entityLabel (e.g. a
// pre-delete snapshot). Each query selects exactly one column aliased to
// `label` so the helper can read it generically.
const ENTITY_LABEL_QUERIES = {
  product:      'SELECT name AS label FROM products WHERE id = ?',
  category:     'SELECT name AS label FROM categories WHERE id = ?',
  discount:     'SELECT code AS label FROM discount_codes WHERE id = ?',
  stock:        'SELECT data AS label FROM stock WHERE id = ?',
  variant:      'SELECT name AS label FROM product_variants WHERE id = ?',
  admin:        'SELECT display_name AS label FROM admins WHERE id = ?',
  order:        'SELECT payment_code AS label FROM orders WHERE id = ?',
  announcement: 'SELECT title AS label FROM announcements WHERE id = ?',
};

const LABEL_MAX_LEN = 80;

function enrichDetailsWithLabel(entityType, entityId, details) {
  if (!entityType || entityId == null) return details;
  if (details && Object.prototype.hasOwnProperty.call(details, 'entityLabel')) return details;
  const query = ENTITY_LABEL_QUERIES[entityType];
  if (!query) return details;
  try {
    const row = db.prepare(query).get(entityId);
    if (!row || row.label == null) return details;
    let label = String(row.label);
    if (label.length > LABEL_MAX_LEN) label = label.slice(0, LABEL_MAX_LEN) + '…';
    return { ...(details || {}), entityLabel: label };
  } catch {
    return details;
  }
}

const auditService = {
  log(adminId, action, entityType = null, entityId = null, details = null, ipAddress = null) {
    const enriched = enrichDetailsWithLabel(entityType, entityId, details);
    insertAudit.run(
      adminId,
      action,
      entityType,
      entityId,
      enriched ? JSON.stringify(enriched) : null,
      ipAddress
    );
  },

  getRecent(limit = 50, offset = 0, filters = {}) {
    let where = '1=1';
    const params = [];

    if (filters.adminId) {
      where += ' AND al.admin_id = ?';
      params.push(filters.adminId);
    }
    if (filters.action) {
      where += ' AND al.action LIKE ?';
      params.push(`%${filters.action}%`);
    }
    if (filters.entityType) {
      where += ' AND al.entity_type = ?';
      params.push(filters.entityType);
    }
    if (filters.from) {
      where += ' AND al.created_at >= ?';
      params.push(filters.from);
    }
    if (filters.to) {
      where += ' AND al.created_at <= ?';
      params.push(filters.to);
    }
    if (filters.q) {
      where += ' AND (al.details LIKE ? OR al.action LIKE ?)';
      params.push(`%${filters.q}%`, `%${filters.q}%`);
    }

    const rows = db.prepare(`
      SELECT al.*, a.display_name as admin_name
      FROM audit_log al
      LEFT JOIN admins a ON al.admin_id = a.id
      WHERE ${where}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    const total = db.prepare(`
      SELECT COUNT(*) as c
      FROM audit_log al
      LEFT JOIN admins a ON al.admin_id = a.id
      WHERE ${where}
    `).all(...params)[0].c;

    return { rows, total };
  },

  getEntityTypes() {
    return db.prepare(`
      SELECT DISTINCT entity_type
      FROM audit_log
      WHERE entity_type IS NOT NULL
      ORDER BY entity_type
    `).all().map(r => r.entity_type);
  },
};

module.exports = auditService;
```

- [ ] **Step 4: Re-run tests**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --test tests/services/auditService.test.js`
Expected: 6/6 pass (3 pre-existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add src/services/auditService.js tests/services/auditService.test.js
git commit -m "feat(audit): auto-enrich details.entityLabel for known entity types

auditService.log() now runs a per-entity SELECT (product/category/
discount/stock/variant/admin/order/announcement) and merges a 80-char
truncated label into details.entityLabel when the caller did not
already supply one. Frontend renders this label beside entity_type
#id so admins can see what was touched without opening every row.

Pre-supplied details.entityLabel short-circuits — used by delete sites
that snapshot the entity before removing it (next task)."
```

---

## Task 3: Pre-delete snapshots at every CRUD-delete site

**Files:**
- Modify: `src/api/routes/admin/products.js`
- Modify: `src/api/routes/admin/categories.js`
- Modify: `src/api/routes/admin/discounts.js`
- Modify: `src/api/routes/admin/stock.js`
- Modify: `src/api/routes/admin/orders.js`
- Modify: `src/api/routes/admin/variants.js`
- Modify: `src/api/routes/admin/announcements.js`

Each delete site captures identifying fields BEFORE the row disappears, then passes them as `details` so the audit row preserves them.

- [ ] **Step 1: `src/api/routes/admin/products.js` — product.delete**

Find this block (around line 216-225, the `router.delete('/:id', ...)` handler):

```js
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  db.prepare('DELETE FROM stock WHERE product_id = ? AND is_sold = 0').run(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  auditService.log(req.admin.adminId, 'product.delete', 'product', id, null, req.ip);
  eventBus.publish({ type: 'product.delete', productId: id });
  res.json({ success: true });
});
```

Replace with:

```js
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT id, name, slug, price FROM products WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  db.prepare('DELETE FROM stock WHERE product_id = ? AND is_sold = 0').run(id);
  db.prepare('DELETE FROM products WHERE id = ?').run(id);
  auditService.log(req.admin.adminId, 'product.delete', 'product', id, {
    entityLabel: existing.name,
    slug: existing.slug,
    price: existing.price,
  }, req.ip);
  eventBus.publish({ type: 'product.delete', productId: id });
  res.json({ success: true });
});
```

- [ ] **Step 2: `src/api/routes/admin/categories.js` — category.delete**

Find around line 60-66:

```js
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  auditService.log(req.admin.adminId, 'category.delete', 'category', id, null, req.ip);
  res.json({ success: true });
});
```

Replace with:

```js
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const existing = db.prepare('SELECT name, slug FROM categories WHERE id = ?').get(id);
  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  auditService.log(req.admin.adminId, 'category.delete', 'category', id, existing ? {
    entityLabel: existing.name,
    slug: existing.slug,
  } : null, req.ip);
  res.json({ success: true });
});
```

- [ ] **Step 3: `src/api/routes/admin/discounts.js` — discount.delete**

Find around line 60-66:

```js
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM discount_codes WHERE id = ?').run(req.params.id);
  auditService.log(req.admin.adminId, 'discount.delete', 'discount', req.params.id, null, req.ip);
  res.json({ success: true });
});
```

Replace with:

```js
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT code, type, amount FROM discount_codes WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM discount_codes WHERE id = ?').run(req.params.id);
  auditService.log(req.admin.adminId, 'discount.delete', 'discount', req.params.id, existing ? {
    entityLabel: existing.code,
    type: existing.type,
    amount: existing.amount,
  } : null, req.ip);
  res.json({ success: true });
});
```

- [ ] **Step 4: `src/api/routes/admin/stock.js` — stock.delete**

Find around line 110-122 (the second `router.delete` — single-item delete):

```js
router.delete('/:productId/:itemId', (req, res) => {
  const productId = parseInt(req.params.productId);
  const itemId = parseInt(req.params.itemId);
  const result = db.prepare('DELETE FROM stock WHERE id = ?').run(itemId);
  if (result.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  auditService.log(req.admin.adminId, 'stock.delete', 'stock', itemId, { product_id: productId }, req.ip);
  res.json({ success: true });
});
```

Replace with:

```js
router.delete('/:productId/:itemId', (req, res) => {
  const productId = parseInt(req.params.productId);
  const itemId = parseInt(req.params.itemId);
  const existing = db.prepare('SELECT data, variant_id, is_sold FROM stock WHERE id = ?').get(itemId);
  const result = db.prepare('DELETE FROM stock WHERE id = ?').run(itemId);
  if (result.changes === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  const dataPreview = existing && existing.data
    ? (existing.data.length > 60 ? existing.data.slice(0, 60) + '…' : existing.data)
    : null;
  auditService.log(req.admin.adminId, 'stock.delete', 'stock', itemId, {
    entityLabel: dataPreview,
    product_id: productId,
    variant_id: existing?.variant_id ?? null,
    was_sold: !!(existing && existing.is_sold),
  }, req.ip);
  res.json({ success: true });
});
```

- [ ] **Step 5: `src/api/routes/admin/orders.js` — order.cancel**

Find around line 285-292 (the cancel handler):

```js
router.post('/:id/cancel', (req, res) => {
  // ...existing pre-update logic...
  auditService.log(req.admin.adminId, 'order.cancel', 'order', id, null, req.ip);
  res.json({ success: true });
});
```

The `auditService.log(req.admin.adminId, 'order.cancel', 'order', id, null, req.ip);` line is at ~line 289. Find:

```js
  auditService.log(req.admin.adminId, 'order.cancel', 'order', id, null, req.ip);
```

Replace with:

```js
  const orderSnap = db.prepare('SELECT payment_code, total_price, user_id FROM orders WHERE id = ?').get(id);
  auditService.log(req.admin.adminId, 'order.cancel', 'order', id, orderSnap ? {
    entityLabel: orderSnap.payment_code,
    total_price: orderSnap.total_price,
    user_id: orderSnap.user_id,
  } : null, req.ip);
```

The order is not deleted on cancel (status flips to `'cancelled'`), so the SELECT after the cancel still works. Reading after is fine; we keep it ordered after the status update for consistency with the rest of the handler.

- [ ] **Step 6: `src/api/routes/admin/variants.js` — variant.delete**

Find around line 90-97 (the `router.delete` handler):

```js
router.delete('/:variantId', (req, res) => {
  // ...
  auditService.log(req.admin?.adminId, 'variant.delete', 'variant', variantId, { productId, hard: true }, req.ip);
  // ...
});
```

Replace the existing audit call line:

```js
  auditService.log(req.admin?.adminId, 'variant.delete', 'variant', variantId, { productId, hard: true }, req.ip);
```

With (capture the snapshot BEFORE the existing variant-delete logic runs; if the existing code already SELECTs the variant for validation, reuse that row instead — read the handler context and adapt):

```js
  auditService.log(req.admin?.adminId, 'variant.delete', 'variant', variantId, {
    entityLabel: existingVariant?.name ?? null,
    productId,
    hard: true,
  }, req.ip);
```

Look at the surrounding handler: there is almost certainly already an `existingVariant` lookup before the delete (for 404 handling). If the local binding is named differently (e.g. `variant`, `row`), use that name. If no pre-select exists, add one:

```js
  const existingVariant = db.prepare('SELECT name FROM product_variants WHERE id = ?').get(variantId);
```

immediately before the delete call.

- [ ] **Step 7: `src/api/routes/admin/announcements.js` — announcement.delete**

Find around line 118-126:

```js
router.delete('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  // ...delete logic...
  auditService.log(req.admin.adminId, 'announcement.delete', 'announcement', id, null, req.ip);
  res.json({ success: true });
});
```

Add a pre-delete snapshot. Replace the audit call line:

```js
  auditService.log(req.admin.adminId, 'announcement.delete', 'announcement', id, null, req.ip);
```

With (immediately preceded by the snapshot fetch):

```js
  const annSnap = db.prepare('SELECT title, target FROM announcements WHERE id = ?').get(id);
  auditService.log(req.admin.adminId, 'announcement.delete', 'announcement', id, annSnap ? {
    entityLabel: annSnap.title,
    target: annSnap.target,
  } : null, req.ip);
```

Position: the snapshot fetch must happen BEFORE the `DELETE FROM announcements` statement. Read the handler to find the right insertion point; if the delete runs first, move the snapshot above it.

- [ ] **Step 8: Lint the touched backend files**

Run:
```bash
source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --check src/api/routes/admin/products.js src/api/routes/admin/categories.js src/api/routes/admin/discounts.js src/api/routes/admin/stock.js src/api/routes/admin/orders.js src/api/routes/admin/variants.js src/api/routes/admin/announcements.js
```
Expected: all syntax-clean (exit 0).

- [ ] **Step 9: Re-run the audit service tests (regression check)**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --test tests/services/auditService.test.js`
Expected: 6/6 pass — Task 3 only edits route files, no service signature change.

- [ ] **Step 10: Commit**

```bash
git add src/api/routes/admin/products.js src/api/routes/admin/categories.js src/api/routes/admin/discounts.js src/api/routes/admin/stock.js src/api/routes/admin/orders.js src/api/routes/admin/variants.js src/api/routes/admin/announcements.js
git commit -m "feat(audit): capture pre-delete snapshots so audit rows survive removal

product/category/discount/stock/order(cancel)/variant/announcement
delete handlers now SELECT identifying fields (name, slug, code, data
preview, payment_code, ...) before the row is removed and pass them as
details.entityLabel + additional context. Auto-enrich short-circuits on
the supplied label so post-delete display still names the thing."
```

---

## Task 4: Frontend audit page — show entity label

**Files:**
- Modify: `web/src/app/(admin)/admin/audit/page.tsx`

- [ ] **Step 1: Add a small parser helper**

Open `web/src/app/(admin)/admin/audit/page.tsx`. Find the existing `truncate` helper inside the `AuditPage` component (around line 100). Add a new helper directly above it, still inside the component (so it can stay simple — no need to share):

```ts
  function parseDetails(s: string | null): Record<string, unknown> | null {
    if (!s) return null
    try {
      const v = JSON.parse(s)
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
    } catch {
      return null
    }
  }
```

- [ ] **Step 2: Render the label in the Entity column**

Find this `<td>` inside the table row (around line 197):

```tsx
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.entity_type ?? '—'}
                  {row.entity_id !== null ? ` #${row.entity_id}` : ''}
                </td>
```

Replace with:

```tsx
                <td className="px-3 py-2 whitespace-nowrap">
                  <div>{row.entity_type ?? '—'}{row.entity_id !== null ? ` #${row.entity_id}` : ''}</div>
                  {(() => {
                    const d = parseDetails(row.details)
                    const label = d && typeof d.entityLabel === 'string' ? d.entityLabel : null
                    return label ? <div className="text-xs opacity-60 truncate max-w-[220px]">{label}</div> : null
                  })()}
                </td>
```

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
cd web && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsc --noEmit && npx eslint 'src/app/(admin)/admin/audit/page.tsx'
```
Both exit 0.

- [ ] **Step 4: Commit**

```bash
git add 'web/src/app/(admin)/admin/audit/page.tsx'
git commit -m "feat(audit/web): show entity label below entity_type #id

Parses details JSON and renders details.entityLabel (e.g. product name,
discount code, order payment_code) as a smaller line under the
'product #147' identifier, so admins can see what was touched at a
glance."
```

---

## Task 5: AuditDetailModal — definition-list rendering of details

**Files:**
- Modify: `web/src/components/AuditDetailModal.tsx`

- [ ] **Step 1: Add an object-renderer alongside the existing `prettify`**

Open `web/src/components/AuditDetailModal.tsx`. Find the existing helpers near the top:

```ts
function prettify(details: string | null) {
  if (!details) return '—'
  try {
    return JSON.stringify(JSON.parse(details), null, 2)
  } catch {
    return details
  }
}

function parseDbDate(s: string): Date {
  return new Date(s.replace(' ', 'T') + 'Z')
}
```

Replace `prettify` with this richer pair (keeping `parseDbDate` untouched):

```ts
function parseObject(details: string | null): Record<string, unknown> | null {
  if (!details) return null
  try {
    const v = JSON.parse(details)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function rawPretty(details: string | null): string {
  if (!details) return '—'
  try {
    return JSON.stringify(JSON.parse(details), null, 2)
  } catch {
    return details
  }
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function parseDbDate(s: string): Date {
  return new Date(s.replace(' ', 'T') + 'Z')
}
```

- [ ] **Step 2: Use the object renderer in the JSX**

Find the existing details block at the bottom of the returned JSX:

```tsx
        <h3 className="text-sm font-semibold mb-1">Details</h3>
        <pre className="text-xs bg-black/5 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words">
          {prettify(row.details)}
        </pre>
```

Replace with:

```tsx
        <h3 className="text-sm font-semibold mb-1">Details</h3>
        {(() => {
          const obj = parseObject(row.details)
          if (obj) {
            const entries = Object.entries(obj)
            if (entries.length === 0) {
              return <p className="text-sm opacity-60">—</p>
            }
            return (
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
                {entries.map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="opacity-60 font-mono">{k}</dt>
                    <dd className="break-words">{renderValue(v)}</dd>
                  </div>
                ))}
              </dl>
            )
          }
          return (
            <pre className="text-xs bg-black/5 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words">
              {rawPretty(row.details)}
            </pre>
          )
        })()}
```

The object branch renders each key/value as a `<dt>` / `<dd>` pair (a "definition list" with grid layout for alignment). The fallback `<pre>` handles cases where `details` is not a JSON object (rare — most rows are objects).

- [ ] **Step 3: Typecheck + lint**

Run:
```bash
cd web && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsc --noEmit && npx eslint src/components/AuditDetailModal.tsx
```
Both exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AuditDetailModal.tsx
git commit -m "feat(audit/web): render modal details as a definition list

Object-shaped details get a 2-column grid of <dt>/<dd> pairs (key in
mono opacity-60, value plain). Non-object/parse-failure falls back to
the existing raw JSON <pre>. Easier to scan than indented JSON."
```

---

## Task 6: Verification

**Files:** (no edits)

- [ ] **Step 1: Backend regression — full audit service test suite**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --test tests/services/auditService.test.js`
Expected: 6/6 pass (3 pre-existing filter/getEntityTypes tests + 3 new enrichment tests).

- [ ] **Step 2: Other backend tests still pass**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --test tests/`
Expected: All tests pass. `auditLog` middleware removal might affect `lowStockDedup.test.js` etc. only if they relied on it (they don't — middleware is admin-only).

- [ ] **Step 3: Web production build**

Run: `cd web && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build`
Expected: build completes; route table includes `/admin/audit`; no TypeScript errors.

- [ ] **Step 4: Start the stack for manual smoke**

Run: `./dev-all.sh`
Expected: mbbank :8000, api :3000, web :3001 all ready.

- [ ] **Step 5: Manual smoke — single row per action**

In a browser as super_admin:
1. Open `/admin/products`.
2. Delete any throwaway product.
3. Visit `/admin/audit` → confirm exactly **one** new row for that delete (semantic `product.delete`). No companion `delete.products` row.

- [ ] **Step 6: Manual smoke — entity label visible**

On `/admin/audit`:
- Find the `product.delete` row from step 5 → Entity column shows `product #N` AND on a smaller line beneath, the product's name.
- Click the row → modal opens; Details section is a definition list with `entityLabel`, `slug`, `price` rows (not raw JSON).
- Find an old row from before this PR (no `entityLabel`) → Entity column shows just `product #N`, no second line. Backwards-compatible.

- [ ] **Step 7: Manual smoke — create / update auto-enrichment**

On `/admin/products`:
- Edit a product's name → save.
- On `/admin/audit`, find the new `product.update` row → Entity column shows `product #N` + label (the product's name lookup-filled by `auditService.log`).

- [ ] **Step 8: Stop the stack**

`Ctrl+C` in the terminal running `./dev-all.sh`, or:
```bash
lsof -ti :3000 :3001 :8000 | xargs kill -9 2>/dev/null; true
```

- [ ] **Step 9: Final smoke commit (only if a touch-up landed)**

If steps 5-7 surfaced no issues, skip. Otherwise:

```bash
git add <touched files>
git commit -m "fix(audit): <specific issue from manual smoke>"
```

---

## Notes for the executing subagent

- Stay strictly within the file list. The `auditService.log` signature is unchanged — call sites need only adjust their `details` payload.
- `Task 3` touches 7 files. If a delete handler in any of them is structured differently from what the step shows (e.g. the variant or announcement handler has additional pre-checks), read the surrounding code first and adapt the insertion point — but only the audit log call line and the snapshot SELECT above it should change. Do not refactor.
- Working directory: `/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot`. Node 22.
- Current branch: `feat/admin-audit-page`. Commits append to PR #1.
- `auditLog` middleware removal in Task 1 may surface latent bugs in `tests/api/*` if any test bound directly to it (none expected — middleware is over res.json which tests don't intercept).
- For non-existent entity ids (e.g. user deletes a product then immediately the audit row is read in the same request flow), the enrichment helper returns the original details unchanged. No throw, no corruption.
