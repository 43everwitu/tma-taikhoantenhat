# Audit Log History Page Design Spec

**Date:** 2026-05-20
**Status:** Approved, awaiting implementation plan.
**Owner:** peanut

## Goal

Give super_admin a browsable history of every CRUD-style action recorded in `audit_log`, filterable by admin, action, entity type, date range, and free-text search. Click a row to jump to the affected entity's admin page when one exists.

## Why now

- Backend already logs ~45 distinct mutation points (`auditService.log` calls across 16 files) into the `audit_log` table.
- No admin UI exists to read this data. Super_admin must `sqlite3` directly to investigate incidents.
- The `/admin/audit-log` route exists but is **ungated** (any logged-in admin can hit it) and lacks date/text filters.

## Non-goals

- Before/after diffs for updates. The current `details` field stores only the validated request body (the delta admin sent), not pre-state. Capturing pre-state would require a service-layer rewrite — out of scope.
- Export to CSV/JSON. Not requested.
- Auto-purge / retention. Logs kept indefinitely; if volume becomes an issue, revisit later.
- Highlight-on-arrival on destination pages. Linked navigation drops the admin into the correct list page; scroll/highlight on that page is a follow-up.

## Approach

One PR. Backend tweak (permission gate + filter params) + new web page + sidebar link.

## Architecture

```
[Browser] /admin/audit
   |
   v
GET /api/v1/admin/audit-log?from=...&to=...&q=...&adminId=...&entityType=...&action=...&page=&limit=
   |
   v
src/api/routes/admin/audit.js (requirePermission 'audit.read')
   |
   v
auditService.getRecent(limit, offset, { adminId, action, entityType, from, to, q })
   |
   v
SELECT al.*, a.display_name AS admin_name
FROM audit_log al
LEFT JOIN admins a ON al.admin_id = a.id
WHERE filters
ORDER BY al.created_at DESC
LIMIT ? OFFSET ?
```

Row navigation lives entirely in the React page — clicking a row pushes a Next.js route based on `entity_type`.

---

## Backend changes

### `src/services/permissionService.js`

No code edit. `super_admin` has `'*'` wildcard which auto-satisfies `audit.read`. `admin` and `manager` ROLE_PERMS lists do not include `audit.*` → they get 403. Intentional: super_admin only.

### `src/api/routes/admin/audit.js`

- Add `router.use(requirePermission('audit.read'))` to gate the entire mount.
- Validate query params with zod: `from` (optional ISO datetime), `to` (optional ISO datetime), `q` (optional string ≤ 200), plus the existing `adminId/action/entityType/page/limit`.
- Pass to `auditService.getRecent`.
- Add `GET /entity-types` endpoint returning the distinct list of `entity_type` values present in `audit_log` (powers the filter dropdown without duplicating the list on the client).

### `src/services/auditService.js`

`getRecent(limit, offset, filters)` extends `filters` to accept:
- `from` — ISO string; compared as `created_at >= ?`.
- `to` — ISO string; compared as `created_at <= ?`.
- `q` — adds `(details LIKE ? OR action LIKE ?)` with `%q%`.

Also adds `getEntityTypes()` → `string[]` returning `SELECT DISTINCT entity_type FROM audit_log WHERE entity_type IS NOT NULL ORDER BY entity_type`.

### Migration `031_audit_index.js`

- `CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at DESC);`

No permissions JSON cleanup needed (no admin/manager ever had `audit.*` so nothing to remove).

---

## Web changes

Path uses Next.js route group `(admin)`:

- `web/src/app/(admin)/admin/audit/page.tsx`
- `web/src/components/AuditDetailModal.tsx`

### `web/src/lib/api.ts`

Add types + helper:

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

export const audit = {
  list: (params: {
    adminId?: number
    action?: string
    entityType?: string
    from?: string
    to?: string
    q?: string
    page?: number
    limit?: number
  }) => {
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

### `web/src/app/(admin)/admin/audit/page.tsx`

Sticky filter bar across the top:

| Control | Field | Bound to |
|---|---|---|
| Search input | `q` | debounced 300 ms |
| Date `from` | `<input type="datetime-local">` | `from` (ISO string) |
| Date `to` | `<input type="datetime-local">` | `to` |
| Admin select | dropdown from `/admin/admins` | `adminId` |
| Entity select | dropdown from `/admin/audit-log/entity-types` | `entityType` |
| Reset button | clears all filters | — |

Table:

| Col | Render |
|---|---|
| Thời gian | `new Date(row.created_at).toLocaleString('vi')` |
| Admin | `row.admin_name ?? '(system)'` |
| Action | `row.action` as pill |
| Entity | `row.entity_type` + `row.entity_id` |
| Chi tiết | Truncated 80 chars of `details`; click row → expand modal showing pretty JSON |
| IP | `row.ip_address ?? '—'` |

Row click behavior:
1. If `entity_type` maps to a known admin page → `router.push(targetUrl)`.
2. Otherwise → open the "Chi tiết" expand modal.

Mapping table (entity_type → URL):

```ts
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
```

Destination pages do not yet honor `?highlight=`. They will land at the list; users still benefit from the right page. Adding highlight-and-scroll is a follow-up.

Pagination footer reuses the stock page pattern.

### `web/src/components/AdminSidebar.tsx`

New nav entry, placed at the end of the existing list (after `admins`):

```ts
{ href: '/admin/audit', label: 'Lịch sử', icon: ClipboardList, perm: 'audit.read' }
```

Icon `ClipboardList` from lucide-react via `@/lib/icons`. Add to the icons re-export if not already present.

---

## File summary

| Action | Path | Reason |
|---|---|---|
| Create | `src/database/migrations/031_audit_index.js` | Index on `audit_log.created_at` |
| Modify | `src/api/routes/admin/audit.js` | Gate by `audit.read`; accept `from/to/q`; add `/entity-types` endpoint |
| Modify | `src/services/auditService.js` | `getRecent` accepts `from/to/q`; add `getEntityTypes()` |
| Modify | `web/src/lib/api.ts` | `audit` helper + `AuditRow` type |
| Create | `web/src/app/(admin)/admin/audit/page.tsx` | History list with filters |
| Create | `web/src/components/AuditDetailModal.tsx` | Expand modal showing pretty JSON of `details` |
| Modify | `web/src/components/AdminSidebar.tsx` | Add "Lịch sử" link gated by `audit.read` |
| Modify | `web/src/lib/icons.ts` (if needed) | Re-export ClipboardList icon |

---

## Testing

- Backend: `tests/services/auditService.test.js` covers `getRecent` filters (`from/to/q/adminId/entityType`) and `getEntityTypes()` on a seeded set of audit rows.
- Manual: visit `/admin/audit` as super_admin. Confirm filters narrow rows. Click an `order` row → lands on `/admin/orders` with the right query string. Click a `settings` row → opens detail modal (no nav).
- Manual: log in as a non-super_admin without override → sidebar shows no "Lịch sử" link. Hitting `/admin/audit-log` directly → 403.

---

## Risks

- **Permission migration semantics:** existing admins (manager/admin) don't have `audit.read`. That is intentional — super_admin only.
- **Details column may contain secrets:** existing `auditService.log` call sites — anything sensitive (passwords, totp secrets) is already hashed/redacted before being passed in. Confirm by grep before exposing raw JSON in the UI. If a redaction layer is needed, add `redactDetails(action, details)` helper called in the route's response shaper.
- **Index cost:** the `idx_audit_created_at` index is required so date-range scans don't table-walk.

## Out of scope (future)

- Highlight-and-scroll on destination list pages.
- Export CSV/JSON.
- Pre-state snapshots for diffs.
- Time-bucketed analytics ("how many discount.update actions per day").
