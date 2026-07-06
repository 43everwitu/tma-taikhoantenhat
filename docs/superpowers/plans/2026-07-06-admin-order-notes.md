# Admin Order Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add internal multi-note support to admin order management with a quick row popover and full note CRUD in the existing order detail drawer.

**Architecture:** Store notes in a normalized `order_notes` table linked to `orders` and `admins`. Enrich existing admin order list/detail DTOs with note summary/detail data, then add focused React state/components inside `web/src/app/(admin)/admin/orders/page.tsx` without changing customer-facing APIs.

**Tech Stack:** Node.js, Express, zod, better-sqlite3 migrations, audit log service, Next 16 App Router, React Query, Node built-in test runner.

---

## Files

- Create: `src/database/migrations/057_order_notes.js`
- Create: `src/services/orderNoteService.js`
- Create: `tests/api/admin-order-notes.test.js`
- Modify: `src/api/routes/admin/orders.js`
- Modify: `web/src/app/(admin)/admin/orders/page.tsx`
- Modify: `web/src/lib/icons.ts` only if the existing shared icon export file does not already export a note icon.

## Task 1: Backend Note Service And Migration

**Files:**
- Create: `src/database/migrations/057_order_notes.js`
- Create: `src/services/orderNoteService.js`
- Test: `tests/api/admin-order-notes.test.js`

- [ ] **Step 1: Create the failing backend test file skeleton**

Create `tests/api/admin-order-notes.test.js` with the shared request helper and fixture setup:

```js
const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

async function requestJson(app, method, path, body) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(body ? Buffer.from(JSON.stringify(body)) : null);
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    req.headers = body ? { 'content-type': 'application/json' } : {};
    const socket = new PassThrough();
    socket.remoteAddress = '127.0.0.1';
    req.socket = socket;

    const chunks = [];
    const res = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(Buffer.from(chunk));
        cb();
      },
    });
    res.statusCode = 200;
    res.headers = {};
    res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
    res.getHeader = (key) => res.headers[key.toLowerCase()];
    res.removeHeader = (key) => { delete res.headers[key.toLowerCase()]; };
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      if (headers) {
        for (const [key, value] of Object.entries(headers)) res.setHeader(key, value);
      }
      return res;
    };
    const end = res.end.bind(res);
    res.end = (chunk, enc, cb) => {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : undefined));
      end(cb);
      try {
        resolve({ status: res.statusCode, json: JSON.parse(Buffer.concat(chunks).toString() || '{}') });
      } catch (err) {
        reject(err);
      }
    };
    app.handle(req, res, reject);
  });
}

function makeApp(admin = { adminId: 1, role: 'super_admin', username: 'admin', perms: ['*'] }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = admin;
    next();
  });
  app.use('/admin/orders', require('../../src/api/routes/admin/orders'));
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  });
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

function ensureAdmin() {
  db.prepare(`
    INSERT INTO admins (id, username, password_hash, display_name, role, is_active)
    VALUES (1, 'admin', 'x', 'Admin Chính', 'super_admin', 1)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      display_name = excluded.display_name,
      role = excluded.role,
      is_active = 1
  `).run();
}

function createFixture() {
  ensureAdmin();
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 871_000_000 + Math.floor(Math.random() * 100000);
  return db.transaction(() => {
    db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)')
      .run(userId, `note_${suffix}`, `Khách ghi chú ${suffix}`);
    const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)')
      .run(`note-category-${suffix}`, `note-category-${suffix}`);
    const product = db.prepare(`
      INSERT INTO products (category_id, name, slug, price, is_active)
      VALUES (?, ?, ?, 100000, 1)
    `).run(category.lastInsertRowid, `Sản phẩm ghi chú ${suffix}`, `note-product-${suffix}`);
    const order = db.prepare(`
      INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source)
      VALUES (?, ?, 1, 100000, ?, 'paid', 'web')
    `).run(userId, product.lastInsertRowid, `PNS_NOTE_${suffix}`);
    return {
      suffix,
      userId,
      categoryId: category.lastInsertRowid,
      productId: product.lastInsertRowid,
      orderId: order.lastInsertRowid,
    };
  })();
}

function cleanupFixture(fixture) {
  db.transaction(() => {
    db.prepare('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?').run('order', fixture.orderId);
    db.prepare('DELETE FROM order_notes WHERE order_id = ?').run(fixture.orderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
    db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
  })();
}
```

- [ ] **Step 2: Add failing tests for list/detail shape and CRUD**

Append these tests to `tests/api/admin-order-notes.test.js`:

```js
test('admin order notes can be created, listed, updated, and deleted', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const app = makeApp();

  const create = await requestJson(app, 'POST', `/admin/orders/${fixture.orderId}/notes`, {
    content: '  Khách cần xử lý thủ công sau thanh toán.  ',
  });
  assert.strictEqual(create.status, 200, JSON.stringify(create.json));
  assert.strictEqual(create.json.success, true);
  assert.strictEqual(create.json.data.content, 'Khách cần xử lý thủ công sau thanh toán.');
  assert.strictEqual(create.json.data.createdByAdminName, 'Admin Chính');
  const noteId = create.json.data.id;

  const list = await requestJson(app, 'GET', '/admin/orders?page=1&limit=20', null);
  const listedOrder = list.json.data.orders.find((order) => order.id === String(fixture.orderId));
  assert.ok(listedOrder);
  assert.strictEqual(listedOrder.noteCount, 1);
  assert.ok(listedOrder.latestNoteAt);

  const detail = await requestJson(app, 'GET', `/admin/orders/${fixture.orderId}`, null);
  assert.strictEqual(detail.json.data.notes.length, 1);
  assert.strictEqual(detail.json.data.notes[0].id, noteId);
  assert.strictEqual(detail.json.data.notes[0].content, 'Khách cần xử lý thủ công sau thanh toán.');

  const update = await requestJson(app, 'PATCH', `/admin/orders/${fixture.orderId}/notes/${noteId}`, {
    content: 'Đã liên hệ khách, chờ phản hồi.',
  });
  assert.strictEqual(update.status, 200, JSON.stringify(update.json));
  assert.strictEqual(update.json.data.content, 'Đã liên hệ khách, chờ phản hồi.');
  assert.strictEqual(update.json.data.updatedByAdminName, 'Admin Chính');

  const afterUpdate = await requestJson(app, 'GET', `/admin/orders/${fixture.orderId}`, null);
  assert.strictEqual(afterUpdate.json.data.notes[0].content, 'Đã liên hệ khách, chờ phản hồi.');

  const del = await requestJson(app, 'DELETE', `/admin/orders/${fixture.orderId}/notes/${noteId}`, null);
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.strictEqual(del.json.success, true);

  const afterDelete = await requestJson(app, 'GET', `/admin/orders/${fixture.orderId}`, null);
  assert.deepStrictEqual(afterDelete.json.data.notes, []);
});

test('admin order note validation and ownership checks are enforced', async (t) => {
  const one = createFixture();
  const two = createFixture();
  t.after(() => {
    cleanupFixture(one);
    cleanupFixture(two);
  });
  const app = makeApp();

  const empty = await requestJson(app, 'POST', `/admin/orders/${one.orderId}/notes`, { content: '   ' });
  assert.strictEqual(empty.status, 400);

  const tooLong = await requestJson(app, 'POST', `/admin/orders/${one.orderId}/notes`, { content: 'x'.repeat(2001) });
  assert.strictEqual(tooLong.status, 400);

  const created = await requestJson(app, 'POST', `/admin/orders/${one.orderId}/notes`, { content: 'Note thuộc đơn một' });
  const wrongOrderPatch = await requestJson(app, 'PATCH', `/admin/orders/${two.orderId}/notes/${created.json.data.id}`, {
    content: 'Không được sửa qua đơn khác',
  });
  assert.strictEqual(wrongOrderPatch.status, 404);

  const wrongOrderDelete = await requestJson(app, 'DELETE', `/admin/orders/${two.orderId}/notes/${created.json.data.id}`, null);
  assert.strictEqual(wrongOrderDelete.status, 404);
});
```

- [ ] **Step 3: Run the test and verify it fails because routes/table do not exist**

Run:

```bash
node --test tests/api/admin-order-notes.test.js
```

Expected: FAIL with errors such as `no such table: order_notes` or route `NOT_FOUND`.

- [ ] **Step 4: Add the migration**

Create `src/database/migrations/057_order_notes.js`:

```js
function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS order_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      created_by_admin_id INTEGER,
      updated_by_admin_id INTEGER,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (created_by_admin_id) REFERENCES admins(id),
      FOREIGN KEY (updated_by_admin_id) REFERENCES admins(id)
    );

    CREATE INDEX IF NOT EXISTS idx_order_notes_order_created
      ON order_notes (order_id, created_at DESC, id DESC);
  `);
}

module.exports = { up };
```

- [ ] **Step 5: Add the note service**

Create `src/services/orderNoteService.js`:

```js
const db = require('../database');

const CONTENT_MAX_LENGTH = 2000;

function normalizeContent(content) {
  const value = String(content ?? '').trim();
  if (!value) {
    const err = new Error('EMPTY_NOTE');
    err.status = 400;
    throw err;
  }
  if (value.length > CONTENT_MAX_LENGTH) {
    const err = new Error('NOTE_TOO_LONG');
    err.status = 400;
    throw err;
  }
  return value;
}

function shapeNote(row) {
  return {
    id: String(row.id),
    content: row.content,
    createdByAdminId: row.created_by_admin_id == null ? null : String(row.created_by_admin_id),
    createdByAdminName: row.created_by_admin_name ?? null,
    createdByAdminUsername: row.created_by_admin_username ?? null,
    updatedByAdminId: row.updated_by_admin_id == null ? null : String(row.updated_by_admin_id),
    updatedByAdminName: row.updated_by_admin_name ?? null,
    updatedByAdminUsername: row.updated_by_admin_username ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const selectNoteSql = `
  SELECT
    n.*,
    created_admin.display_name AS created_by_admin_name,
    created_admin.username AS created_by_admin_username,
    updated_admin.display_name AS updated_by_admin_name,
    updated_admin.username AS updated_by_admin_username
  FROM order_notes n
  LEFT JOIN admins created_admin ON created_admin.id = n.created_by_admin_id
  LEFT JOIN admins updated_admin ON updated_admin.id = n.updated_by_admin_id
`;

function getByIdForOrder(orderId, noteId) {
  const row = db.prepare(`
    ${selectNoteSql}
    WHERE n.order_id = ? AND n.id = ?
  `).get(orderId, noteId);
  return row ? shapeNote(row) : null;
}

function previewContent(content) {
  const value = String(content ?? '').replace(/\s+/g, ' ').trim();
  return value.length > 120 ? `${value.slice(0, 120)}...` : value;
}

module.exports = {
  CONTENT_MAX_LENGTH,
  normalizeContent,
  shapeNote,
  previewContent,

  listForOrder(orderId) {
    return db.prepare(`
      ${selectNoteSql}
      WHERE n.order_id = ?
      ORDER BY n.created_at DESC, n.id DESC
    `).all(orderId).map(shapeNote);
  },

  getByIdForOrder,

  create(orderId, adminId, content) {
    const normalized = normalizeContent(content);
    const result = db.prepare(`
      INSERT INTO order_notes (order_id, created_by_admin_id, updated_by_admin_id, content)
      VALUES (?, ?, ?, ?)
    `).run(orderId, adminId ?? null, adminId ?? null, normalized);
    return getByIdForOrder(orderId, result.lastInsertRowid);
  },

  update(orderId, noteId, adminId, content) {
    const normalized = normalizeContent(content);
    const result = db.prepare(`
      UPDATE order_notes
      SET content = ?, updated_by_admin_id = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND order_id = ?
    `).run(normalized, adminId ?? null, noteId, orderId);
    if (result.changes === 0) return null;
    return getByIdForOrder(orderId, noteId);
  },

  delete(orderId, noteId) {
    const existing = getByIdForOrder(orderId, noteId);
    if (!existing) return null;
    db.prepare('DELETE FROM order_notes WHERE id = ? AND order_id = ?').run(noteId, orderId);
    return existing;
  },
};
```

- [ ] **Step 6: Run migration by loading the app database, then rerun test to keep failure focused on API**

Run:

```bash
node -e "require('./src/database'); console.log('db ready')"
node --test tests/api/admin-order-notes.test.js
```

Expected: migration runs if not applied; test still FAILS because `orders.js` does not expose notes yet.

- [ ] **Step 7: Leave changes uncommitted until the API integration makes the failing test pass**

Do not commit after Task 1. The test intentionally remains red until Task 2 wires the routes and DTO fields.

## Task 2: Admin Orders API Integration

**Files:**
- Modify: `src/api/routes/admin/orders.js`
- Test: `tests/api/admin-order-notes.test.js`

- [ ] **Step 1: Import note service and permission middleware**

At the top of `src/api/routes/admin/orders.js`, add:

```js
const { requirePermission } = require('../../middleware/auth');
const orderNoteService = require('../../../services/orderNoteService');
```

- [ ] **Step 2: Add note fields to shaped orders**

Inside `shapeOrder(r)`, add these properties before `hasCustomerInput` or near the other summary fields:

```js
    noteCount: Number(r.note_count || 0),
    latestNoteAt: r.latest_note_at || null,
```

- [ ] **Step 3: Enrich the order list SQL with note aggregates**

In both list and count queries, only the list query needs note data. Replace the list `SELECT` section with this form:

```sql
SELECT
  o.*,
  p.name as product_name,
  u.full_name as user_name,
  u.username,
  COALESCE(note_stats.note_count, 0) AS note_count,
  note_stats.latest_note_at
FROM orders o
JOIN products p ON o.product_id = p.id
LEFT JOIN users u ON o.user_id = u.telegram_id
LEFT JOIN (
  SELECT order_id, COUNT(*) AS note_count, MAX(updated_at) AS latest_note_at
  FROM order_notes
  GROUP BY order_id
) note_stats ON note_stats.order_id = o.id
WHERE ${where}
ORDER BY o.created_at DESC
LIMIT ? OFFSET ?
```

Do not add the `note_stats` join to the count query; the count query should remain one row per order and fast.

- [ ] **Step 4: Add notes to the detail DTO**

In `router.get('/:id', ...)`, after renewal logs are assigned, add:

```js
  shaped.notes = orderNoteService.listForOrder(order.id);
```

- [ ] **Step 5: Add the note validation schema**

Near the existing schemas in `src/api/routes/admin/orders.js`, add:

```js
const orderNoteSchema = z.object({
  content: z.string().transform(value => value.trim()).pipe(z.string().min(1).max(2000)),
});
```

- [ ] **Step 6: Add note CRUD routes before `/:id` catch-all routes that could intercept them**

Place these routes before `router.get('/:id', ...)`:

```js
function noteNotFound(res) {
  return res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Ghi chú không tồn tại' },
  });
}

router.post('/:id/notes', requirePermission('orders.write'), validate(orderNoteSchema), (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  const order = orderService.getById(orderId);
  if (!order) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });
  }

  const note = orderNoteService.create(orderId, req.admin.adminId, req.validated.content);
  auditService.log(req.admin.adminId, 'order.note_create', 'order', orderId, {
    noteId: note.id,
    preview: orderNoteService.previewContent(note.content),
  }, req.ip);
  res.json({ success: true, data: note });
});

router.patch('/:id/notes/:noteId', requirePermission('orders.write'), validate(orderNoteSchema), (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  const noteId = parseInt(req.params.noteId, 10);
  const order = orderService.getById(orderId);
  if (!order) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });
  }

  const note = orderNoteService.update(orderId, noteId, req.admin.adminId, req.validated.content);
  if (!note) return noteNotFound(res);

  auditService.log(req.admin.adminId, 'order.note_update', 'order', orderId, {
    noteId: note.id,
    preview: orderNoteService.previewContent(note.content),
  }, req.ip);
  res.json({ success: true, data: note });
});

router.delete('/:id/notes/:noteId', requirePermission('orders.write'), (req, res) => {
  const orderId = parseInt(req.params.id, 10);
  const noteId = parseInt(req.params.noteId, 10);
  const order = orderService.getById(orderId);
  if (!order) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Đơn hàng không tồn tại' } });
  }

  const note = orderNoteService.delete(orderId, noteId);
  if (!note) return noteNotFound(res);

  auditService.log(req.admin.adminId, 'order.note_delete', 'order', orderId, {
    noteId: note.id,
    preview: orderNoteService.previewContent(note.content),
  }, req.ip);
  res.json({ success: true, data: { orderId: String(orderId), noteId: String(noteId) } });
});
```

- [ ] **Step 7: Run targeted backend tests**

Run:

```bash
node --test tests/api/admin-order-notes.test.js tests/api/admin-orders-detail-readable.test.js
```

Expected: PASS. The existing detail-readable test should still pass with extra DTO fields because it does not deep-equal the full response object.

- [ ] **Step 8: Commit Task 2**

```bash
git add src/api/routes/admin/orders.js src/services/orderNoteService.js tests/api/admin-order-notes.test.js
git commit -m "feat: add admin order notes api"
```

## Task 3: Admin Orders UI Types And Mutations

**Files:**
- Modify: `web/src/app/(admin)/admin/orders/page.tsx`
- Modify: `web/src/lib/icons.ts` only if `StickyNote` is not already exported.

- [ ] **Step 1: Add or verify icon export**

Check `web/src/lib/icons.ts`. If it does not export a note-like icon, add `StickyNote` from `lucide-react`:

```ts
export {
  StickyNote,
} from 'lucide-react'
```

If the file already uses a grouped export block, add `StickyNote` to that block instead of creating a new export block.

- [ ] **Step 2: Extend imports in the orders page**

In `web/src/app/(admin)/admin/orders/page.tsx`, extend the icon import:

```ts
import { Search, Clock, CheckCircle2, XCircle, Check, Eye, EyeOff, Copy, Send, Trash2, RotateCcw, X, StickyNote } from '@/lib/icons'
```

- [ ] **Step 3: Add note interfaces and order summary fields**

Extend the `Order` interface:

```ts
  noteCount: number
  latestNoteAt?: string | null
```

Add a new interface above `OrderDetail`:

```ts
interface OrderNote {
  id: string
  content: string
  createdByAdminId: string | null
  createdByAdminName: string | null
  createdByAdminUsername: string | null
  updatedByAdminId: string | null
  updatedByAdminName: string | null
  updatedByAdminUsername: string | null
  createdAt: string
  updatedAt: string
}
```

Extend `OrderDetail`:

```ts
  notes: OrderNote[]
```

- [ ] **Step 4: Add UI state for note popover and composer focus**

Inside `OrdersPage`, near the existing drawer state, add:

```ts
  const [notePopoverOrderId, setNotePopoverOrderId] = useState<string | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [editingNoteText, setEditingNoteText] = useState('')
  const [focusNoteComposer, setFocusNoteComposer] = useState(false)
  const noteComposerRef = useRef<HTMLTextAreaElement | null>(null)
```

Add an effect after the existing drawer focus effect:

```ts
  useEffect(() => {
    if (!detailOrderId || !focusNoteComposer) return
    const timer = setTimeout(() => {
      noteComposerRef.current?.focus()
      setFocusNoteComposer(false)
    }, 0)
    return () => clearTimeout(timer)
  }, [detailOrderId, focusNoteComposer, detailResponse?.data?.id])
```

- [ ] **Step 5: Add note mutations**

Inside `OrdersPage`, after the existing mutations, add:

```ts
  const createNoteMutation = useMutation({
    mutationFn: ({ orderId, content }: { orderId: string; content: string }) =>
      api.post<OrderNote>(`/admin/orders/${orderId}/notes`, { content }),
    onSuccess: (_res, vars) => {
      setNoteDraft('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'order', vars.orderId, 'detail'] })
    },
    onError: (e) => alert(`❌ ${e instanceof Error ? e.message : 'Không thể thêm ghi chú'}`),
  })

  const updateNoteMutation = useMutation({
    mutationFn: ({ orderId, noteId, content }: { orderId: string; noteId: string; content: string }) =>
      api.patch<OrderNote>(`/admin/orders/${orderId}/notes/${noteId}`, { content }),
    onSuccess: (_res, vars) => {
      setEditingNoteId(null)
      setEditingNoteText('')
      queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'order', vars.orderId, 'detail'] })
    },
    onError: (e) => alert(`❌ ${e instanceof Error ? e.message : 'Không thể sửa ghi chú'}`),
  })

  const deleteNoteMutation = useMutation({
    mutationFn: ({ orderId, noteId }: { orderId: string; noteId: string }) =>
      api.delete(`/admin/orders/${orderId}/notes/${noteId}`),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'orders'] })
      queryClient.invalidateQueries({ queryKey: ['admin', 'order', vars.orderId, 'detail'] })
    },
    onError: (e) => alert(`❌ ${e instanceof Error ? e.message : 'Không thể xóa ghi chú'}`),
  })
```

- [ ] **Step 6: Add helper functions**

Inside `OrdersPage`, near `openDetail`, add:

```ts
  function openDetailForNotes(id: string) {
    setNotePopoverOrderId(null)
    openDetail(id)
    setFocusNoteComposer(true)
  }

  function submitNote(orderId: string) {
    const content = noteDraft.trim()
    if (!content) {
      alert('Chưa nhập nội dung ghi chú')
      return
    }
    createNoteMutation.mutate({ orderId, content })
  }

  function submitNoteEdit(orderId: string, noteId: string) {
    const content = editingNoteText.trim()
    if (!content) {
      alert('Ghi chú không được để trống')
      return
    }
    updateNoteMutation.mutate({ orderId, noteId, content })
  }
```

- [ ] **Step 7: Commit Task 3**

```bash
git add web/src/app/'(admin)'/admin/orders/page.tsx web/src/lib/icons.ts
git commit -m "feat: wire admin order note state"
```

## Task 4: Admin Orders Note Popover And Drawer UI

**Files:**
- Modify: `web/src/app/(admin)/admin/orders/page.tsx`

- [ ] **Step 1: Add a quick note popover component inside `OrdersPage`**

Add this helper function inside `OrdersPage`, before `rowActions`:

```tsx
  function renderNotePopover(order: Order) {
    if (notePopoverOrderId !== order.id) return null
    return (
      <div
        className="absolute z-30 top-full right-0 mt-1 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-clay-oat bg-white p-3 shadow-xl text-left"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className="text-sm font-semibold">Ghi chú nội bộ</p>
          <button type="button" onClick={() => setNotePopoverOrderId(null)} className="text-clay-silver hover:text-clay-ink" aria-label="Đóng ghi chú">
            <X size={14} />
          </button>
        </div>
        <OrderNotesPreview orderId={order.id} onOpenDetail={() => openDetail(order.id)} onAddNote={() => openDetailForNotes(order.id)} />
      </div>
    )
  }
```

Then add this component above `OrdersPage`:

```tsx
function OrderNotesPreview({ orderId, onOpenDetail, onAddNote }: { orderId: string; onOpenDetail: () => void; onAddNote: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'order', orderId, 'detail'],
    queryFn: () => api.get<OrderDetail>(`/admin/orders/${orderId}`),
  })
  const notes = data?.data?.notes ?? []
  const previewNotes = notes.slice(0, 3)

  if (isLoading) return <p className="text-xs text-clay-silver">Đang tải ghi chú...</p>

  return (
    <div className="space-y-3">
      {previewNotes.length > 0 ? (
        <div className="space-y-2">
          {previewNotes.map(note => (
            <div key={note.id} className="rounded-lg bg-clay-oat-light px-2 py-1.5">
              <p className="text-xs text-clay-ink line-clamp-3 whitespace-pre-wrap">{note.content}</p>
              <p className="text-[11px] text-clay-silver mt-1">
                {note.createdByAdminName || note.createdByAdminUsername || 'Admin'} · {formatDate(note.createdAt)}
                {note.updatedAt !== note.createdAt ? ` · sửa ${formatDate(note.updatedAt)}` : ''}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-clay-silver">Không có ghi chú.</p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onAddNote} className="clay-btn clay-btn--lemon text-xs py-1 px-2">Thêm ghi chú</button>
        <button type="button" onClick={onOpenDetail} className="clay-btn text-xs py-1 px-2">Mở chi tiết</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Add the row note icon**

In `rowActions(order)`, create a note button after `contactButton`:

```tsx
    const noteButton = order.noteCount > 0 ? (
      <div className="relative">
        <button
          type="button"
          onClick={() => setNotePopoverOrderId(value => value === order.id ? null : order.id)}
          className="clay-btn text-xs py-1 px-2 inline-flex items-center gap-1"
          title={`${order.noteCount} ghi chú nội bộ`}
          aria-label={`${order.noteCount} ghi chú nội bộ`}
        >
          <StickyNote size={12} />
          {order.noteCount}
        </button>
        {renderNotePopover(order)}
      </div>
    ) : null
```

Include `{noteButton}` immediately after `{contactButton}` in all row action branches.

- [ ] **Step 3: Add the drawer note section**

Inside the detail drawer content, insert this section after the `Tổng quan` or `Khách hàng` section:

```tsx
                    <section className="clay-card p-4">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <div>
                          <h3 className="font-semibold">Ghi chú nội bộ</h3>
                          <p className="text-xs text-clay-silver">Chỉ admin nhìn thấy. Không gửi cho khách.</p>
                        </div>
                        <span className="clay-pill text-xs">{detail.notes.length}</span>
                      </div>

                      <div className="space-y-3">
                        <textarea
                          ref={noteComposerRef}
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          rows={3}
                          maxLength={2000}
                          placeholder="Nhập ghi chú cho đơn này..."
                          className="clay-input w-full text-sm"
                        />
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => submitNote(detail.id)}
                            disabled={createNoteMutation.isPending}
                            className="clay-btn clay-btn--lemon text-sm disabled:opacity-50"
                          >
                            {createNoteMutation.isPending ? 'Đang lưu...' : 'Thêm ghi chú'}
                          </button>
                        </div>

                        {detail.notes.length > 0 ? (
                          <div className="space-y-2 pt-2 border-t border-clay-oat">
                            {detail.notes.map(note => {
                              const isEditing = editingNoteId === note.id
                              return (
                                <div key={note.id} className="rounded-xl border border-clay-oat p-3 space-y-2">
                                  {isEditing ? (
                                    <>
                                      <textarea
                                        value={editingNoteText}
                                        onChange={(e) => setEditingNoteText(e.target.value)}
                                        rows={3}
                                        maxLength={2000}
                                        className="clay-input w-full text-sm"
                                      />
                                      <div className="flex justify-end gap-2">
                                        <button type="button" onClick={() => { setEditingNoteId(null); setEditingNoteText('') }} className="clay-btn text-xs py-1 px-2">Hủy</button>
                                        <button
                                          type="button"
                                          onClick={() => submitNoteEdit(detail.id, note.id)}
                                          disabled={updateNoteMutation.isPending}
                                          className="clay-btn clay-btn--lemon text-xs py-1 px-2 disabled:opacity-50"
                                        >
                                          Lưu
                                        </button>
                                      </div>
                                    </>
                                  ) : (
                                    <>
                                      <p className="text-sm whitespace-pre-wrap break-words">{note.content}</p>
                                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-clay-silver">
                                        <span>
                                          {note.createdByAdminName || note.createdByAdminUsername || 'Admin'} · {formatDate(note.createdAt)}
                                          {note.updatedAt !== note.createdAt ? ` · sửa bởi ${note.updatedByAdminName || note.updatedByAdminUsername || 'Admin'} lúc ${formatDate(note.updatedAt)}` : ''}
                                        </span>
                                        <span className="inline-flex gap-2">
                                          <button
                                            type="button"
                                            onClick={() => { setEditingNoteId(note.id); setEditingNoteText(note.content) }}
                                            className="hover:text-clay-ink"
                                          >
                                            Sửa
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (!confirm('Xóa ghi chú này?')) return
                                              deleteNoteMutation.mutate({ orderId: detail.id, noteId: note.id })
                                            }}
                                            disabled={deleteNoteMutation.isPending}
                                            className="text-red-600 hover:text-red-700 disabled:opacity-50"
                                          >
                                            Xóa
                                          </button>
                                        </span>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        ) : (
                          <p className="text-sm text-clay-silver">Chưa có ghi chú nội bộ.</p>
                        )}
                      </div>
                    </section>
```

- [ ] **Step 4: Reset note editing state when closing or switching detail**

In `openDetail(id)` and `closeDetail()`, reset note-specific transient state:

```ts
    setNoteDraft('')
    setEditingNoteId(null)
    setEditingNoteText('')
    setNotePopoverOrderId(null)
```

Keep `openDetailForNotes(id)` responsible for setting `focusNoteComposer` after calling `openDetail(id)`.

- [ ] **Step 5: Run web build/typecheck**

Run:

```bash
cd web && npm run build
```

Expected: PASS. If it fails on pre-existing unrelated errors, capture the exact error and do not widen scope.

- [ ] **Step 6: Commit Task 4**

```bash
git add web/src/app/'(admin)'/admin/orders/page.tsx web/src/lib/icons.ts
git commit -m "feat: add admin order notes ui"
```

## Task 5: Final Verification

**Files:**
- Verify only; no code changes unless a preceding step failed.

- [ ] **Step 1: Run focused backend tests**

Run:

```bash
node --test tests/api/admin-order-notes.test.js tests/api/admin-orders-detail-readable.test.js tests/api/admin-orders-resend-keys.test.js
```

Expected: PASS. These tests do not broadcast Telegram messages to real users; resend test mocks `telegramApiClient`.

- [ ] **Step 2: Run syntax checks for touched backend files**

Run:

```bash
node --check src/database/migrations/057_order_notes.js src/services/orderNoteService.js src/api/routes/admin/orders.js
```

Expected: PASS with no syntax output.

- [ ] **Step 3: Run web production build**

Run:

```bash
cd web && npm run build
```

Expected: PASS.

- [ ] **Step 4: Run purge dry-run**

Run:

```bash
node scripts/purge-test-data.js
```

Expected: target counts are 0. If counts are nonzero, inspect the output and follow `AGENTS.md`: create backup, apply purge, and do not stage DB/backup.

- [ ] **Step 5: Confirm customer APIs do not expose notes**

Run:

```bash
rg -n "notes|order_notes|noteCount|latestNoteAt" src/api/routes/customer.js src/api/routes/public.js web/src/app/'(miniapp)'
```

Expected: no matches for new order-note fields in customer/public/TMA surfaces.

- [ ] **Step 6: Commit verification-only fixes when verification produced code changes**

If final verification required a small fix, commit it:

```bash
git add <fixed-files>
git commit -m "fix: polish admin order notes"
```

If no fixes were needed, do not create an empty commit.
