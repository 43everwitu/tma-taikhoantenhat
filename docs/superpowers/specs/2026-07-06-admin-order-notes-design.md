# Admin Order Notes Design

## Goal

Add internal order notes to `admin/orders` so admins can leave operational context on an order without exposing it to customers.

The admin should be able to:

- see which orders have notes while scanning the order list
- quickly preview recent notes from the list
- add, edit, and delete notes from the order detail drawer
- see note content, author, created time, and last edited time

## Scope

In scope:

- Internal admin-only notes on orders.
- Multiple notes per order.
- Note author display using the admin account that created the note and, when different or relevant, the admin account that last edited it.
- List-row note icon with a count badge for orders that have notes.
- Quick note popover from the order row.
- Full note management inside the existing order detail drawer.
- Admin API endpoints for create, update, and delete.
- Audit log entries for note create, update, and delete.

Out of scope:

- Showing notes in Telegram Mini App customer order screens.
- Sending notes to Telegram bot/customer chat.
- Rich text, file attachments, mentions, reminders, or note notifications.
- New permission names; reuse existing `orders.read` and `orders.write`.
- Refactoring unrelated `admin/orders` behavior.

## Current Context

`web/src/app/(admin)/admin/orders/page.tsx` already renders the order table and opens a right-side detail drawer using `GET /admin/orders/:id`.

`src/api/routes/admin/orders.js` currently shapes both list rows and detail DTOs. Detail already includes related customer, product, stock, transaction, and renewal-log data.

Migration `002_platform.js` added a legacy `orders.notes` text column, but it is not used by current code. The new feature needs multiple editable notes per order, so it will use a normalized `order_notes` table and leave `orders.notes` untouched as legacy data.

## Recommended Approach

Use a new `order_notes` table and surface note summary fields in the existing admin order DTOs.

This keeps notes queryable and independently editable, avoids growing the `orders` row with JSON, and matches the requirement that one order can have many notes.

## Data Model

Add a new migration after the current migration head:

```sql
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
```

Notes are hard-deleted when an admin deletes a note. Audit log keeps the admin action history.

Content validation:

- trim leading/trailing whitespace
- reject empty content
- maximum length: 2,000 characters

## API Design

### `GET /admin/orders`

Each shaped order gains:

```ts
noteCount: number
latestNoteAt: string | null
```

The list query should use an aggregate subquery or `LEFT JOIN` grouped by order id so pagination remains one row per order.

### `GET /admin/orders/:id`

The detail DTO gains:

```ts
notes: Array<{
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
}>
```

Notes are ordered newest first.

### `POST /admin/orders/:id/notes`

Request:

```json
{ "content": "Khách cần xử lý thủ công sau thanh toán." }
```

Behavior:

- require order exists
- require `orders.write`
- create note with `created_by_admin_id = req.admin.adminId` and `updated_by_admin_id = req.admin.adminId`
- return the created note DTO
- write audit action `order.note_create`

### `PATCH /admin/orders/:id/notes/:noteId`

Request:

```json
{ "content": "Nội dung đã cập nhật." }
```

Behavior:

- require order exists
- require note belongs to that order
- require `orders.write`
- update `content`, `updated_by_admin_id = req.admin.adminId`, and `updated_at = CURRENT_TIMESTAMP`
- return updated note DTO
- write audit action `order.note_update`

### `DELETE /admin/orders/:id/notes/:noteId`

Behavior:

- require order exists
- require note belongs to that order
- require `orders.write`
- delete the note
- write audit action `order.note_delete`

## Admin Orders UI

### Table row

In each row action group, keep current actions and add a note icon button only when `noteCount > 0`.

The icon shows the note count. It sits near `Chi tiết` and `Nhắn tin` so the admin can scan notes before operational actions such as `Xác nhận`, `Giao thủ công`, `Gửi lại`, or `Sửa key`.

Clicking the icon opens a small popover:

- latest 2-3 notes
- each note shows content preview, creator name/username, and created/updated time
- actions:
  - `Thêm ghi chú` opens the detail drawer and focuses the note composer
  - `Mở chi tiết` opens the detail drawer

If the order has no notes, no icon is shown in the row. New notes are added from the detail drawer.

### Detail drawer

Add a `Ghi chú nội bộ` section to the existing drawer.

Section behavior:

- note composer at the top
- full note list below, newest first
- each note shows content, creator, created time, and edited time/editor when `updatedAt !== createdAt`
- each note has `Sửa` and `Xóa` controls
- edit mode uses an inline textarea and `Lưu` / `Hủy`
- delete asks for confirmation before calling the API

After create/update/delete:

- invalidate `['admin', 'orders']`
- invalidate/remove the specific `['admin', 'order', orderId, 'detail']` query as needed
- keep the drawer open

### Customer visibility

Notes are not added to any customer-facing API route or TMA UI. They are internal admin data only.

## Permissions And Audit

Read access follows the admin route's existing `orders.read` guard.

Write access uses existing `orders.write` for create, update, and delete.

Audit actions:

- `order.note_create`
- `order.note_update`
- `order.note_delete`

Audit details should include `noteId`, and for create/update include a short content preview capped to 120 characters. Do not include long full note bodies in audit details.

## Error Handling

- Missing order: `404 NOT_FOUND`
- Missing note or note not linked to the order: `404 NOT_FOUND`
- Empty/too-long content: validation error from the existing zod validation middleware
- Write without permission: existing admin permission middleware returns forbidden

The frontend should show the existing alert/error style for failed mutations and keep the user's draft text when create/update fails.

## Testing

Backend tests:

- `GET /admin/orders` includes `noteCount` and `latestNoteAt`.
- `GET /admin/orders/:id` returns all notes newest first with admin display data.
- `POST /admin/orders/:id/notes` creates a note and audit log entry.
- `PATCH /admin/orders/:id/notes/:noteId` updates only a note belonging to that order.
- `DELETE /admin/orders/:id/notes/:noteId` deletes only a note belonging to that order.
- Empty and too-long note content is rejected.

Frontend verification:

- `admin/orders` row shows note icon only when `noteCount > 0`.
- Note icon opens a quick popover with recent notes.
- Detail drawer can add, edit, and delete notes.
- After mutations, row count and drawer notes stay in sync.

Build/typecheck:

- Run the targeted backend note tests.
- Run `cd web && npm run build` or the repo's existing web typecheck path.
- Do not run tests or commands that broadcast Telegram messages to all real users.

## Success Criteria

- Admin can manage multiple internal notes per order from the existing order detail drawer.
- Orders with notes are visually identifiable from the order list.
- Quick popover shows recent notes without leaving the table context.
- Notes include content, creator, created time, and edited time/editor.
- Notes never appear in customer-facing APIs or TMA screens.
