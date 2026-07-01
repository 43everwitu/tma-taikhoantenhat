# TMA Renewal Notification Once Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Card nhắc gia hạn trên TMA home chỉ hiện cho đến khi khách bấm `Gia hạn ngay` hoặc `Xem đơn`.

**Architecture:** Tận dụng `notifications.is_read` hiện có làm trạng thái acknowledgement. Backend mark-read trả `data` để tương thích `apiFetch`; frontend lọc unread renewal reminders và optimistic remove card khi khách bấm CTA.

**Tech Stack:** Node.js 22, Express, better-sqlite3, Next.js 16 App Router, React Query, Node built-in test runner.

---

## File Map

- Modify `src/api/routes/customer.js`: sửa `PATCH /notifications/:id/read` trả `data` và chỉ mark row của customer hiện tại.
- Create `tests/api/customer-notifications-read.test.js`: test route mark-read đúng owner và không chạm notification user khác.
- Create `web/src/lib/renewalNotifications.js`: helper thuần JS để lọc unread renewal reminders và remove notification khỏi cache.
- Create `tests/web/renewalNotifications.test.mjs`: test helper lọc unread và remove theo id.
- Modify `web/src/app/(miniapp)/page.tsx`: dùng helper, thêm router, handler CTA mark-read + optimistic cache update + navigate.

## Task 1: Backend Mark-Read API

**Files:**
- Modify: `src/api/routes/customer.js`
- Test: `tests/api/customer-notifications-read.test.js`

- [ ] **Step 1: Write the failing backend test**

Create `tests/api/customer-notifications-read.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

async function requestJson(app, method, path, headers = {}) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    req.headers = headers;
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

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use('/customer', require('../../src/api/routes/customer'));
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  });
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

async function issueToken(userId) {
  const authService = require('../../src/services/authService');
  return await authService.issueCustomerToken(userId);
}

function seedNotifications() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 895_000_000 + Math.floor(Math.random() * 100000);
  const otherUserId = userId + 1;
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(userId, `Notify Read ${suffix}`);
  db.prepare('INSERT INTO users (telegram_id, full_name) VALUES (?, ?)').run(otherUserId, `Notify Other ${suffix}`);
  const own = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, is_read)
    VALUES (?, 'renewal_reminder', 'Gia hạn', 'Đơn sắp hết hạn', 0)
  `).run(userId);
  const other = db.prepare(`
    INSERT INTO notifications (user_id, type, title, body, is_read)
    VALUES (?, 'renewal_reminder', 'Gia hạn', 'Đơn khác sắp hết hạn', 0)
  `).run(otherUserId);
  return { userId, otherUserId, ownId: own.lastInsertRowid, otherId: other.lastInsertRowid };
}

function cleanup(seed) {
  db.prepare('DELETE FROM notifications WHERE id IN (?, ?)').run(seed.ownId, seed.otherId);
  db.prepare('DELETE FROM users WHERE telegram_id IN (?, ?)').run(seed.userId, seed.otherUserId);
}

test('PATCH /notifications/:id/read marks the authenticated customer notification and returns data', async (t) => {
  const seed = seedNotifications();
  t.after(() => cleanup(seed));
  const { token } = await issueToken(seed.userId);

  const res = await requestJson(makeApp(), 'PATCH', `/customer/notifications/${seed.ownId}/read`, {
    authorization: `Bearer ${token}`,
  });

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.deepStrictEqual(res.json, {
    success: true,
    data: { id: Number(seed.ownId), isRead: true },
  });
  const row = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get(seed.ownId);
  assert.strictEqual(row.is_read, 1);
});

test('PATCH /notifications/:id/read does not mark another customer notification', async (t) => {
  const seed = seedNotifications();
  t.after(() => cleanup(seed));
  const { token } = await issueToken(seed.userId);

  const res = await requestJson(makeApp(), 'PATCH', `/customer/notifications/${seed.otherId}/read`, {
    authorization: `Bearer ${token}`,
  });

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.deepStrictEqual(res.json, {
    success: true,
    data: { id: Number(seed.otherId), isRead: true },
  });
  const row = db.prepare('SELECT is_read FROM notifications WHERE id = ?').get(seed.otherId);
  assert.strictEqual(row.is_read, 0);
});
```

- [ ] **Step 2: Run the backend test and verify RED**

Run:

```bash
node --test tests/api/customer-notifications-read.test.js
```

Expected: first test fails because response is `{ success: true }` without `data`.

- [ ] **Step 3: Implement the minimal backend change**

In `src/api/routes/customer.js`, replace the current `PATCH /notifications/:id/read` handler with:

```js
// PATCH /notifications/:id/read
router.patch('/notifications/:id/read', requireCustomer, (req, res) => {
  const notificationId = parseInt(req.params.id, 10);
  if (!Number.isFinite(notificationId) || notificationId <= 0) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_NOTIFICATION_ID', message: 'Notification không hợp lệ' },
    });
  }

  db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(notificationId, req.customer.telegramId);

  res.json({ success: true, data: { id: notificationId, isRead: true } });
});
```

- [ ] **Step 4: Run backend test and verify GREEN**

Run:

```bash
node --test tests/api/customer-notifications-read.test.js
```

Expected: all tests pass.

## Task 2: Frontend Renewal Notification Helper

**Files:**
- Create: `web/src/lib/renewalNotifications.js`
- Test: `tests/web/renewalNotifications.test.mjs`

- [ ] **Step 1: Write the failing frontend helper test**

Create `tests/web/renewalNotifications.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getVisibleRenewalNotifications,
  removeNotificationById,
} from '../../web/src/lib/renewalNotifications.js';

test('getVisibleRenewalNotifications returns only unread renewal reminders', () => {
  const rows = [
    { id: 1, type: 'renewal_reminder', is_read: 0 },
    { id: 2, type: 'renewal_reminder', is_read: 1 },
    { id: 3, type: 'product_new', is_read: 0 },
    { id: 4, type: 'renewal_reminder', is_read: null },
  ];

  assert.deepEqual(getVisibleRenewalNotifications(rows).map((row) => row.id), [1, 4]);
});

test('getVisibleRenewalNotifications limits visible reminders', () => {
  const rows = [
    { id: 1, type: 'renewal_reminder', is_read: 0 },
    { id: 2, type: 'renewal_reminder', is_read: 0 },
    { id: 3, type: 'renewal_reminder', is_read: 0 },
  ];

  assert.deepEqual(getVisibleRenewalNotifications(rows, 2).map((row) => row.id), [1, 2]);
});

test('removeNotificationById removes only the requested notification', () => {
  const rows = [
    { id: 1, type: 'renewal_reminder', is_read: 0 },
    { id: 2, type: 'renewal_reminder', is_read: 0 },
  ];

  assert.deepEqual(removeNotificationById(rows, 1).map((row) => row.id), [2]);
});
```

- [ ] **Step 2: Run helper test and verify RED**

Run:

```bash
node --test tests/web/renewalNotifications.test.mjs
```

Expected: fails because `web/src/lib/renewalNotifications.js` does not exist.

- [ ] **Step 3: Implement helper**

Create `web/src/lib/renewalNotifications.js`:

```js
export function getVisibleRenewalNotifications(notifications, limit = 3) {
  return (notifications ?? [])
    .filter((item) => item?.type === 'renewal_reminder' && Number(item?.is_read ?? 0) !== 1)
    .slice(0, limit);
}

export function removeNotificationById(notifications, id) {
  return (notifications ?? []).filter((item) => Number(item?.id) !== Number(id));
}
```

- [ ] **Step 4: Run helper test and verify GREEN**

Run:

```bash
node --test tests/web/renewalNotifications.test.mjs
```

Expected: all tests pass.

## Task 3: TMA Home CTA Acknowledgement

**Files:**
- Modify: `web/src/app/(miniapp)/page.tsx`
- Depends on: Task 1 and Task 2

- [ ] **Step 1: Wire unread filter and CTA acknowledgement**

Modify `web/src/app/(miniapp)/page.tsx`:

```tsx
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type MouseEvent } from 'react'
import { getVisibleRenewalNotifications, removeNotificationById } from '@/lib/renewalNotifications'
```

Inside `MiniAppHome()`:

```tsx
const router = useRouter()
```

Replace renewal notification derivation with:

```tsx
const renewalNotifications = getVisibleRenewalNotifications(notifications.data ?? [])
```

Add the action handler inside `MiniAppHome()`:

```tsx
async function handleRenewalNotificationAction(
  item: CustomerNotification,
  url: string,
  event: MouseEvent<HTMLAnchorElement>,
) {
  event.preventDefault()
  queryClient.setQueryData<CustomerNotification[]>(['notifications', 'renewals'], (old) =>
    removeNotificationById(old ?? [], item.id),
  )
  try {
    await apiFetch<{ id: number; isRead: boolean }>(
      `/notifications/${item.id}/read`,
      { method: 'PATCH' },
      { auth: 'required' },
    )
  } catch {
    // Không chặn điều hướng nếu thao tác ghi nhận nền thất bại.
  }
  router.push(url)
}
```

Pass the handler:

```tsx
<RenewalNotificationCard
  key={item.id}
  item={item}
  onAction={handleRenewalNotificationAction}
/>
```

Update `RenewalNotificationCard` signature and CTA links:

```tsx
function RenewalNotificationCard({
  item,
  onAction,
}: {
  item: CustomerNotification
  onAction: (item: CustomerNotification, url: string, event: MouseEvent<HTMLAnchorElement>) => void
}) {
  const data = parseNotificationData(item.data)
  return (
    <article className="rounded-2xl p-3.5" style={{ background: 'var(--brand-gold-soft)', color: 'var(--brand-ink)', border: '1px solid color-mix(in srgb, var(--brand-gold-deep) 25%, transparent)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold leading-snug">{item.title}</p>
          <p className="text-xs opacity-75 mt-1 leading-relaxed">{item.body}</p>
        </div>
        {typeof data.remainingDays === 'number' && (
          <span className="miniapp-status miniapp-status--key-soon whitespace-nowrap">
            Còn {Math.max(0, data.remainingDays)} ngày
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        {data.renewUrl && (
          <Link
            href={data.renewUrl}
            onClick={(event) => onAction(item, data.renewUrl || '/', event)}
            className="miniapp-btn miniapp-btn--ink justify-center text-sm"
          >
            Gia hạn ngay
          </Link>
        )}
        {data.orderUrl && (
          <Link
            href={data.orderUrl}
            onClick={(event) => onAction(item, data.orderUrl || '/', event)}
            className="miniapp-btn miniapp-btn--ghost justify-center text-sm"
          >
            Xem đơn
          </Link>
        )}
      </div>
    </article>
  )
}
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
node --test tests/api/customer-notifications-read.test.js tests/web/renewalNotifications.test.mjs
```

Expected: all tests pass.

- [ ] **Step 3: Run frontend lint for the touched file**

Run:

```bash
cd web && npm run lint -- src/app/\(miniapp\)/page.tsx src/lib/renewalNotifications.js
```

Expected: lint passes.

## Task 4: Final Verification

**Files:**
- Read-only verification only.

- [ ] **Step 1: Run focused test suite**

Run:

```bash
node --test tests/api/customer-notifications-read.test.js tests/web/renewalNotifications.test.mjs
```

Expected: all tests pass.

- [ ] **Step 2: Run related existing renewal/customer test**

Run:

```bash
node --test tests/api/customer-order-key-lifecycle.test.js
```

Expected: all tests pass.

- [ ] **Step 3: Check worktree scope**

Run:

```bash
git diff -- src/api/routes/customer.js tests/api/customer-notifications-read.test.js web/src/lib/renewalNotifications.js tests/web/renewalNotifications.test.mjs web/src/app/\(miniapp\)/page.tsx
```

Expected: diff is limited to the backend mark-read response, frontend unread filter, CTA acknowledgement, and focused tests.

