# Audit Log History Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a `/admin/audit` page where super_admin can browse, filter, and drill into every entry in `audit_log`.

**Architecture:** Add an index on `audit_log.created_at` so date-range scans are fast. Extend `auditService.getRecent` with `from/to/q` filters and a new `getEntityTypes()` helper. Gate the existing `/admin/audit-log` route with `requirePermission('audit.read')` (super_admin only via the `'*'` wildcard) and accept the new query params via zod. Build the web UI as a single page under the existing `(admin)` route group, plus one detail modal component, plus one sidebar entry.

**Tech Stack:** Express + zod for the route, better-sqlite3 + raw SQL for the service, Node native test runner (`node:test` + `node:assert`), Next 16 App Router + Turbopack + React 19 + TanStack Query for the page, Tailwind utility classes for layout (matching existing admin pages), lucide-react icons via `@/lib/icons`.

**Spec:** `docs/superpowers/specs/2026-05-20-audit-log-history-design.md`

**Important corrections vs. spec text:**

- Migration number is **031** (latest existing is `030_orders_status_expires_index.js`), not 041.
- `permissionService.js` uses `ROLE_PERMS`, not `CATALOGUE`. Super_admin's `'*'` wildcard already auto-covers `audit.read`; no edit to `permissionService.js` is needed.
- The existing audit route has **no** permission gate today (not `admins.read` as the spec text suggested). Plan adds the gate.
- Web admin pages live under the `(admin)` route group: `web/src/app/(admin)/admin/audit/page.tsx`.
- Icons re-export lives at `web/src/lib/icons.tsx` (not `.ts`).
- `ClipboardList` is not yet re-exported; Task 4 adds it.

**Files touched (8):**

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/database/migrations/031_audit_index.js` | `CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at DESC)` |
| Modify | `src/services/auditService.js` | Extend `getRecent` with `from/to/q`; add `getEntityTypes()` |
| Create | `tests/services/auditService.test.js` | TDD coverage for new filter + helper |
| Modify | `src/api/routes/admin/audit.js` | Add `requirePermission('audit.read')`; zod-validate `from/to/q`; add `GET /entity-types` |
| Modify | `web/src/lib/icons.tsx` | Re-export `ClipboardList` |
| Modify | `web/src/lib/api.ts` | `AuditRow` interface + `audit` helper |
| Create | `web/src/components/AuditDetailModal.tsx` | Modal showing pretty JSON of `details` |
| Create | `web/src/app/(admin)/admin/audit/page.tsx` | Filter bar + table + pagination + row click |
| Modify | `web/src/components/AdminSidebar.tsx` | Sidebar link `"Lịch sử"` gated by `audit.read` |

**Note on TDD:** Backend service has a working test pattern (`tests/services/lowStockDedup.test.js` uses `node:test` + `node:assert` + the real `better-sqlite3` db). Web has no test runner — verification for web tasks is `next build` (TypeScript), `eslint`, and manual smoke.

---

## Task 1: Migration `031_audit_index.js`

**Files:**
- Create: `src/database/migrations/031_audit_index.js`

- [ ] **Step 1: Verify migration runner pattern**

Run: `cat src/database/migrations/030_orders_status_expires_index.js`
Expected: a small module exporting `{ up(db) }` that calls `db.exec` with a single `CREATE INDEX IF NOT EXISTS ...`.

- [ ] **Step 2: Create the migration file**

Create `src/database/migrations/031_audit_index.js` with this exact content:

```js
// 031_audit_index.js
// Date-range scans on /admin/audit otherwise table-walk audit_log.
// Existing 002_platform.js already indexes (admin_id) and (entity_type,
// entity_id) but nothing on created_at.

function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_audit_created_at
      ON audit_log (created_at DESC)
  `);
}

module.exports = { up };
```

- [ ] **Step 3: Run the migration via the API boot**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node -e "require('./src/database')"`
Expected: console prints `📦 Running migration: 031_audit_index.js` followed by `✅ Migration applied: 031_audit_index.js`. On re-run it should print nothing about migration 031 (idempotent).

- [ ] **Step 4: Verify the index exists in the running db**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node -e "const db = require('better-sqlite3')('data/shop.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='audit_log'\").all());"`
Expected: output contains an entry with `name: 'idx_audit_created_at'` alongside the pre-existing `idx_audit_log_admin` and `idx_audit_log_entity`.

- [ ] **Step 5: Commit**

```bash
git add src/database/migrations/031_audit_index.js
git commit -m "feat(db): index audit_log(created_at DESC) for /admin/audit"
```

---

## Task 2: Extend `auditService` (filters + entity-types helper)

**Files:**
- Modify: `src/services/auditService.js`
- Create: `tests/services/auditService.test.js`

- [ ] **Step 1: Read current service**

Run: `cat src/services/auditService.js`
Expected: exports `{ log, getRecent }`. `getRecent(limit, offset, filters)` already handles `adminId`, `action`, `entityType`. No `from/to/q`. No `getEntityTypes`.

- [ ] **Step 2: Write failing test for `from/to/q` + `getEntityTypes`**

Create `tests/services/auditService.test.js` with this exact content:

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const auditService = require('../../src/services/auditService');

function seedAudit(rows) {
  const stmt = db.prepare(`
    INSERT INTO audit_log (admin_id, action, entity_type, entity_id, details, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const ids = [];
  for (const r of rows) {
    const info = stmt.run(r.admin_id, r.action, r.entity_type, r.entity_id, r.details, r.ip_address, r.created_at);
    ids.push(info.lastInsertRowid);
  }
  return ids;
}

function cleanup(ids) {
  if (!ids.length) return;
  const ph = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM audit_log WHERE id IN (${ph})`).run(...ids);
}

test('getRecent: from/to filter narrows by created_at range', () => {
  const tag = 'audittest_' + Math.floor(Math.random() * 1e9);
  const ids = seedAudit([
    { admin_id: 1, action: tag,            entity_type: 'order', entity_id: 1, details: null, ip_address: null, created_at: '2026-05-15 10:00:00' },
    { admin_id: 1, action: tag,            entity_type: 'order', entity_id: 2, details: null, ip_address: null, created_at: '2026-05-18 10:00:00' },
    { admin_id: 1, action: tag,            entity_type: 'order', entity_id: 3, details: null, ip_address: null, created_at: '2026-05-20 10:00:00' },
  ]);

  try {
    const all = auditService.getRecent(100, 0, { action: tag });
    assert.strictEqual(all.total, 3);

    const ranged = auditService.getRecent(100, 0, {
      action: tag,
      from: '2026-05-17 00:00:00',
      to:   '2026-05-19 23:59:59',
    });
    assert.strictEqual(ranged.total, 1);
    assert.strictEqual(ranged.rows[0].entity_id, 2);

    const onlyFrom = auditService.getRecent(100, 0, { action: tag, from: '2026-05-19 00:00:00' });
    assert.strictEqual(onlyFrom.total, 1);
    assert.strictEqual(onlyFrom.rows[0].entity_id, 3);

    const onlyTo = auditService.getRecent(100, 0, { action: tag, to: '2026-05-16 00:00:00' });
    assert.strictEqual(onlyTo.total, 1);
    assert.strictEqual(onlyTo.rows[0].entity_id, 1);
  } finally {
    cleanup(ids);
  }
});

test('getRecent: q filter matches action and details substring', () => {
  const tag = 'qtest_' + Math.floor(Math.random() * 1e9);
  const ids = seedAudit([
    { admin_id: 1, action: tag + '.create', entity_type: 'product', entity_id: 1, details: '{"name":"alpha"}', ip_address: null, created_at: '2026-05-20 10:00:00' },
    { admin_id: 1, action: tag + '.update', entity_type: 'product', entity_id: 2, details: '{"name":"beta"}',  ip_address: null, created_at: '2026-05-20 10:00:00' },
    { admin_id: 1, action: 'other_' + Math.random(), entity_type: 'product', entity_id: 3, details: '{"name":"alpha pattern"}', ip_address: null, created_at: '2026-05-20 10:00:00' },
  ]);

  try {
    const hits = auditService.getRecent(100, 0, { q: 'alpha' });
    // Should match: row 1 (details has "alpha") + row 3 (details has "alpha pattern").
    const hitIds = new Set(hits.rows.map(r => r.id));
    assert.ok(hitIds.has(ids[0]), 'row with alpha in details');
    assert.ok(hitIds.has(ids[2]), 'row with alpha pattern in details');
    assert.ok(!hitIds.has(ids[1]), 'row with beta in details should not match');

    const actionHits = auditService.getRecent(100, 0, { q: tag });
    const actionIds = new Set(actionHits.rows.map(r => r.id));
    assert.ok(actionIds.has(ids[0]) && actionIds.has(ids[1]));
    assert.ok(!actionIds.has(ids[2]));
  } finally {
    cleanup(ids);
  }
});

test('getEntityTypes: returns sorted distinct non-null values', () => {
  const tag = 'etypes_' + Math.floor(Math.random() * 1e9);
  const ids = seedAudit([
    { admin_id: 1, action: tag, entity_type: 'zeta',  entity_id: 1, details: null, ip_address: null, created_at: '2026-05-20 10:00:00' },
    { admin_id: 1, action: tag, entity_type: 'alpha', entity_id: 1, details: null, ip_address: null, created_at: '2026-05-20 10:00:00' },
    { admin_id: 1, action: tag, entity_type: 'alpha', entity_id: 2, details: null, ip_address: null, created_at: '2026-05-20 10:00:00' },
    { admin_id: 1, action: tag, entity_type: null,    entity_id: 3, details: null, ip_address: null, created_at: '2026-05-20 10:00:00' },
  ]);

  try {
    const types = auditService.getEntityTypes();
    assert.ok(Array.isArray(types));
    const idx = types.indexOf('alpha');
    const idy = types.indexOf('zeta');
    assert.ok(idx !== -1, 'alpha present');
    assert.ok(idy !== -1, 'zeta present');
    assert.ok(idx < idy, 'alpha sorted before zeta');
    assert.ok(!types.includes(null), 'no nulls');
  } finally {
    cleanup(ids);
  }
});
```

- [ ] **Step 3: Run the failing test**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --test tests/services/auditService.test.js`
Expected: all three tests fail. The first two fail with the new filters silently ignored (totals will be 3 / 3 / 3 instead of the expected narrower values); the third fails with `auditService.getEntityTypes is not a function`.

- [ ] **Step 4: Replace `src/services/auditService.js` with the extended version**

Overwrite the file with this exact content:

```js
const db = require('../database');

const insertAudit = db.prepare(`
  INSERT INTO audit_log (admin_id, action, entity_type, entity_id, details, ip_address)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const auditService = {
  log(adminId, action, entityType = null, entityId = null, details = null, ipAddress = null) {
    insertAudit.run(
      adminId,
      action,
      entityType,
      entityId,
      details ? JSON.stringify(details) : null,
      ipAddress
    );
  },

  getRecent(limit = 50, offset = 0, filters = {}) {
    let where = '1=1';
    const params = [];

    if (filters.adminId) {
      where += ' AND admin_id = ?';
      params.push(filters.adminId);
    }
    if (filters.action) {
      where += ' AND action LIKE ?';
      params.push(`%${filters.action}%`);
    }
    if (filters.entityType) {
      where += ' AND entity_type = ?';
      params.push(filters.entityType);
    }
    if (filters.from) {
      where += ' AND created_at >= ?';
      params.push(filters.from);
    }
    if (filters.to) {
      where += ' AND created_at <= ?';
      params.push(filters.to);
    }
    if (filters.q) {
      where += ' AND (details LIKE ? OR action LIKE ?)';
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

    const total = db.prepare(`SELECT COUNT(*) as c FROM audit_log WHERE ${where}`).all(...params)[0].c;

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

- [ ] **Step 5: Run the test and verify it passes**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --test tests/services/auditService.test.js`
Expected: all three tests pass. No leftover seeded rows (each test calls `cleanup` in `finally`).

- [ ] **Step 6: Commit**

```bash
git add src/services/auditService.js tests/services/auditService.test.js
git commit -m "feat(audit): from/to/q filters + getEntityTypes helper

Extends getRecent to accept ISO-style created_at bounds plus a free-text
'q' that matches against (details LIKE ? OR action LIKE ?). New
getEntityTypes() returns the distinct non-null entity_type values
ordered ascending — powers the /admin/audit entity dropdown."
```

---

## Task 3: Gate audit route + accept new params + `/entity-types` endpoint

**Files:**
- Modify: `src/api/routes/admin/audit.js`

- [ ] **Step 1: Read current route**

Run: `cat src/api/routes/admin/audit.js`
Expected: ~20 lines, no `requirePermission`, no zod, only handles `adminId/action/entityType/page/limit`.

- [ ] **Step 2: Verify the validate helper pattern used elsewhere**

Run: `grep -n "const { validate" src/api/routes/admin/admins.js src/api/routes/admin/discounts.js src/api/routes/admin/products.js | head -3`
Expected: imports such as `const { validate } = require('../../middleware/validate');` (path may vary). Pick whichever path resolves; confirm with `ls src/api/middleware/`.

If `validate` middleware isn't trivially available for query strings, **skip zod** and parse manually (this route's params are all primitive — no nested objects). The plan uses manual parsing below to avoid coupling on the validate helper's exact shape.

- [ ] **Step 3: Replace `src/api/routes/admin/audit.js` with the gated + extended version**

Overwrite with this exact content:

```js
const { Router } = require('express');
const auditService = require('../../../services/auditService');
const { requirePermission } = require('../../middleware/auth');

const router = Router();

router.use(requirePermission('audit.read'));

// GET /admin/audit-log/entity-types
// Distinct entity_type values present in audit_log (for the filter dropdown).
router.get('/entity-types', (req, res) => {
  res.json({ success: true, data: auditService.getEntityTypes() });
});

// GET /admin/audit-log?adminId=&action=&entityType=&from=&to=&q=&page=1&limit=50
router.get('/', (req, res) => {
  const { adminId, action, entityType, from, to, q, page = 1, limit = 50 } = req.query;
  const parsedPage = Math.max(1, parseInt(page) || 1);
  const parsedLimit = Math.min(200, Math.max(1, parseInt(limit) || 50));
  const offset = (parsedPage - 1) * parsedLimit;
  const trimmedQ = typeof q === 'string' ? q.trim().slice(0, 200) : null;

  const result = auditService.getRecent(parsedLimit, offset, {
    adminId: adminId ? parseInt(adminId) : null,
    action: typeof action === 'string' && action.trim() ? action.trim() : null,
    entityType: typeof entityType === 'string' && entityType.trim() ? entityType.trim() : null,
    from: typeof from === 'string' && from.trim() ? from.trim() : null,
    to: typeof to === 'string' && to.trim() ? to.trim() : null,
    q: trimmedQ || null,
  });

  res.json({
    success: true,
    data: result.rows,
    meta: { page: parsedPage, limit: parsedLimit, total: result.total },
  });
});

module.exports = router;
```

- [ ] **Step 4: Boot the API briefly and curl the route as super_admin**

Pre-req: API is running locally (`./dev-all.sh` from repo root, or `npm run dev` on its own).

Run:
```bash
# Replace <TOKEN> with a valid super_admin admin JWT (from localStorage adminToken
# in your browser session after /admin/login).
TOKEN="<TOKEN>"
curl -sS -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/api/v1/admin/audit-log?limit=2' | head -c 400
echo
curl -sS -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/api/v1/admin/audit-log/entity-types' | head -c 400
```

Expected: first call returns `{"success":true,"data":[…2 rows…],"meta":{"page":1,"limit":2,"total":<N>}}`. Second call returns `{"success":true,"data":[<list of strings>]}`.

- [ ] **Step 5: Verify 403 for a non-super_admin token**

Run (with an `admin`-role JWT, not super_admin):
```bash
curl -sS -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $ADMIN_TOKEN" 'http://localhost:3000/api/v1/admin/audit-log'
```
Expected: `403`. If you don't have a non-super_admin to test, skip — the gate logic is exercised by other admin-routes' tests already; the regression risk is low.

- [ ] **Step 6: Commit**

```bash
git add src/api/routes/admin/audit.js
git commit -m "feat(audit): gate /admin/audit-log by audit.read; from/to/q + /entity-types

requirePermission('audit.read') restricts the route to super_admin (whose
permissions resolve to ['*']). Accepts new from/to/q query params and
exposes GET /admin/audit-log/entity-types so the web filter dropdown can
populate without a hardcoded list."
```

---

## Task 4: Re-export `ClipboardList` icon

**Files:**
- Modify: `web/src/lib/icons.tsx`

- [ ] **Step 1: Verify current re-exports**

Run: `grep -n "ClipboardList" web/src/lib/icons.tsx`
Expected: no match (icon not yet exposed).

- [ ] **Step 2: Add the export**

Find the line in `web/src/lib/icons.tsx` that reads:

```ts
  ShieldOff,
} from 'lucide-react'
```

Replace it with:

```ts
  ShieldOff,
  ClipboardList,
} from 'lucide-react'
```

- [ ] **Step 3: Typecheck**

Run: `cd web && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/icons.tsx
git commit -m "chore(web): re-export ClipboardList icon for audit page nav"
```

---

## Task 5: Add `audit` helper + `AuditRow` type to `web/src/lib/api.ts`

**Files:**
- Modify: `web/src/lib/api.ts`

- [ ] **Step 1: Read current file**

Run: `cat web/src/lib/api.ts`
Expected: file ends with `export const templates = { ... }` at ~line 108.

- [ ] **Step 2: Append the audit helper and type**

Append to the **end** of `web/src/lib/api.ts`:

```ts

export interface AuditRow {
  id: number
  admin_id: number | null
  admin_name: string | null
  action: string
  entity_type: string | null
  entity_id: number | null
  details: string | null
  ip_address: string | null
  created_at: string
}

export interface AuditListParams {
  adminId?: number
  action?: string
  entityType?: string
  from?: string
  to?: string
  q?: string
  page?: number
  limit?: number
}

export const audit = {
  list: (params: AuditListParams = {}) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
    }
    const tail = qs.toString() ? `?${qs.toString()}` : ''
    return api.get<AuditRow[]>(`/admin/audit-log${tail}`)
  },
  entityTypes: () => api.get<string[]>('/admin/audit-log/entity-types'),
}
```

- [ ] **Step 3: Typecheck**

Run: `cd web && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "feat(web/api): audit helper + AuditRow / AuditListParams types"
```

---

## Task 6: `AuditDetailModal` component

**Files:**
- Create: `web/src/components/AuditDetailModal.tsx`

- [ ] **Step 1: Create the modal component**

Create `web/src/components/AuditDetailModal.tsx` with this exact content:

```tsx
'use client'

import { useEffect } from 'react'
import { X } from '@/lib/icons'
import type { AuditRow } from '@/lib/api'

interface Props {
  row: AuditRow | null
  onClose: () => void
}

function prettify(details: string | null) {
  if (!details) return '—'
  try {
    return JSON.stringify(JSON.parse(details), null, 2)
  } catch {
    return details
  }
}

export function AuditDetailModal({ row, onClose }: Props) {
  useEffect(() => {
    if (!row) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [row, onClose])

  if (!row) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Chi tiết audit log"
    >
      <div
        className="clay-card max-w-2xl w-full max-h-[80vh] overflow-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">
            {row.action}
            {row.entity_type ? ` · ${row.entity_type}${row.entity_id ? ` #${row.entity_id}` : ''}` : ''}
          </h2>
          <button onClick={onClose} className="clay-btn p-2" aria-label="Đóng">
            <X size={16} />
          </button>
        </div>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm mb-4">
          <dt className="opacity-60">Thời gian</dt>
          <dd>{new Date(row.created_at).toLocaleString('vi-VN')}</dd>
          <dt className="opacity-60">Admin</dt>
          <dd>{row.admin_name ?? '(system)'}</dd>
          <dt className="opacity-60">IP</dt>
          <dd>{row.ip_address ?? '—'}</dd>
        </dl>

        <h3 className="text-sm font-semibold mb-1">Details</h3>
        <pre className="text-xs bg-black/5 rounded-lg p-3 overflow-auto whitespace-pre-wrap break-words">
          {prettify(row.details)}
        </pre>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 3: Lint**

Run: `cd web && npx eslint src/components/AuditDetailModal.tsx`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AuditDetailModal.tsx
git commit -m "feat(admin): AuditDetailModal — pretty JSON view of audit row"
```

---

## Task 7: `/admin/audit` page

**Files:**
- Create: `web/src/app/(admin)/admin/audit/page.tsx`

- [ ] **Step 1: Create the directory and page file**

Run: `mkdir -p 'web/src/app/(admin)/admin/audit'`

Then create `web/src/app/(admin)/admin/audit/page.tsx` with this exact content:

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { api, audit } from '@/lib/api'
import type { AuditRow } from '@/lib/api'
import { AuditDetailModal } from '@/components/AuditDetailModal'
import { ChevronLeft, ChevronRight, X } from '@/lib/icons'

const ENTITY_NAV: Record<string, (id: number) => string> = {
  order:        (id) => `/admin/orders?highlight=${id}`,
  user:         (id) => `/admin/users?highlight=${id}`,
  product:      (id) => `/admin/products?highlight=${id}`,
  topup:        (id) => `/admin/topups?highlight=${id}`,
  category:     (id) => `/admin/categories?highlight=${id}`,
  admin:        (id) => `/admin/admins?highlight=${id}`,
  stock:        (id) => `/admin/stock?highlight=${id}`,
  discount:     (id) => `/admin/discounts?highlight=${id}`,
  announcement: ()   => `/admin/announcements`,
}

const PAGE_LIMIT = 50

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

interface AdminListRow { id: number; username: string; displayName: string }

export default function AuditPage() {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [adminId, setAdminId] = useState('')
  const [entityType, setEntityType] = useState('')
  const [page, setPage] = useState(1)
  const [modalRow, setModalRow] = useState<AuditRow | null>(null)

  const debouncedQ = useDebounced(q, 300)

  useEffect(() => { setPage(1) }, [debouncedQ, from, to, adminId, entityType])

  const adminsQuery = useQuery({
    queryKey: ['admin', 'admins-list-for-audit'],
    queryFn: () => api.get<AdminListRow[]>('/admin/admins'),
    staleTime: 5 * 60_000,
  })
  const admins = adminsQuery.data?.data ?? []

  const entityTypesQuery = useQuery({
    queryKey: ['admin', 'audit', 'entity-types'],
    queryFn: () => audit.entityTypes(),
    staleTime: 5 * 60_000,
  })
  const entityTypes = entityTypesQuery.data?.data ?? []

  const listQuery = useQuery({
    queryKey: ['admin', 'audit', 'list', { q: debouncedQ, from, to, adminId, entityType, page }],
    queryFn: () => audit.list({
      q: debouncedQ || undefined,
      from: from ? from.replace('T', ' ') + ':00' : undefined,
      to:   to   ? to.replace('T', ' ')   + ':59' : undefined,
      adminId: adminId ? Number(adminId) : undefined,
      entityType: entityType || undefined,
      page,
      limit: PAGE_LIMIT,
    }),
    staleTime: 30_000,
  })
  const rows = listQuery.data?.data ?? []
  const total = listQuery.data?.meta?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT))

  const filtersActive = useMemo(
    () => !!(q || from || to || adminId || entityType),
    [q, from, to, adminId, entityType]
  )

  function reset() {
    setQ(''); setFrom(''); setTo(''); setAdminId(''); setEntityType(''); setPage(1)
  }

  function handleRowClick(row: AuditRow) {
    const builder = row.entity_type ? ENTITY_NAV[row.entity_type] : undefined
    if (builder && row.entity_id !== null) {
      router.push(builder(row.entity_id))
      return
    }
    if (builder) {
      router.push(builder(0))
      return
    }
    setModalRow(row)
  }

  function truncate(s: string | null, n: number) {
    if (!s) return '—'
    return s.length > n ? s.slice(0, n) + '…' : s
  }

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-2xl font-semibold mb-4">Lịch sử</h1>

      <div className="clay-card p-3 mb-4 grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_1fr_max-content]">
        <input
          type="search"
          placeholder="Tìm theo action hoặc details…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="clay-input"
          aria-label="Tìm kiếm"
        />
        <input
          type="datetime-local"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="clay-input"
          aria-label="Từ"
        />
        <input
          type="datetime-local"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="clay-input"
          aria-label="Đến"
        />
        <select
          value={adminId}
          onChange={(e) => setAdminId(e.target.value)}
          className="clay-input"
          aria-label="Admin"
        >
          <option value="">Tất cả admin</option>
          {admins.map(a => (
            <option key={a.id} value={a.id}>{a.displayName || a.username}</option>
          ))}
        </select>
        <select
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          className="clay-input"
          aria-label="Entity"
        >
          <option value="">Tất cả entity</option>
          {entityTypes.map(et => (
            <option key={et} value={et}>{et}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={reset}
          className="clay-btn flex items-center gap-1"
          disabled={!filtersActive}
        >
          <X size={14} /> Xoá lọc
        </button>
      </div>

      <div className="clay-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left opacity-70">
            <tr>
              <th className="px-3 py-2">Thời gian</th>
              <th className="px-3 py-2">Admin</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Entity</th>
              <th className="px-3 py-2">Chi tiết</th>
              <th className="px-3 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {listQuery.isLoading && (
              <tr><td colSpan={6} className="px-3 py-6 text-center opacity-60">Đang tải…</td></tr>
            )}
            {!listQuery.isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center opacity-60">Không có bản ghi.</td></tr>
            )}
            {rows.map(row => (
              <tr
                key={row.id}
                onClick={() => handleRowClick(row)}
                className="border-t border-black/5 hover:bg-black/[0.02] cursor-pointer"
              >
                <td className="px-3 py-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString('vi-VN')}</td>
                <td className="px-3 py-2">{row.admin_name ?? '(system)'}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-black/5">
                    {row.action}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {row.entity_type ?? '—'}
                  {row.entity_id !== null ? ` #${row.entity_id}` : ''}
                </td>
                <td className="px-3 py-2 max-w-[420px]">{truncate(row.details, 80)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.ip_address ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3 text-sm opacity-80">
        <div>Tổng {total} bản ghi · Trang {page}/{totalPages}</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || listQuery.isLoading}
            className="clay-btn p-2"
            aria-label="Trang trước"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || listQuery.isLoading}
            className="clay-btn p-2"
            aria-label="Trang sau"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <AuditDetailModal row={modalRow} onClose={() => setModalRow(null)} />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd web && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Lint**

Run: `cd web && npx eslint 'src/app/(admin)/admin/audit/page.tsx'`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add 'web/src/app/(admin)/admin/audit/page.tsx'
git commit -m "feat(admin): /admin/audit page with filter bar, table, modal, pagination

Filters: q (debounced 300ms), from/to (datetime-local), adminId, entityType.
Row click → push to admin entity list when entity_type maps to a known
route, otherwise open AuditDetailModal showing pretty JSON of details."
```

---

## Task 8: Sidebar entry

**Files:**
- Modify: `web/src/components/AdminSidebar.tsx`

- [ ] **Step 1: Read current sidebar nav array**

Run: `sed -n '1,40p' web/src/components/AdminSidebar.tsx`
Expected: imports include `ShieldCheck, Ticket, KeyRound` from `@/lib/icons`. `NAV` array ends with `{ href: '/admin/profile', label: 'Bảo mật', icon: KeyRound }`.

- [ ] **Step 2: Add `ClipboardList` to the icon import**

Find this line in `web/src/components/AdminSidebar.tsx`:

```ts
import { BarChart3, Receipt, Package, Boxes, Megaphone, Settings, LogOut, Users, Wallet, X, MessageSquare, ShieldCheck, Ticket, KeyRound } from '@/lib/icons'
```

Replace with:

```ts
import { BarChart3, Receipt, Package, Boxes, Megaphone, Settings, LogOut, Users, Wallet, X, MessageSquare, ShieldCheck, Ticket, KeyRound, ClipboardList } from '@/lib/icons'
```

- [ ] **Step 3: Add the nav entry**

Find this line in the `NAV` array:

```ts
  { href: '/admin/profile', label: 'Bảo mật', icon: KeyRound },
```

Add a new entry directly **before** it (so "Lịch sử" sits between settings and the user's profile/security shortcut):

```ts
  { href: '/admin/audit', label: 'Lịch sử', icon: ClipboardList, perm: 'audit.read' },
  { href: '/admin/profile', label: 'Bảo mật', icon: KeyRound },
```

The existing `hasPerm` helper (already in this file) skips entries when `perms.includes(perm)` is false (unless user has `'*'`). super_admin will see the link; admin/manager will not.

- [ ] **Step 4: Typecheck**

Run: `cd web && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Lint**

Run: `cd web && npx eslint src/components/AdminSidebar.tsx`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/AdminSidebar.tsx
git commit -m "feat(admin): sidebar 'Lịch sử' link to /admin/audit (audit.read)"
```

---

## Task 9: Verification — build + manual smoke

**Files:** (no edits)

- [ ] **Step 1: Web production build**

Run: `cd web && source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && npm run build`
Expected: build completes; route table includes `/admin/audit` as a static (`○`) route. No TypeScript errors.

- [ ] **Step 2: Backend test re-run (regression check)**

Run: `source ~/.nvm/nvm.sh && nvm use 22 >/dev/null && node --test tests/services/auditService.test.js`
Expected: 3/3 tests pass.

- [ ] **Step 3: Start the stack**

Run: `./dev-all.sh` (or `npm run dev:all` from repo root).
Expected: mbbank on :8000, api on :3000, web on :3001 — all "ready" lines visible.

- [ ] **Step 4: Manual — sidebar visibility**

In a browser, log in as super_admin at `http://localhost:3001/admin/login`. Verify the sidebar shows "Lịch sử" between Cài đặt and Bảo mật. Click → lands on `/admin/audit`.

If a non-super_admin account exists, log in as that role and verify "Lịch sử" is hidden, AND visiting `/admin/audit` directly results in 403 from the backend (`/admin/audit-log` returns FORBIDDEN, list query errors out, the table empty state shows).

- [ ] **Step 5: Manual — filter narrowing**

On `/admin/audit` as super_admin:
- Type a known action substring (e.g. `product.update`) in the search field; table narrows after 300ms debounce.
- Set `from` to yesterday's date at 00:00 and `to` to today at 23:59; only today's entries show.
- Pick an admin from the dropdown; only their rows show.
- Click "Xoá lọc"; full list returns.

- [ ] **Step 6: Manual — row click navigation**

Click an `order`-type row → URL changes to `/admin/orders?highlight=<id>` (destination doesn't honor `highlight` yet — that's expected, follow-up).
Click a `settings`-type row (no entry in `ENTITY_NAV`) → AuditDetailModal opens showing pretty JSON.
Press Escape → modal closes.
Click outside the modal card → modal closes.

- [ ] **Step 7: Stop the stack**

Use `Ctrl+C` in the terminal running `./dev-all.sh`, or:
```bash
lsof -ti :3000 :3001 :8000 | xargs kill -9 2>/dev/null; true
```

- [ ] **Step 8: Final smoke commit (only if fix-ups landed)**

If steps 1–6 surfaced no issues, **skip this step**. If anything needed a touch-up:

```bash
git add <touched files>
git commit -m "fix(audit): <specific issue from manual verification>"
```

---

## Notes for the executing subagent

- Backend tests use Node native `node:test` — no Jest/Vitest setup needed. Run with `node --test tests/services/auditService.test.js`.
- `web/` has no test runner; do not add one for this work. `next build` + manual smoke is the verification path.
- Stay strictly within the file list above. If a tangential issue appears (e.g., the `(admin)` layout needs a redirect for users lacking `audit.read`), open a follow-up — do not include it here.
- The `clay-card`, `clay-input`, `clay-btn` class names used in the page and modal are project conventions defined in `web/src/app/globals.css`. They already exist; reuse, don't introduce new variants.
- Working directory: `/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot`. Node 22 (`source ~/.nvm/nvm.sh && nvm use 22 >/dev/null`) before any shell command that runs node/npm.
- Current branch is `feat/v0.33-admin-stock-poller`. Create a topic branch `feat/admin-audit-page` off the current head before Task 1.
