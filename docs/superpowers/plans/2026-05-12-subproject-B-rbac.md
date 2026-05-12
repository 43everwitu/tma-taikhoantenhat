# Sub-project B: RBAC (Roles + Manager Creation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** Two roles (`super_admin`, `manager`) with permission catalog. super_admin creates managers via `/admin/admins`. Manager defaults exclude `dashboard.read`, `settings.*`, `admins.*`, `topups.*`. Middleware `requirePermission` gates routes. `/admin/me` returns resolved perms for UI filtering.

**Architecture:** Migration 017 adds `permissions TEXT` (JSON) on admins for per-row overrides. `permissionService` resolves `permissions || rolePermissions[role]`. JWT keeps `role` only; perms resolved server-side per request. Sidebar fetches `/admin/me` and filters items.

---

## Tasks

### Task 1: Migration 017 + permissionService

**Files:**
- Create: `src/database/migrations/017_admin_permissions.js`
- Create: `src/services/permissionService.js`
- Create: `tests/services/permissionService.test.js`

- [ ] Step 1: Migration adds `permissions TEXT` (NULL = use role defaults):

```js
function hasColumn(db, table, column) {
  return db.pragma(`table_info(${table})`).some(c => c.name === column);
}

function up(db) {
  if (!hasColumn(db, 'admins', 'permissions')) {
    db.exec(`ALTER TABLE admins ADD COLUMN permissions TEXT`);
  }
}

module.exports = { up };
```

- [ ] Step 2: `src/services/permissionService.js`:

```js
const ROLE_PERMS = {
  super_admin: ['*'],
  manager: [
    'products.read', 'products.write',
    'orders.read', 'orders.write',
    'stock.read', 'stock.write',
    'users.read',
    'announcements.read', 'announcements.write',
    'messages.read',
    'categories.read', 'categories.write',
  ],
  admin: [
    'products.read', 'products.write',
    'orders.read', 'orders.write',
    'stock.read', 'stock.write',
    'dashboard.read',
    'users.read', 'users.write',
    'announcements.read', 'announcements.write',
    'messages.read', 'messages.write',
    'settings.read', 'settings.write',
    'categories.read', 'categories.write',
    'topups.read', 'topups.write',
  ],
};

function resolvePerms(admin) {
  if (!admin) return [];
  if (admin.permissions) {
    try { return JSON.parse(admin.permissions); } catch { return ROLE_PERMS[admin.role] || []; }
  }
  return ROLE_PERMS[admin.role] || [];
}

function has(admin, perm) {
  const perms = resolvePerms(admin);
  return perms.includes('*') || perms.includes(perm);
}

module.exports = { ROLE_PERMS, resolvePerms, has };
```

- [ ] Step 3: Tests:

```js
const test = require('node:test');
const assert = require('node:assert');
const { resolvePerms, has, ROLE_PERMS } = require('../../src/services/permissionService');

test('super_admin has all (* wildcard)', () => {
  assert.deepEqual(resolvePerms({ role: 'super_admin' }), ['*']);
  assert.equal(has({ role: 'super_admin' }, 'anything.you.want'), true);
});

test('manager has product/order/stock but not dashboard or settings', () => {
  const m = { role: 'manager' };
  assert.equal(has(m, 'products.write'), true);
  assert.equal(has(m, 'orders.read'), true);
  assert.equal(has(m, 'dashboard.read'), false);
  assert.equal(has(m, 'settings.write'), false);
  assert.equal(has(m, 'admins.write'), false);
});

test('permissions column override beats role defaults', () => {
  const customAdmin = { role: 'manager', permissions: JSON.stringify(['products.read']) };
  assert.deepEqual(resolvePerms(customAdmin), ['products.read']);
  assert.equal(has(customAdmin, 'products.read'), true);
  assert.equal(has(customAdmin, 'products.write'), false);
});

test('invalid JSON in permissions falls back to role defaults', () => {
  const broken = { role: 'manager', permissions: 'not json' };
  assert.deepEqual(resolvePerms(broken), ROLE_PERMS.manager);
});

test('null admin returns empty perms', () => {
  assert.deepEqual(resolvePerms(null), []);
  assert.equal(has(null, 'anything'), false);
});
```

- [ ] Step 4: Run migration + tests:
```
touch src/index.js && sleep 3
sqlite3 data/shop.db "SELECT name FROM migrations ORDER BY id DESC LIMIT 2"
sqlite3 data/shop.db "SELECT COUNT(*) FROM pragma_table_info('admins') WHERE name='permissions'"
source ~/.nvm/nvm.sh && nvm use 20 && node --test tests/services/permissionService.test.js 2>&1 | tail -10
```
Expected: top migration is `017_admin_permissions.js`, column count 1, 5/5 tests pass.

- [ ] Step 5: Commit:
```
git add src/database/migrations/017_admin_permissions.js src/services/permissionService.js tests/services/permissionService.test.js
git commit -m "feat(rbac): migration 017 + permissionService with role defaults"
```

### Task 2: requirePermission middleware + /admin/me endpoint + admins CRUD

**Files:**
- Modify: `src/api/middleware/auth.js` (add `requirePermission`)
- Create: `src/api/routes/admin/me.js`
- Create: `src/api/routes/admin/admins.js`
- Modify: `src/api/routes/admin/index.js` (mount + apply guards)

- [ ] Step 1: Append to `src/api/middleware/auth.js`:

```js
const permissionService = require('../../services/permissionService');
const db = require('../../database');

function loadAdminPermissions(req, res, next) {
  if (!req.admin?.adminId) return next();
  const row = db.prepare('SELECT id, role, permissions FROM admins WHERE id = ? AND is_active = 1').get(req.admin.adminId);
  if (!row) return res.status(401).json({ success: false, error: { code: 'ADMIN_INACTIVE' } });
  req.admin.role = row.role;
  req.admin.permissions = row.permissions;
  req.admin.perms = permissionService.resolvePerms(row);
  next();
}

function requirePermission(perm) {
  return (req, res, next) => {
    if (!permissionService.has(req.admin, perm)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: `Yêu cầu quyền ${perm}` } });
    }
    next();
  };
}

module.exports = { ...module.exports, requirePermission, loadAdminPermissions };
```

(`module.exports = { ...module.exports, ... }` extends the existing export — works because JS evaluates `module.exports` lazily. If that syntax is awkward, replace the whole `module.exports = {...}` line at the bottom of the file with one that includes the new exports.)

- [ ] Step 2: Apply `loadAdminPermissions` after `requireAdmin` globally so all admin routes have `req.admin.perms` populated. In `src/api/server.js` (where the admin router is mounted):
```js
router.use('/admin', adminLimiter, requireAdmin, loadAdminPermissions, auditLog, require('./routes/admin'));
```
(Add `loadAdminPermissions` between `requireAdmin` and `auditLog`. Import it from `./middleware/auth`.)

- [ ] Step 3: `src/api/routes/admin/me.js`:

```js
const { Router } = require('express');
const router = Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      adminId: req.admin.adminId,
      role: req.admin.role,
      username: req.admin.username,
      permissions: req.admin.perms,
    },
  });
});

module.exports = router;
```

- [ ] Step 4: `src/api/routes/admin/admins.js` (super_admin only):

```js
const { Router } = require('express');
const { z } = require('zod');
const bcrypt = require('bcrypt');
const db = require('../../../database');
const auditService = require('../../../services/auditService');
const permissionService = require('../../../services/permissionService');
const { validate } = require('../../middleware/validate');
const { requirePermission } = require('../../middleware/auth');

const router = Router();

router.use(requirePermission('admins.read'));

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT id, username, display_name, role, is_active, last_login_at, created_at, permissions
      FROM admins ORDER BY id
  `).all();
  res.json({
    success: true,
    data: rows.map(r => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
      role: r.role,
      isActive: !!r.is_active,
      lastLoginAt: r.last_login_at,
      createdAt: r.created_at,
      permissions: permissionService.resolvePerms(r),
    })),
  });
});

router.post('/', requirePermission('admins.write'), validate(z.object({
  username: z.string().min(3).max(50),
  password: z.string().min(6).max(100),
  displayName: z.string().min(1).max(100),
  role: z.enum(['super_admin', 'manager', 'admin']),
})), async (req, res) => {
  const { username, password, displayName, role } = req.validated;
  const hash = await bcrypt.hash(password, 10);
  try {
    const r = db.prepare(`
      INSERT INTO admins (username, password_hash, display_name, role)
      VALUES (?, ?, ?, ?)
    `).run(username, hash, displayName, role);
    auditService.log(req.admin.adminId, 'admin.create', 'admin', r.lastInsertRowid, { role }, req.ip);
    res.status(201).json({ success: true, data: { id: r.lastInsertRowid } });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ success: false, error: { code: 'USERNAME_TAKEN' } });
    }
    throw err;
  }
});

router.patch('/:id', requirePermission('admins.write'), validate(z.object({
  role: z.enum(['super_admin', 'manager', 'admin']).optional(),
  isActive: z.boolean().optional(),
  password: z.string().min(6).max(100).optional(),
  displayName: z.string().min(1).max(100).optional(),
})), async (req, res) => {
  const id = parseInt(req.params.id);
  const sets = [];
  const params = [];
  if (req.validated.role !== undefined) { sets.push('role = ?'); params.push(req.validated.role); }
  if (req.validated.isActive !== undefined) { sets.push('is_active = ?'); params.push(req.validated.isActive ? 1 : 0); }
  if (req.validated.displayName !== undefined) { sets.push('display_name = ?'); params.push(req.validated.displayName); }
  if (req.validated.password !== undefined) {
    sets.push('password_hash = ?');
    params.push(await bcrypt.hash(req.validated.password, 10));
  }
  if (sets.length === 0) return res.json({ success: true, data: { changes: 0 } });
  params.push(id);
  const r = db.prepare(`UPDATE admins SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  auditService.log(req.admin.adminId, 'admin.update', 'admin', id, { fields: Object.keys(req.validated) }, req.ip);
  res.json({ success: true, data: { changes: r.changes } });
});

module.exports = router;
```

- [ ] Step 5: Mount in `src/api/routes/admin/index.js`:
```js
router.use('/me', require('./me'));
router.use('/admins', require('./admins'));
```

- [ ] Step 6: Verify:
```
touch src/index.js && sleep 4
node -e "
require('dotenv').config();
async function go() {
  const tok = (await (await fetch('http://localhost:3000/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:process.env.ADMIN_INITIAL_PASSWORD})})).json()).data.token;
  const me = await (await fetch('http://localhost:3000/api/v1/admin/me', {headers:{Authorization:'Bearer '+tok}})).json();
  console.log('me:', JSON.stringify(me));
  const admins = await (await fetch('http://localhost:3000/api/v1/admin/admins', {headers:{Authorization:'Bearer '+tok}})).json();
  console.log('admins.length:', admins.data?.length);
}
go();
"
```
Expected: `/admin/me` returns `{adminId, role:'super_admin', username:'admin', permissions:['*']}` (or similar). `/admin/admins` lists admins.

- [ ] Step 7: Commit:
```
git add src/api/middleware/auth.js src/api/server.js src/api/routes/admin/me.js src/api/routes/admin/admins.js src/api/routes/admin/index.js
git commit -m "feat(rbac): /admin/me, /admin/admins CRUD, requirePermission middleware"
```

### Task 3: Frontend — /admin/admins page + sidebar filter by /admin/me

**Files:**
- Modify: `web/src/components/AdminSidebar.tsx` (filter by perms)
- Create: `web/src/app/(admin)/admin/admins/page.tsx`

- [ ] Step 1: Modify AdminSidebar. Read it. The NAV array currently includes feature-gated items. Extend each item with an optional `perm` field:

```tsx
{ href: '/admin/dashboard', label: 'Tổng quan', icon: BarChart3, perm: 'dashboard.read' },
{ href: '/admin/orders', label: 'Đơn hàng', icon: Receipt, perm: 'orders.read' },
{ href: '/admin/products', label: 'Sản phẩm', icon: Package, perm: 'products.read' },
{ href: '/admin/stock', label: 'Kho', icon: Boxes, perm: 'stock.read' },
{ href: '/admin/users', label: 'Người dùng', icon: Users, perm: 'users.read' },
{ href: '/admin/admins', label: 'Quản trị', icon: ShieldCheck, perm: 'admins.read' },
{ href: '/admin/topups', label: 'Nạp tiền', icon: Wallet, feature: 'topups', perm: 'topups.read' },
{ href: '/admin/announcements', label: 'Thông báo', icon: Megaphone, perm: 'announcements.read' },
{ href: '/admin/messages', label: 'Tin nhắn', icon: MessageSquare, feature: 'broadcast', perm: 'messages.read' },
{ href: '/admin/settings', label: 'Cài đặt', icon: Settings, perm: 'settings.read' },
```

(Add `import { ShieldCheck } from 'lucide-react'` or equivalent from `@/lib/icons`.)

Add `me` query:
```tsx
const meQuery = useQuery({
  queryKey: ['admin', 'me'],
  queryFn: () => api.get<{ permissions: string[] }>('/admin/me'),
  staleTime: 5 * 60 * 1000,
})
const perms = meQuery.data?.data.permissions ?? []
const hasPerm = (p?: string) => !p || perms.includes('*') || perms.includes(p)
```

In the filter:
```tsx
NAV.filter((it) => hasPerm(it.perm) && (!('feature' in it) || features[it.feature as keyof typeof features]))
```

- [ ] Step 2: Create `web/src/app/(admin)/admin/admins/page.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface Admin {
  id: number
  username: string
  displayName: string
  role: string
  isActive: boolean
  lastLoginAt: string | null
  permissions: string[]
}

export default function AdminsPage() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'admins'],
    queryFn: () => api.get<Admin[]>('/admin/admins'),
  })
  const admins = data?.data ?? []
  const [createOpen, setCreateOpen] = useState(false)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="clay-display text-3xl">Quản trị viên</h1>
        <button onClick={() => setCreateOpen(true)} className="clay-btn clay-btn--lemon text-sm">+ Tạo mới</button>
      </div>

      <div className="space-y-2">
        {isLoading && <p className="text-sm opacity-60">Đang tải…</p>}
        {admins.map((a) => (
          <div key={a.id} className="rounded-xl bg-white border border-clay-oat p-3 flex items-center gap-3">
            <div className="flex-1">
              <p className="font-medium text-sm">{a.displayName} <span className="opacity-60 font-normal">@{a.username}</span></p>
              <p className="text-xs opacity-60">{a.role} · {a.isActive ? 'Hoạt động' : 'Đã khoá'} · {a.permissions.length} quyền</p>
            </div>
            <button
              onClick={() => {
                if (!confirm(`${a.isActive ? 'Khoá' : 'Mở khoá'} ${a.username}?`)) return
                api.patch(`/admin/admins/${a.id}`, { isActive: !a.isActive }).then(() => qc.invalidateQueries({ queryKey: ['admin', 'admins'] }))
              }}
              className="clay-btn text-xs"
            >
              {a.isActive ? 'Khoá' : 'Mở'}
            </button>
          </div>
        ))}
      </div>

      {createOpen && <CreateModal onClose={() => setCreateOpen(false)} onCreated={() => { qc.invalidateQueries({ queryKey: ['admin', 'admins'] }); setCreateOpen(false) }} />}
    </div>
  )
}

function CreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ username: '', password: '', displayName: '', role: 'manager' as 'manager' | 'admin' | 'super_admin' })
  const [err, setErr] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: () => api.post('/admin/admins', form),
    onSuccess: onCreated,
    onError: (e) => setErr(e instanceof Error ? e.message : 'Lỗi'),
  })
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3">
        <h2 className="text-lg font-semibold">Tạo quản trị mới</h2>
        <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Tên đăng nhập" className="clay-input w-full text-sm" />
        <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Mật khẩu" className="clay-input w-full text-sm" />
        <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} placeholder="Tên hiển thị" className="clay-input w-full text-sm" />
        <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as typeof form.role })} className="clay-input w-full text-sm">
          <option value="manager">manager (không có quyền xem doanh thu / settings)</option>
          <option value="admin">admin</option>
          <option value="super_admin">super_admin (toàn quyền)</option>
        </select>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="clay-btn text-sm">Huỷ</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.username || !form.password} className="clay-btn clay-btn--lemon text-sm">
            {mutation.isPending ? 'Đang tạo…' : 'Tạo'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] Step 3: Verify + commit:
```
cd web && npx tsc --noEmit 2>&1 | tail -3
cd "/Users/peanut/Users/peanut/Project Local/taikhoantenhat-bot"
git add web/src/components/AdminSidebar.tsx web/src/app/\(admin\)/admin/admins/page.tsx
git commit -m "feat(admin): /admin/admins page + sidebar perm-based filtering"
```

### Task 4: Tag

```
git tag v0.14-rbac -m "Sub-project B: RBAC — roles, permissions, /admin/admins"
```

---

## Self-Review

- B1 schema + migration → Task 1
- B2 permissionService → Task 1
- B3 requirePermission middleware → Task 2
- B4 /admin/me → Task 2
- B5 admins CRUD → Task 2
- B6 admin management UI → Task 3
- B7 sidebar perm filter → Task 3
