# Admin Stock Keys Filter Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Làm bảng `/admin/stock/keys` đổi cột theo filter trạng thái để `Còn hàng` không còn thông tin bán hàng thừa.

**Architecture:** Chỉ thay frontend render columns trong `web/src/app/(admin)/admin/stock/keys/page.tsx`. API và dữ liệu giữ nguyên; `ResponsiveTable` tiếp tục nhận `columns` đã được lọc theo `status`.

**Tech Stack:** Next 16 App Router, React, React Query, Node test runner source-level smoke test.

---

## File Map

- Modify: `web/src/app/(admin)/admin/stock/keys/page.tsx` - tách cell render helpers và build `columns` theo `status`.
- Create: `tests/web/admin-stock-keys-filter-columns.test.mjs` - source test đảm bảo có dynamic column branches cho `unsold`, `sold`, `all`.

## Task 1: Source Regression Test

- [ ] **Step 1: Create failing test**

Create `tests/web/admin-stock-keys-filter-columns.test.mjs`:

```js
import assert from 'node:assert';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.join(__dirname, '../../web/src/app/(admin)/admin/stock/keys/page.tsx');

test('/admin/stock/keys uses status-specific table columns', () => {
  const source = fs.readFileSync(pagePath, 'utf8');

  assert.match(source, /const columns = useMemo<Column<KeyRow>\[\]>\(\(\) =>/);
  assert.match(source, /if \(status === 'unsold'\)/);
  assert.match(source, /header: 'Thêm lúc'/);
  assert.match(source, /if \(status === 'sold'\)/);
  assert.match(source, /header: 'Đơn\\/khách'/);
  assert.match(source, /header: 'Thời gian'/);
  assert.match(source, /header: 'Giao dịch'/);
});
```

- [ ] **Step 2: Verify red**

Run:

```bash
node --test tests/web/admin-stock-keys-filter-columns.test.mjs
```

Expected: FAIL because `columns` is currently a fixed array and does not branch on `status`.

## Task 2: Implement Dynamic Columns

- [ ] **Step 1: Extract reusable cells**

In `web/src/app/(admin)/admin/stock/keys/page.tsx`, keep existing content but define small render helpers inside the component:

```tsx
const renderKeyCell = (row: KeyRow) => (...)
const renderProductCell = (row: KeyRow) => (...)
const renderSoldTransactionCell = (row: KeyRow) => (...)
const renderAllStatusCell = (row: KeyRow) => (...)
const renderAllTimeCell = (row: KeyRow) => (...)
const renderAllTransactionCell = (row: KeyRow) => (...)
```

- [ ] **Step 2: Build columns with `useMemo`**

Replace fixed `const columns: Column<KeyRow>[] = [...]` with:

```tsx
const columns = useMemo<Column<KeyRow>[]>(() => {
  const baseColumns = [...]
  if (status === 'unsold') return [...]
  if (status === 'sold') return [...]
  return [...]
}, [status])
```

Required branches:

- `unsold`: `ID`, `Tài khoản`, `Sản phẩm`, `Thêm lúc`, `Thao tác`
- `sold`: `ID`, `Tài khoản`, `Sản phẩm`, `Bán lúc`, `Đơn/khách`, `Thao tác`
- `all`: `ID`, `Tài khoản`, `Sản phẩm`, `Trạng thái`, `Thời gian`, `Giao dịch`, `Thao tác`

- [ ] **Step 3: Keep mobile behavior**

Do not change `ResponsiveTable`; card view inherits the same `columns`.

## Task 3: Verification

- [ ] **Step 1: Run source test**

Run:

```bash
node --test tests/web/admin-stock-keys-filter-columns.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Build web**

Run:

```bash
cd web && npm run build
```

Expected: build exits 0.

- [ ] **Step 3: Final hygiene**

Run:

```bash
git diff --check
node scripts/purge-test-data.js
```

Expected: no whitespace errors; purge dry-run target counts are 0.
