# MBBank Memo-less Payment Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tự xác nhận giao dịch MBBank không có mã `PNS` khi chỉ có một đơn phù hợp theo số tiền và thời gian, đồng thời chuyển trường hợp thiếu tiền, thiếu timestamp hoặc mơ hồ sang admin review.

**Architecture:** `mbbank-api` chuẩn hóa timestamp ngân hàng sang UTC nhưng không biết về order. Node dùng một matcher thuần để phân loại `unique`, `review` hoặc `none`; `PaymentPoller` giữ trách nhiệm persistence, idempotency, notification và gọi flow giao hàng hiện có. SQLite tiếp tục lưu UTC, còn ngày query ngân hàng dùng `Asia/Ho_Chi_Minh`.

**Tech Stack:** Node.js 22, `node:test`, better-sqlite3, Python 3.10+, `unittest`, FastAPI/Pydantic, `zoneinfo`.

---

## File map

- Create `mbbank-api/tests/__init__.py`: khai báo test package.
- Create `mbbank-api/tests/test_transaction_time.py`: khóa parser timestamp MBBank và UTC conversion.
- Create `mbbank-api/tests/test_validation_timezone.py`: khóa validation ngày Việt Nam.
- Modify `mbbank-api/app/mb_client.py`: chuẩn hóa `transactionDate`/`postingDate` và mở rộng response.
- Modify `mbbank-api/app/validation.py`: dùng ngày hiện tại tại `Asia/Ho_Chi_Minh`.
- Create `src/database/migrations/054_memo_less_payment_matching.js`: thêm metadata audit cho transaction.
- Create `tests/database/memoLessPaymentMigration.test.js`: test migration bằng SQLite in-memory.
- Create `src/services/paymentTransactionMatcher.js`: matcher thuần và helper UTC/query window.
- Create `tests/services/paymentTransactionMatcher.test.js`: test toàn bộ policy amount/time.
- Modify `src/services/orderService.js`: cung cấp snapshot order đủ điều kiện cho matcher.
- Modify `src/services/paymentPoller.js`: fetch mọi credit transaction, chạy matcher, persist review/match và chống poll đồng thời.
- Modify `tests/services/paymentPollerLifecycle.test.js`: integration tests cho request, branch priority, review và retry.
- Modify `tests/services/paymentPollerLateRecovery.test.js`: regression late recovery.
- Modify `mbbank-api/README.md`: document timestamp fields.

## Điều kiện làm việc

- Workspace hiện có nhiều thay đổi của người dùng, gồm `src/services/paymentPoller.js` và `src/services/orderService.js`.
- Không tạo worktree từ `HEAD` vì worktree mới sẽ thiếu các thay đổi late-payment chưa commit đang cần cho feature này.
- Trước mỗi commit, chạy `git diff --cached --name-only` và chỉ commit file/hunk thuộc task.
- Nếu không thể stage riêng hunk trong file đang dirty, để thay đổi implementation ở working tree và báo rõ thay vì commit lẫn code của người dùng.
- Không stage hoặc commit `data/shop.db`, backup DB, log hay dữ liệu giao dịch thật.

### Task 1: Chuẩn hóa timestamp giao dịch trong sidecar

**Files:**
- Create: `mbbank-api/tests/__init__.py`
- Create: `mbbank-api/tests/test_transaction_time.py`
- Modify: `mbbank-api/app/mb_client.py`

- [ ] **Step 1: Viết test fail cho parser timestamp**

Tạo `mbbank-api/tests/test_transaction_time.py`:

```python
import unittest

from app.mb_client import normalize_bank_transaction_time


class NormalizeBankTransactionTimeTest(unittest.TestCase):
    def test_converts_vietnam_seconds_to_utc(self):
        self.assertEqual(
            normalize_bank_transaction_time("22/06/2026 04:30:12"),
            "2026-06-21T21:30:12Z",
        )

    def test_accepts_vietnam_minutes(self):
        self.assertEqual(
            normalize_bank_transaction_time("22/06/2026 04:30"),
            "2026-06-21T21:30:00Z",
        )

    def test_preserves_iso_instant(self):
        self.assertEqual(
            normalize_bank_transaction_time("2026-06-22T04:30:12+07:00"),
            "2026-06-21T21:30:12Z",
        )

    def test_rejects_date_without_time(self):
        self.assertIsNone(normalize_bank_transaction_time("22/06/2026"))

    def test_rejects_invalid_value(self):
        self.assertIsNone(normalize_bank_transaction_time("khong-hop-le"))


if __name__ == "__main__":
    unittest.main()
```

Tạo file rỗng `mbbank-api/tests/__init__.py`.

- [ ] **Step 2: Chạy test để xác nhận fail**

Run:

```bash
cd mbbank-api && python3 -m unittest tests.test_transaction_time -v
```

Expected: FAIL vì `normalize_bank_transaction_time` chưa tồn tại.

- [ ] **Step 3: Implement parser tối thiểu**

Thêm vào `mbbank-api/app/mb_client.py`:

```python
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

VIETNAM_TIME_ZONE = ZoneInfo("Asia/Ho_Chi_Minh")


def _format_utc_iso(value: datetime) -> str:
    utc_value = value.astimezone(timezone.utc).replace(microsecond=0)
    return utc_value.isoformat().replace("+00:00", "Z")


def normalize_bank_transaction_time(raw_value: Any) -> Optional[str]:
    if raw_value is None:
        return None

    value = str(raw_value).strip()
    if not value:
        return None

    for pattern in ("%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M"):
        try:
            local_value = datetime.strptime(value, pattern).replace(
                tzinfo=VIETNAM_TIME_ZONE
            )
            return _format_utc_iso(local_value)
        except ValueError:
            pass

    try:
        iso_value = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None

    if iso_value.tzinfo is None:
        return None
    return _format_utc_iso(iso_value)
```

- [ ] **Step 4: Mở rộng standard transaction response**

Trong cả `get_credit_transactions()` và `get_all_transactions()`, thay phần dựng object bằng helper:

```python
def _standardize_transaction(self, tx: Any, transaction_type: str, amount: float):
    tx_dict = self._to_mapping(tx)
    transaction_date_raw = tx_dict.get("transactionDate")
    posting_date_raw = tx_dict.get("postingDate")
    source_time = transaction_date_raw or posting_date_raw

    return {
        "transactionNumber": tx_dict.get("refNo", ""),
        "amount": amount,
        "description": tx_dict.get("description", ""),
        "type": transaction_type,
        "transactionTime": normalize_bank_transaction_time(source_time),
        "transactionDateRaw": transaction_date_raw,
        "postingDateRaw": posting_date_raw,
    }
```

Credit path gọi:

```python
return self._standardize_transaction(tx, "IN", credit_amount)
```

All-transactions path dùng:

```python
if credit_amount > 0:
    return self._standardize_transaction(tx, "IN", credit_amount)
if debit_amount > 0:
    return self._standardize_transaction(tx, "OUT", debit_amount)
return None
```

- [ ] **Step 5: Thêm test response fields**

Thêm test:

```python
class FakeTransaction:
    def model_dump(self):
        return {
            "refNo": "FT_TEST",
            "creditAmount": "432000",
            "description": "9PAY",
            "transactionDate": "22/06/2026 04:30:12",
            "postingDate": "22/06/2026 04:30:14",
        }


def test_standardizes_raw_and_utc_fields(self):
    from app.mb_client import MBBankClient

    client = MBBankClient()
    result = client._standardize_transaction(FakeTransaction(), "IN", 432000)
    self.assertEqual(result["transactionTime"], "2026-06-21T21:30:12Z")
    self.assertEqual(result["transactionDateRaw"], "22/06/2026 04:30:12")
    self.assertEqual(result["postingDateRaw"], "22/06/2026 04:30:14")
```

- [ ] **Step 6: Chạy test sidecar**

Run:

```bash
cd mbbank-api && python3 -m unittest tests.test_transaction_time -v
```

Expected: 6 tests PASS.

- [ ] **Step 7: Commit task**

```bash
git add mbbank-api/app/mb_client.py mbbank-api/tests/__init__.py mbbank-api/tests/test_transaction_time.py
git diff --cached --check
git commit -m "feat: expose mbbank transaction timestamps"
```

### Task 2: Validation ngày ngân hàng theo timezone Việt Nam

**Files:**
- Create: `mbbank-api/tests/test_validation_timezone.py`
- Modify: `mbbank-api/app/validation.py`

- [ ] **Step 1: Viết test fail cho boundary UTC/Vietnam**

Tạo test:

```python
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from app.validation import SecureTransactionsRequest


class FrozenDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        value = cls(2026, 6, 21, 17, 30, tzinfo=timezone.utc)
        return value.astimezone(tz) if tz is not None else value.replace(tzinfo=None)


class TransactionsDateValidationTest(unittest.TestCase):
    def test_accepts_new_vietnam_day_while_utc_is_previous_day(self):
        with patch("app.validation.datetime", FrozenDateTime):
            payload = SecureTransactionsRequest(
                from_date="2026-06-22",
                to_date="2026-06-22",
            )
        self.assertEqual(payload.from_date, "2026-06-22")


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run:

```bash
cd mbbank-api && python3 -m unittest tests.test_validation_timezone -v
```

Expected: FAIL với lỗi “cannot be in the future”.

- [ ] **Step 3: Implement ngày hiện tại Việt Nam**

Trong `mbbank-api/app/validation.py`:

```python
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

VIETNAM_TIME_ZONE = ZoneInfo("Asia/Ho_Chi_Minh")


def current_vietnam_date():
    return datetime.now(VIETNAM_TIME_ZONE).date()
```

Đổi validation:

```python
date_obj = datetime.strptime(v, "%Y-%m-%d").date()
today = current_vietnam_date()
two_years_ago = today - timedelta(days=730)

if date_obj < two_years_ago:
    raise ValueError("From date cannot be more than 2 years ago")
if date_obj > today:
    raise ValueError("From date cannot be in the future")
```

`to_date` dùng cùng `today`. `validate_date_range` parse `.date()` trước khi trừ.

- [ ] **Step 4: Chạy toàn bộ sidecar tests**

Run:

```bash
cd mbbank-api && python3 -m unittest discover -s tests -v
```

Expected: tất cả tests PASS.

- [ ] **Step 5: Commit task**

```bash
git add mbbank-api/app/validation.py mbbank-api/tests/test_validation_timezone.py
git diff --cached --check
git commit -m "fix: validate mbbank dates in vietnam timezone"
```

### Task 3: Migration metadata đối chiếu

**Files:**
- Create: `src/database/migrations/054_memo_less_payment_matching.js`
- Create: `tests/database/memoLessPaymentMigration.test.js`

- [ ] **Step 1: Viết test fail trên SQLite in-memory**

Tạo test:

```js
const assert = require('node:assert');
const test = require('node:test');
const Database = require('better-sqlite3');
const migration = require('../../src/database/migrations/054_memo_less_payment_matching');

test('migration adds memo-less matching audit columns idempotently', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mb_transaction_number TEXT UNIQUE,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      match_status TEXT DEFAULT 'unmatched'
    )
  `);

  migration.up(db);
  migration.up(db);

  const columns = new Set(
    db.prepare('PRAGMA table_info(transactions)').all().map(row => row.name),
  );
  assert.ok(columns.has('bank_transaction_at'));
  assert.ok(columns.has('match_reason'));
  assert.ok(columns.has('candidate_order_ids_json'));
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run:

```bash
node --test tests/database/memoLessPaymentMigration.test.js
```

Expected: FAIL vì migration chưa tồn tại.

- [ ] **Step 3: Implement migration**

Tạo migration:

```js
function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all()
    .some(row => row.name === column);
}

function addColumn(db, column, definition) {
  if (!hasColumn(db, 'transactions', column)) {
    db.exec(`ALTER TABLE transactions ADD COLUMN ${column} ${definition}`);
  }
}

function up(db) {
  addColumn(db, 'bank_transaction_at', 'DATETIME');
  addColumn(db, 'match_reason', 'TEXT');
  addColumn(db, 'candidate_order_ids_json', 'TEXT');
}

module.exports = { up };
```

- [ ] **Step 4: Chạy test migration**

Run:

```bash
node --test tests/database/memoLessPaymentMigration.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit task**

```bash
git add src/database/migrations/054_memo_less_payment_matching.js tests/database/memoLessPaymentMigration.test.js
git diff --cached --check
git commit -m "feat: store payment matching audit metadata"
```

### Task 4: Matcher thuần theo amount và UTC time

**Files:**
- Create: `src/services/paymentTransactionMatcher.js`
- Create: `tests/services/paymentTransactionMatcher.test.js`

- [ ] **Step 1: Viết bảng test fail cho policy**

Tạo fixtures:

```js
const assert = require('node:assert');
const test = require('node:test');
const {
  matchMemoLessTransaction,
  buildTransactionQuery,
  parseSqliteUtc,
} = require('../../src/services/paymentTransactionMatcher');

function order(overrides = {}) {
  return {
    id: 100908,
    total_price: 431460,
    status: 'pending',
    payment_method: 'bank',
    deleted_at: null,
    created_at: '2026-06-21 21:27:35',
    expires_at: '2026-06-21 21:42:35',
    ...overrides,
  };
}

function tx(overrides = {}) {
  return {
    transactionNumber: 'FT_TEST',
    amount: 432000,
    description: '9PAY',
    transactionTime: '2026-06-21T21:30:12Z',
    ...overrides,
  };
}
```

Thêm các test:

```js
test('unique when one order receives exact or <= 10000 overpay', () => {
  assert.equal(matchMemoLessTransaction(tx(), [order()]).kind, 'unique');
  assert.equal(
    matchMemoLessTransaction(tx({ amount: 441460 }), [order()]).kind,
    'unique',
  );
});

test('review short payment within tolerance', () => {
  const result = matchMemoLessTransaction(tx({ amount: 431459 }), [order()]);
  assert.deepStrictEqual(
    { kind: result.kind, reason: result.reason },
    { kind: 'review', reason: 'short_payment' },
  );
});

test('none outside tolerance', () => {
  assert.equal(
    matchMemoLessTransaction(tx({ amount: 441461 }), [order()]).kind,
    'none',
  );
  assert.equal(
    matchMemoLessTransaction(tx({ amount: 421459 }), [order()]).kind,
    'none',
  );
});

test('ambiguous counts full plus-minus tolerance', () => {
  const result = matchMemoLessTransaction(tx(), [
    order({ id: 1, total_price: 431460 }),
    order({ id: 2, total_price: 438000 }),
  ]);
  assert.equal(result.kind, 'review');
  assert.equal(result.reason, 'ambiguous');
  assert.deepStrictEqual(result.candidateOrderIds, [1, 2]);
});

test('requires valid timestamp', () => {
  const result = matchMemoLessTransaction(tx({ transactionTime: null }), [order()]);
  assert.equal(result.reason, 'missing_transaction_time');
});

test('uses inclusive created and expires plus 24h boundaries', () => {
  assert.equal(
    matchMemoLessTransaction(
      tx({ transactionTime: '2026-06-21T21:27:35Z' }),
      [order()],
    ).kind,
    'unique',
  );
  assert.equal(
    matchMemoLessTransaction(
      tx({ transactionTime: '2026-06-22T21:42:35Z' }),
      [order({ status: 'expired' })],
    ).kind,
    'unique',
  );
  assert.equal(
    matchMemoLessTransaction(
      tx({ transactionTime: '2026-06-22T21:42:36Z' }),
      [order({ status: 'expired' })],
    ).kind,
    'none',
  );
});

test('excludes non-bank, deleted, paid and delivered orders', () => {
  const rows = [
    order({ id: 1, payment_method: 'wallet' }),
    order({ id: 2, deleted_at: '2026-06-21 21:00:00' }),
    order({ id: 3, status: 'paid' }),
    order({ id: 4, status: 'delivered' }),
  ];
  assert.equal(matchMemoLessTransaction(tx(), rows).kind, 'none');
});

test('parses SQLite timestamps as UTC regardless of process TZ', () => {
  assert.equal(
    parseSqliteUtc('2026-06-21 21:27:35').toISOString(),
    '2026-06-21T21:27:35.000Z',
  );
});

test('builds vietnam query range and lowers min amount by tolerance', () => {
  const result = buildTransactionQuery(
    [order()],
    [],
    new Date('2026-06-22T01:00:00Z'),
  );
  assert.deepStrictEqual(result, {
    from_date: '2026-06-22',
    to_date: '2026-06-22',
    min_amount: 421460,
    sort_order: 'desc',
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run:

```bash
node --test tests/services/paymentTransactionMatcher.test.js
```

Expected: FAIL vì module chưa tồn tại.

- [ ] **Step 3: Implement matcher**

Tạo `src/services/paymentTransactionMatcher.js`:

```js
const AMOUNT_TOLERANCE = 10_000;
const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

function parseSqliteUtc(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  const date = new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateInTimeZone(date, timeZone = VIETNAM_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function isEligibleOrder(order, transactionAt, amount) {
  if (order.deleted_at) return false;
  if (order.payment_method && order.payment_method !== 'bank') return false;
  if (order.status !== 'pending' && order.status !== 'expired') return false;

  const createdAt = parseSqliteUtc(order.created_at);
  const expiresAt = parseSqliteUtc(order.expires_at);
  if (!createdAt || !expiresAt) return false;

  const recoveryEndsAt = new Date(expiresAt.getTime() + RECOVERY_WINDOW_MS);
  return transactionAt >= createdAt
    && transactionAt <= recoveryEndsAt
    && Math.abs(amount - Number(order.total_price)) <= AMOUNT_TOLERANCE;
}

function matchMemoLessTransaction(transaction, orders) {
  const transactionAt = new Date(transaction.transactionTime);
  if (!transaction.transactionTime || Number.isNaN(transactionAt.getTime())) {
    return {
      kind: 'review',
      reason: 'missing_transaction_time',
      candidates: [],
      candidateOrderIds: [],
    };
  }

  const amount = Number(transaction.amount);
  const candidates = orders.filter(order => isEligibleOrder(order, transactionAt, amount));
  const candidateOrderIds = candidates.map(order => order.id);

  if (candidates.length === 0) {
    return { kind: 'none', reason: 'no_candidate', candidates, candidateOrderIds };
  }
  if (candidates.length > 1) {
    return { kind: 'review', reason: 'ambiguous', candidates, candidateOrderIds };
  }

  const selectedOrder = candidates[0];
  if (amount < Number(selectedOrder.total_price)) {
    return {
      kind: 'review',
      reason: 'short_payment',
      order: selectedOrder,
      candidates,
      candidateOrderIds,
    };
  }

  return {
    kind: 'unique',
    reason: 'amount_time_unique',
    order: selectedOrder,
    candidates,
    candidateOrderIds,
  };
}

function buildTransactionQuery(orders, topups, now = new Date()) {
  const rows = [...orders, ...topups];
  const dates = rows
    .map(row => parseSqliteUtc(row.created_at))
    .filter(Boolean);
  const earliest = dates.length
    ? new Date(Math.min(...dates.map(date => date.getTime())))
    : now;
  const amounts = [
    ...orders.map(row => Number(row.total_price)),
    ...topups.map(row => Number(row.amount)),
  ].filter(Number.isFinite);
  const minimum = amounts.length ? Math.min(...amounts) : 0;

  return {
    from_date: formatDateInTimeZone(earliest),
    to_date: formatDateInTimeZone(now),
    min_amount: Math.max(0, minimum - AMOUNT_TOLERANCE),
    sort_order: 'desc',
  };
}

module.exports = {
  AMOUNT_TOLERANCE,
  buildTransactionQuery,
  formatDateInTimeZone,
  matchMemoLessTransaction,
  parseSqliteUtc,
};
```

- [ ] **Step 4: Bổ sung cases còn thiếu**

Thêm các test cụ thể:

```js
test('review when payment is exactly 10000 short', () => {
  const result = matchMemoLessTransaction(tx({ amount: 421460 }), [order()]);
  assert.equal(result.kind, 'review');
  assert.equal(result.reason, 'short_payment');
});

test('ambiguous includes an exact candidate and a short candidate', () => {
  const result = matchMemoLessTransaction(tx({ amount: 432000 }), [
    order({ id: 1, total_price: 432000 }),
    order({ id: 2, total_price: 440000 }),
  ]);
  assert.equal(result.reason, 'ambiguous');
  assert.deepStrictEqual(result.candidateOrderIds, [1, 2]);
});

test('excludes transaction before order creation', () => {
  const result = matchMemoLessTransaction(
    tx({ transactionTime: '2026-06-21T21:27:34Z' }),
    [order()],
  );
  assert.equal(result.kind, 'none');
});

test('excludes pending order after recovery boundary', () => {
  const result = matchMemoLessTransaction(
    tx({ transactionTime: '2026-06-22T21:42:36Z' }),
    [order()],
  );
  assert.equal(result.kind, 'none');
});

test('excludes invalid sqlite timestamps', () => {
  assert.equal(
    matchMemoLessTransaction(tx(), [order({ created_at: 'invalid' })]).kind,
    'none',
  );
  assert.equal(
    matchMemoLessTransaction(tx(), [order({ expires_at: null })]).kind,
    'none',
  );
});

test('buildTransactionQuery uses vietnam dates across UTC boundary', () => {
  const result = buildTransactionQuery(
    [order({ created_at: '2026-06-21 17:30:00' })],
    [],
    new Date('2026-06-21T17:45:00Z'),
  );
  assert.equal(result.from_date, '2026-06-22');
  assert.equal(result.to_date, '2026-06-22');
});

test('buildTransactionQuery includes lower topup amount', () => {
  const result = buildTransactionQuery(
    [order()],
    [{ amount: 50000, created_at: '2026-06-21 20:00:00' }],
    new Date('2026-06-22T01:00:00Z'),
  );
  assert.equal(result.min_amount, 40000);
});
```

- [ ] **Step 5: Chạy matcher tests**

Run:

```bash
TZ=UTC node --test tests/services/paymentTransactionMatcher.test.js
TZ=Asia/Ho_Chi_Minh node --test tests/services/paymentTransactionMatcher.test.js
```

Expected: cả hai lần PASS với output giống nhau.

- [ ] **Step 6: Commit task**

```bash
git add src/services/paymentTransactionMatcher.js tests/services/paymentTransactionMatcher.test.js
git diff --cached --check
git commit -m "feat: match memo-less payments by amount and time"
```

### Task 5: Snapshot order candidates và poller request

**Files:**
- Modify: `src/services/orderService.js`
- Modify: `src/services/paymentPoller.js`
- Modify: `tests/services/paymentPollerLifecycle.test.js`
- Modify: `tests/services/orderRecovery.test.js`

- [ ] **Step 1: Viết test fail cho request không lọc PNS**

Trong `tests/services/paymentPollerLifecycle.test.js`, thêm test bắt request body bằng fake `global.fetch`:

```js
test('fetches all credit transactions across vietnam query window', async (t) => {
  const originalFetch = global.fetch;
  let requestBody;
  global.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ success: true, results: [] }),
    };
  };
  t.after(() => { global.fetch = originalFetch; });

  await withPaymentPollerFakes(t, {}, async (PaymentPoller) => {
    const poller = new PaymentPoller(makeDb(), makeBot());
    await poller._fetchTransactions({
      from_date: '2026-06-21',
      to_date: '2026-06-22',
      min_amount: 421460,
      sort_order: 'desc',
    });
  });

  assert.deepStrictEqual(requestBody, {
    from_date: '2026-06-21',
    to_date: '2026-06-22',
    min_amount: 421460,
    sort_order: 'desc',
  });
  assert.ok(!Object.hasOwn(requestBody, 'description_contains'));
  assert.ok(!Object.hasOwn(requestBody, 'limit'));
});
```

- [ ] **Step 2: Viết test fail cho snapshot candidates**

Trong `tests/services/orderRecovery.test.js`, thêm:

```js
test('getPaymentMatchCandidates returns pending and recent expired bank orders only', (t) => {
  const { productId } = setup();
  const pending = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, quantity, total_price, payment_code,
      status, payment_method, expires_at
    ) VALUES (?, ?, 1, 1000, ?, 'pending', 'bank', datetime('now', '+5 minutes'))
  `).run(TEST_USER_ID, productId, `PNS_CAND_PENDING_${Date.now()}`);
  const recentExpired = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, quantity, total_price, payment_code,
      status, payment_method, expires_at
    ) VALUES (?, ?, 1, 1000, ?, 'expired', 'bank', datetime('now', '-1 hour'))
  `).run(TEST_USER_ID, productId, `PNS_CAND_RECENT_${Date.now()}`);
  const oldExpired = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, quantity, total_price, payment_code,
      status, payment_method, expires_at
    ) VALUES (?, ?, 1, 1000, ?, 'expired', 'bank', datetime('now', '-25 hours'))
  `).run(TEST_USER_ID, productId, `PNS_CAND_OLD_${Date.now()}`);
  const wallet = db.prepare(`
    INSERT INTO orders (
      user_id, product_id, quantity, total_price, payment_code,
      status, payment_method, expires_at
    ) VALUES (?, ?, 1, 1000, ?, 'pending', 'wallet', datetime('now', '+5 minutes'))
  `).run(TEST_USER_ID, productId, `PNS_CAND_WALLET_${Date.now()}`);

  const ids = [
    pending.lastInsertRowid,
    recentExpired.lastInsertRowid,
    oldExpired.lastInsertRowid,
    wallet.lastInsertRowid,
  ];
  t.after(() => {
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM orders WHERE id IN (${placeholders})`).run(...ids);
  });

  const resultIds = new Set(
    orderService.getPaymentMatchCandidates(24).map(row => row.id),
  );
  assert.ok(resultIds.has(pending.lastInsertRowid));
  assert.ok(resultIds.has(recentExpired.lastInsertRowid));
  assert.ok(!resultIds.has(oldExpired.lastInsertRowid));
  assert.ok(!resultIds.has(wallet.lastInsertRowid));
});
```

API mới:

```js
orderService.getPaymentMatchCandidates(24)
```

Mỗi row phải có `id`, `total_price`, `status`, `payment_method`, `deleted_at`, `created_at`, `expires_at`, `payment_code`, `user_id`, `product_name`.

- [ ] **Step 3: Chạy tests để xác nhận fail**

Run:

```bash
node --test tests/services/paymentPollerLifecycle.test.js tests/services/orderRecovery.test.js
```

Expected: FAIL vì signature `_fetchTransactions(query)` và service method chưa tồn tại.

- [ ] **Step 4: Implement `getPaymentMatchCandidates()`**

Trong `src/services/orderService.js`:

```js
getPaymentMatchCandidates(hoursBack = 24) {
  return db.prepare(`
    SELECT o.*, p.name AS product_name
    FROM orders o
    JOIN products p ON p.id = o.product_id
    WHERE o.deleted_at IS NULL
      AND COALESCE(o.payment_method, 'bank') = 'bank'
      AND (
        (o.status = 'pending' AND (o.expires_at IS NULL OR o.expires_at > datetime('now')))
        OR (
          o.status = 'expired'
          AND o.expires_at IS NOT NULL
          AND o.expires_at > datetime('now', ?)
        )
      )
    ORDER BY o.created_at ASC
  `).all(`-${hoursBack} hours`);
},
```

Không thay đổi `getActivePending()` và `getRecentlyExpired()` để tránh ảnh hưởng caller khác.

- [ ] **Step 5: Implement query object trong poller**

Import:

```js
const {
  buildTransactionQuery,
  matchMemoLessTransaction,
} = require('./paymentTransactionMatcher');
```

Trong `_poll()`:

```js
const matchableOrders = orderService.getPaymentMatchCandidates(24);
const query = buildTransactionQuery(matchableOrders, pendingTopups);
const transactions = await this._fetchTransactions(query);
```

Đổi `_fetchTransactions()` thành:

```js
async _fetchTransactions(query) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(`${config.MBBANK_API_URL}/transactions/credit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.MBBANK_API_TOKEN}`,
      },
      body: JSON.stringify(query),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`❌ MBBank API error: ${response.status}`);
      return null;
    }
    const data = await response.json();
    if (!data.success) {
      console.error('❌ MBBank API returned error:', data);
      return null;
    }
    return data.results || [];
  } catch (err) {
    console.error('❌ MBBank API fetch error:', err.message);
    return null;
  }
}
```

Xóa helper `formatDateInTimeZone` cục bộ trong `paymentPoller.js` sau khi không còn caller.

- [ ] **Step 6: Chạy tests**

Run:

```bash
node --test tests/services/paymentPollerLifecycle.test.js tests/services/orderRecovery.test.js
```

Expected: PASS.

- [ ] **Step 7: Stage an toàn**

Vì hai file implementation đang dirty trước task:

```bash
git diff -- src/services/orderService.js src/services/paymentPoller.js
git diff -- tests/services/paymentPollerLifecycle.test.js
```

Chỉ stage hunk của feature. Nếu không thể tách sạch, không commit task này.

### Task 6: Persist decision, admin review và idempotency

**Files:**
- Modify: `src/services/paymentPoller.js`
- Modify: `tests/services/paymentPollerLifecycle.test.js`
- Modify: `tests/services/paymentPollerLateRecovery.test.js`

- [ ] **Step 1: Viết tests fail cho ba decision**

Thêm helper DB vào `tests/services/paymentPollerLifecycle.test.js`:

```js
function makeDecisionDb(initialRows = []) {
  const rows = new Map(initialRows.map(row => [row.mb_transaction_number, { ...row }]));
  return {
    rows,
    prepare(sql) {
      if (sql.includes('SELECT id, match_status')) {
        return { get: txNumber => rows.get(txNumber) };
      }
      if (sql.includes('INSERT OR IGNORE INTO transactions')) {
        return {
          run: (
            txNumber, amount, description, orderId, paymentCode, status,
            rawData, bankTransactionAt, reason, candidateJson,
          ) => {
            if (rows.has(txNumber)) return { changes: 0 };
            rows.set(txNumber, {
              id: rows.size + 1,
              mb_transaction_number: txNumber,
              amount,
              description,
              matched_order_id: orderId,
              matched_payment_code: paymentCode,
              match_status: status,
              raw_data: rawData,
              bank_transaction_at: bankTransactionAt,
              match_reason: reason,
              candidate_order_ids_json: candidateJson,
            });
            return { changes: 1 };
          },
        };
      }
      if (sql.includes('UPDATE transactions')) {
        return {
          run: (
            orderId, paymentCode, status, rawData, bankTransactionAt,
            reason, candidateJson, txNumber,
          ) => {
            const current = rows.get(txNumber);
            if (!current) return { changes: 0 };
            rows.set(txNumber, {
              ...current,
              matched_order_id: orderId,
              matched_payment_code: paymentCode,
              match_status: status,
              raw_data: rawData,
              bank_transaction_at: bankTransactionAt,
              match_reason: reason,
              candidate_order_ids_json: candidateJson,
            });
            return { changes: 1 };
          },
        };
      }
      return {
        get: () => undefined,
        all: () => [],
        run: () => ({ changes: 0 }),
      };
    },
  };
}

function memoLessOrder(overrides = {}) {
  return {
    id: 100908,
    user_id: 1819244727,
    total_price: 431460,
    payment_code: 'PNS100908',
    payment_method: 'bank',
    status: 'pending',
    deleted_at: null,
    created_at: '2026-06-21 21:27:35',
    expires_at: '2026-06-21 21:42:35',
    ...overrides,
  };
}

function memoLessTx(overrides = {}) {
  return {
    transactionNumber: 'FT_MEMO_LESS',
    amount: 432000,
    description: '9PAY JSC. TaptapSendVNpayment',
    transactionTime: '2026-06-21T21:30:12Z',
    ...overrides,
  };
}
```

- [ ] **Step 2: Viết executable tests cho decision flow**

```js
test('memo-less unique transaction uses normal order flow', async (t) => {
  const selected = memoLessOrder();
  const orderService = {
    getById: () => selected,
    getPaymentMatchCandidates: () => [selected],
  };
  await withPaymentPollerFakes(t, { orderService }, async (PaymentPoller) => {
    const holder = makeDecisionDb();
    const poller = new PaymentPoller(holder, makeBot());
    let processed;
    poller._processOrderMatch = async (tx, paymentCode, order, options) => {
      processed = { tx, paymentCode, order, options };
      return { success: true };
    };

    await poller._processMemoLessTransaction(memoLessTx(), [selected]);

    assert.equal(processed.paymentCode, 'PNS100908');
    assert.equal(processed.order.id, 100908);
    assert.equal(processed.options.matchReason, 'amount_time_unique');
  });
});

test('memo-less ambiguous transaction is stored as terminal review once', async (t) => {
  const candidates = [
    memoLessOrder({ id: 100908 }),
    memoLessOrder({ id: 100909, total_price: 438000, payment_code: 'PNS100909' }),
  ];
  const adminNotifyService = {
    calls: 0,
    notify: async () => {
      adminNotifyService.calls += 1;
      return true;
    },
  };
  await withPaymentPollerFakes(
    t,
    { adminNotifyService },
    async (PaymentPoller) => {
      const holder = makeDecisionDb();
      const poller = new PaymentPoller(holder, makeBot());
      await poller._processMemoLessTransaction(memoLessTx(), candidates);
      await poller._processMemoLessTransaction(memoLessTx(), candidates);

      const row = holder.rows.get('FT_MEMO_LESS');
      assert.equal(row.match_status, 'review');
      assert.equal(row.match_reason, 'ambiguous');
      assert.equal(adminNotifyService.calls, 1);
    },
  );
});

test('memo-less unmatched transaction is retried when an order appears', async (t) => {
  const selected = memoLessOrder();
  const orderService = {
    getById: () => selected,
    getPaymentMatchCandidates: () => [selected],
  };
  await withPaymentPollerFakes(t, { orderService }, async (PaymentPoller) => {
    const holder = makeDecisionDb();
    const poller = new PaymentPoller(holder, makeBot());
    let processCalls = 0;
    poller._processOrderMatch = async () => {
      processCalls += 1;
      return { success: true };
    };

    await poller._processMemoLessTransaction(memoLessTx(), []);
    assert.equal(holder.rows.get('FT_MEMO_LESS').match_status, 'unmatched');

    await poller._processMemoLessTransaction(memoLessTx(), [selected]);
    assert.equal(processCalls, 1);
  });
});

test('missing transaction time becomes terminal review', async (t) => {
  await withPaymentPollerFakes(t, {}, async (PaymentPoller) => {
    const holder = makeDecisionDb();
    const poller = new PaymentPoller(holder, makeBot());
    poller._notifyMemoLessReview = async () => {};

    await poller._processMemoLessTransaction(
      memoLessTx({ transactionTime: null }),
      [memoLessOrder()],
    );

    const row = holder.rows.get('FT_MEMO_LESS');
    assert.equal(row.match_status, 'review');
    assert.equal(row.match_reason, 'missing_transaction_time');
  });
});
```

- [ ] **Step 3: Viết executable tests cho branch priority và in-flight guard**

```js
test('transaction with PNS uses code branch before memo-less matcher', async (t) => {
  const codedOrder = memoLessOrder({ id: 100777, payment_code: 'PNS100777' });
  const orderService = {
    cleanupExpiredOrders: () => 0,
    cleanupDeletedOrders: () => 0,
    expireStaleOrders: () => [],
    getActivePending: () => [codedOrder],
    getRecentlyExpired: () => [],
    getPaymentMatchCandidates: () => [
      codedOrder,
      memoLessOrder({ id: 100888, payment_code: 'PNS100888' }),
    ],
    getById: () => codedOrder,
  };
  const topupService = {
    getActivePending: () => [],
    expireStale: () => [],
  };
  await withPaymentPollerFakes(
    t,
    { orderService, topupService },
    async (PaymentPoller) => {
      const holder = makeDecisionDb();
      const poller = new PaymentPoller(holder, makeBot());
      poller.running = true;
      poller._fetchTransactions = async () => [{
        ...memoLessTx(),
        description: 'Thanh toan PNS100777',
      }];
      let processedId;
      poller._processOrderMatch = async (_tx, _code, order) => {
        processedId = order.id;
      };
      poller._processMemoLessTransaction = async () => {
        throw new Error('memo-less branch must not run');
      };

      await poller._poll();
      assert.equal(processedId, 100777);
    },
  );
});

test('concurrent poll calls share one in-flight execution', async (t) => {
  await withPaymentPollerFakes(t, {}, async (PaymentPoller) => {
    const poller = new PaymentPoller(makeDecisionDb(), makeBot());
    let calls = 0;
    let release;
    poller._pollCycle = async () => {
      calls += 1;
      await new Promise(resolve => { release = resolve; });
    };

    const first = poller._poll();
    const second = poller._poll();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls, 1);
    release();
    await Promise.all([first, second]);
  });
});
```

- [ ] **Step 4: Chạy tests để xác nhận fail**

Run:

```bash
node --test tests/services/paymentPollerLifecycle.test.js
```

Expected: các tests mới FAIL.

- [ ] **Step 5: Mở rộng prepared statements**

Trong constructor:

```js
this.getTransactionState = db.prepare(`
  SELECT id, match_status
  FROM transactions
  WHERE mb_transaction_number = ?
`);

this.insertTransaction = db.prepare(`
  INSERT OR IGNORE INTO transactions (
    mb_transaction_number,
    amount,
    description,
    matched_order_id,
    matched_payment_code,
    match_status,
    raw_data,
    bank_transaction_at,
    match_reason,
    candidate_order_ids_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

this.updateTransactionDecision = db.prepare(`
  UPDATE transactions
  SET matched_order_id = ?,
      matched_payment_code = ?,
      match_status = ?,
      raw_data = ?,
      bank_transaction_at = ?,
      match_reason = ?,
      candidate_order_ids_json = ?
  WHERE mb_transaction_number = ?
`);
```

Thêm converter:

```js
function toSqliteUtc(transactionTime) {
  const value = new Date(transactionTime);
  if (Number.isNaN(value.getTime())) return null;
  return value.toISOString().slice(0, 19).replace('T', ' ');
}
```

Việc dùng `toISOString()` ở đây chỉ serialize instant UTC vào SQLite; không dùng để tính ngày MBBank.

- [ ] **Step 6: Thêm persistence helpers**

```js
_persistTransactionDecision(tx, decision, order = null) {
  const paymentCode = order?.payment_code || null;
  const candidateJson = JSON.stringify(decision.candidateOrderIds || []);
  const status = decision.kind === 'none' ? 'unmatched' : decision.kind;
  const args = [
    order?.id || null,
    paymentCode,
    status,
    JSON.stringify(tx),
    toSqliteUtc(tx.transactionTime),
    decision.reason,
    candidateJson,
  ];
  const existing = this.getTransactionState.get(tx.transactionNumber);

  if (existing) {
    this.updateTransactionDecision.run(...args, tx.transactionNumber);
    return;
  }

  this.insertTransaction.run(
    tx.transactionNumber,
    tx.amount,
    tx.description || '',
    ...args,
  );
}
```

Khi implement, giữ đúng thứ tự 10 placeholder của `insertTransaction`; viết unit test fake DB bắt argument để tránh lệch cột.

- [ ] **Step 7: Tách `_pollCycle()` và guard in-flight**

Đổi tên method `_poll()` hiện tại thành `_pollCycle()` và giữ nguyên toàn bộ body. Thêm wrapper `_poll()`:

```js
async _poll() {
  if (this.pollInFlight) return this.pollInFlight;
  this.pollInFlight = this._pollCycle();
  try {
    return await this.pollInFlight;
  } finally {
    this.pollInFlight = null;
  }
}
```

- [ ] **Step 8: Implement `_processMemoLessTransaction()`**

Thêm method:

```js
async _processMemoLessTransaction(tx, matchableOrders) {
  const existing = this.getTransactionState.get(tx.transactionNumber);
  if (existing && ['matched', 'review'].includes(existing.match_status)) {
    return { kind: 'skipped', reason: existing.match_status };
  }

  let decision = matchMemoLessTransaction(tx, matchableOrders);
  if (decision.kind === 'unique') {
    const freshOrder = orderService.getById(decision.order.id);
    decision = matchMemoLessTransaction(tx, freshOrder ? [freshOrder] : []);
    if (decision.kind !== 'unique') {
      decision = matchMemoLessTransaction(
        tx,
        orderService.getPaymentMatchCandidates(24),
      );
    }
  }

  if (decision.kind === 'unique') {
    return await this._processOrderMatch(
      tx,
      decision.order.payment_code,
      decision.order,
      { matchReason: 'amount_time_unique' },
    );
  }

  this._persistTransactionDecision(tx, decision, decision.order);
  if (decision.kind === 'review') {
    await this._notifyMemoLessReview(tx, decision);
  }
  return decision;
}
```

Trong transaction loop:

```js
const parsed = this._extractPaymentCode(tx.description);
if (!parsed) {
  await this._processMemoLessTransaction(tx, matchableOrders);
  continue;
}

if (parsed.kind === 'order') {
  const order = orderMap.get(parsed.value);
  if (order) {
    await this._processOrderMatch(tx, parsed.value, order);
    orderMap.delete(parsed.value);
  } else {
    await this._handleOrphanedOrderTx(tx, parsed.value);
  }
} else {
  const topup = topupMap.get(parsed.value);
  if (topup) {
    await this._processTopupMatch(tx, parsed.value, topup);
    topupMap.delete(parsed.value);
  } else {
    await this._handleOrphanedTopupTx(tx, parsed.value);
  }
}
```

- [ ] **Step 9: Không ghi matched trước delivery thành công**

Điều chỉnh flow:

- `unique` chỉ claim transaction trong memory/in-flight trước khi gọi `_processOrderMatch`.
- `_processOrderMatch` tiếp tục là nơi ghi transaction `matched`.
- Nếu flow trả `null` vì short payment có mã `PNS`, giữ policy hiện tại.
- Memo-less short payment không gọi `_processOrderMatch`, nên order không bị đổi status.
- Sau khi fresh order không còn hợp lệ, chạy matcher lại trên toàn snapshot mới thay vì gắn transaction vào order cũ.

Đổi signature:

```js
async _processOrderMatch(tx, paymentCode, order, options = {}) {
  const matchReason = options.matchReason || 'payment_code';
}
```

Giữ nguyên lookup, expired recovery, short-payment và delivery branches bên trong method. Tại nhánh full payment, thay đoạn:

```js
this._logTransaction(tx, order.id, paymentCode, 'matched');
this.updateTransactionMatched.run(
  order.id,
  paymentCode,
  JSON.stringify(tx),
  tx.transactionNumber,
);
```

bằng:

```js
this._logTransaction(tx, order.id, paymentCode, 'matched', {
  matchReason,
  candidateOrderIds: [order.id],
});
this.updateTransactionDecision.run(
  order.id,
  paymentCode,
  'matched',
  JSON.stringify(tx),
  toSqliteUtc(tx.transactionTime),
  matchReason,
  JSON.stringify([order.id]),
  tx.transactionNumber,
);
```

Đổi `_logTransaction()`:

```js
_logTransaction(tx, orderId, paymentCode, status, metadata = {}) {
  this.insertTransaction.run(
    tx.transactionNumber,
    tx.amount,
    tx.description || '',
    orderId,
    paymentCode,
    status,
    JSON.stringify(tx),
    toSqliteUtc(tx.transactionTime),
    metadata.matchReason || (paymentCode ? 'payment_code' : 'no_candidate'),
    JSON.stringify(metadata.candidateOrderIds || (orderId ? [orderId] : [])),
  );
}
```

Thay mọi `updateTransactionMatched.run(...)` bằng `updateTransactionDecision.run(...)` với status `matched`, reason `payment_code` và candidate list tương ứng. Không gọi `_persistTransactionDecision(... unique ...)` trước `_processOrderMatch`.

- [ ] **Step 10: Implement admin review notification**

```js
async _notifyMemoLessReview(tx, decision) {
  const reasonLabels = {
    ambiguous: 'Có nhiều đơn cùng phù hợp',
    short_payment: 'Số tiền nhận thấp hơn giá đơn',
    missing_transaction_time: 'Ngân hàng không trả timestamp hợp lệ',
  };
  const candidateLines = (decision.candidates || []).map(order => {
    const delta = Number(tx.amount) - Number(order.total_price);
    return `• #${order.id}: ${formatPrice(order.total_price)} (${delta >= 0 ? '+' : ''}${formatPrice(delta)}) — ${order.status}`;
  });
  const time = tx.transactionTime
    ? new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(new Date(tx.transactionTime))
    : 'Không có';

  const body = [
    '⚠️ <b>Giao dịch cần đối chiếu</b>',
    '',
    `Mã GD: <code>${escapeHtml(tx.transactionNumber || '—')}</code>`,
    `Thời gian: <b>${escapeHtml(time)}</b>`,
    `Số tiền: <b>${formatPrice(tx.amount)}</b>`,
    `Nội dung: <code>${escapeHtml(tx.description || '—')}</code>`,
    `Lý do: <b>${escapeHtml(reasonLabels[decision.reason] || decision.reason)}</b>`,
    candidateLines.length ? `\n${candidateLines.join('\n')}` : '',
  ].filter(Boolean).join('\n');

  await adminNotifyService.notify('payment_short', body, { parse_mode: 'HTML' });
}
```

Sửa format delta để `formatPrice()` không nhận số âm nếu helper hiện tại không hỗ trợ; format trị tuyệt đối rồi thêm dấu.

- [ ] **Step 11: Chạy lifecycle và recovery tests**

Run:

```bash
node --test \
  tests/services/paymentTransactionMatcher.test.js \
  tests/services/paymentPollerLifecycle.test.js \
  tests/services/paymentPollerLateRecovery.test.js \
  tests/services/orderRecovery.test.js
```

Expected: PASS.

- [ ] **Step 12: Kiểm tra fixture 100908 không thay đổi DB**

Run read-only:

```bash
node -e "const db=require('./src/database'); console.log(db.prepare('SELECT id,status,total_price,payment_code,paid_at FROM orders WHERE id=?').get(100908))"
```

Expected: lệnh chỉ in state; không auto-confirm đơn lịch sử trong test.

- [ ] **Step 13: Stage an toàn**

```bash
git diff -- src/services/paymentPoller.js tests/services/paymentPollerLifecycle.test.js tests/services/paymentPollerLateRecovery.test.js
git diff --check
```

Không commit nếu staged diff kéo theo thay đổi có sẵn ngoài feature.

### Task 7: Documentation và final verification

**Files:**
- Modify: `mbbank-api/README.md`
- Modify: `docs/superpowers/plans/2026-06-22-mbbank-memo-less-payment-matching.md` chỉ để tick checklist nếu thực thi trực tiếp.

- [ ] **Step 1: Document response fields**

Sửa example response:

```json
{
  "transactionNumber": "FT26173165960097",
  "amount": 432000,
  "description": "9PAY JSC. TaptapSendVNpayment",
  "type": "IN",
  "transactionTime": "2026-06-21T21:30:12Z",
  "transactionDateRaw": "22/06/2026 04:30:12",
  "postingDateRaw": "22/06/2026 04:30:14"
}
```

Ghi rõ raw timestamp không có offset được hiểu là `Asia/Ho_Chi_Minh`; `transactionTime` luôn là UTC ISO hoặc `null`.

- [ ] **Step 2: Chạy Python verification**

```bash
cd mbbank-api && python3 -m unittest discover -s tests -v
```

Expected: tất cả sidecar tests PASS.

- [ ] **Step 3: Chạy Node verification**

```bash
node --test \
  tests/database/memoLessPaymentMigration.test.js \
  tests/services/paymentTransactionMatcher.test.js \
  tests/services/paymentPollerLifecycle.test.js \
  tests/services/paymentPollerLateRecovery.test.js \
  tests/services/orderRecovery.test.js \
  tests/services/pollerInterval.test.js
```

Expected: tất cả tests PASS.

- [ ] **Step 4: Chạy regression payment API**

```bash
node --test tests/api/customer-order-status-backorder.test.js tests/api/admin-orders-expired-confirm.test.js
```

Expected: PASS.

- [ ] **Step 5: Static checks**

```bash
node -e "const db=require('./src/database'); const cols=new Set(db.prepare('PRAGMA table_info(transactions)').all().map(x=>x.name)); for (const c of ['bank_transaction_at','match_reason','candidate_order_ids_json']) if (!cols.has(c)) throw new Error('missing '+c); console.log('transaction audit columns ok')"
rg -n "description_contains:\\s*['\"]PNS|toISOString\\(\\).*slice\\(0, 10\\)|toISOString\\(\\).*split\\('T'\\)" src/services/paymentPoller.js
git diff --check
git status --short
```

Expected:

- In `transaction audit columns ok`.
- `rg` không tìm thấy filter `description_contains: "PNS"` hoặc UTC ISO date dùng làm ngày query.
- `git diff --check` không có output.
- `git status` không stage `data/shop.db`, backup hoặc log.

- [ ] **Step 6: Controlled live read-only verification**

Gọi sidecar bằng request read-only ngày hiện tại và chỉ in field cần kiểm tra:

```bash
curl -sS --max-time 60 -X POST "$MBBANK_API_URL/transactions/credit" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $MBBANK_API_TOKEN" \
  --data '{"from_date":"2026-06-22","to_date":"2026-06-22","min_amount":0,"limit":5,"sort_order":"desc"}'
```

Expected: mỗi result có `transactionTime`, `transactionDateRaw`, `postingDateRaw`. Không log token.

- [ ] **Step 7: Request code review**

Invoke `superpowers:requesting-code-review` và yêu cầu review:

- Policy `±10.000đ`, auto chỉ khi không thiếu tiền.
- Timezone UTC/`Asia/Ho_Chi_Minh`.
- Idempotency `matched/review/unmatched`.
- Không regression nhánh `PNS`, topup và late recovery.

- [ ] **Step 8: Commit docs nếu staging sạch**

```bash
git add mbbank-api/README.md
git diff --cached --check
git commit -m "docs: document mbbank transaction timestamps"
```

Không commit `data/shop.db` hoặc file implementation dirty không tách hunk an toàn.
