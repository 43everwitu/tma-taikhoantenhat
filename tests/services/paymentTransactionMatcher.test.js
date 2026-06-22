const assert = require('node:assert');
const test = require('node:test');
const {
  AMOUNT_TOLERANCE,
  RECOVERY_WINDOW_MS,
  VIETNAM_TIME_ZONE,
  buildTransactionQuery,
  formatDateInTimeZone,
  matchMemoLessTransaction,
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
    amount: 431460,
    description: '9PAY',
    transactionTime: '2026-06-21T21:30:12Z',
    ...overrides,
  };
}

test('exports matching policy constants', () => {
  assert.strictEqual(AMOUNT_TOLERANCE, 10000);
  assert.strictEqual(RECOVERY_WINDOW_MS, 24 * 60 * 60 * 1000);
  assert.strictEqual(VIETNAM_TIME_ZONE, 'Asia/Ho_Chi_Minh');
});

test('matches exact payment and overpayment up to 10000, but not 10001', () => {
  for (const amount of [431460, 441460]) {
    const result = matchMemoLessTransaction(tx({ amount }), [order()]);
    assert.strictEqual(result.kind, 'unique');
    assert.strictEqual(result.reason, 'amount_time_unique');
    assert.strictEqual(result.order.id, 100908);
    assert.deepStrictEqual(result.candidateOrderIds, [100908]);
    assert.deepStrictEqual(result.candidates.map(row => row.id), [100908]);
  }

  const outside = matchMemoLessTransaction(tx({ amount: 441461 }), [order()]);
  assert.deepStrictEqual(outside, {
    kind: 'none',
    reason: 'no_candidate',
    candidates: [],
    candidateOrderIds: [],
  });
});

test('sends short payments within tolerance to review and rejects lower amounts', () => {
  for (const amount of [431459, 421460]) {
    const result = matchMemoLessTransaction(tx({ amount }), [order()]);
    assert.strictEqual(result.kind, 'review');
    assert.strictEqual(result.reason, 'short_payment');
    assert.strictEqual(result.order.id, 100908);
    assert.deepStrictEqual(result.candidateOrderIds, [100908]);
  }

  const outside = matchMemoLessTransaction(tx({ amount: 421459 }), [order()]);
  assert.strictEqual(outside.kind, 'none');
  assert.strictEqual(outside.reason, 'no_candidate');
  assert.deepStrictEqual(outside.candidates, []);
  assert.deepStrictEqual(outside.candidateOrderIds, []);
});

test('returns ambiguous candidates in order input order', () => {
  const result = matchMemoLessTransaction(tx({ amount: 432000 }), [
    order({ id: 2, total_price: 438000 }),
    order({ id: 1, total_price: 431460 }),
  ]);

  assert.strictEqual(result.kind, 'review');
  assert.strictEqual(result.reason, 'ambiguous');
  assert.deepStrictEqual(result.candidateOrderIds, [2, 1]);
  assert.deepStrictEqual(result.candidates.map(row => row.id), [2, 1]);
  assert.strictEqual(result.order, undefined);
});

test('ambiguous result includes exact and short-payment candidates', () => {
  const result = matchMemoLessTransaction(tx({ amount: 432000 }), [
    order({ id: 1, total_price: 432000 }),
    order({ id: 2, total_price: 440000 }),
  ]);

  assert.strictEqual(result.kind, 'review');
  assert.strictEqual(result.reason, 'ambiguous');
  assert.deepStrictEqual(result.candidateOrderIds, [1, 2]);
});

test('missing or invalid transaction timestamp requires review', () => {
  for (const transactionTime of [null, undefined, '', 'invalid']) {
    const result = matchMemoLessTransaction(tx({ transactionTime }), [order()]);
    assert.deepStrictEqual(result, {
      kind: 'review',
      reason: 'missing_transaction_time',
      candidates: [],
      candidateOrderIds: [],
    });
  }
});

test('transaction time boundaries are inclusive through expiry plus 24 hours', () => {
  const cases = [
    ['2026-06-21T21:27:34Z', 'none'],
    ['2026-06-21T21:27:35Z', 'unique'],
    ['2026-06-22T21:42:35Z', 'unique'],
    ['2026-06-22T21:42:36Z', 'none'],
  ];

  for (const [transactionTime, expectedKind] of cases) {
    const result = matchMemoLessTransaction(
      tx({ transactionTime }),
      [order({ status: 'expired' })],
    );
    assert.strictEqual(result.kind, expectedKind, transactionTime);
  }
});

test('excludes ineligible orders and accepts null payment method as bank', () => {
  const rows = [
    order({ id: 1, payment_method: 'wallet' }),
    order({ id: 2, deleted_at: '2026-06-21 21:00:00' }),
    order({ id: 3, status: 'paid' }),
    order({ id: 4, status: 'delivered' }),
    order({ id: 5, created_at: 'invalid' }),
    order({ id: 6, expires_at: null }),
    order({ id: 7, created_at: '2026-02-30 21:27:35' }),
  ];

  assert.strictEqual(matchMemoLessTransaction(tx(), rows).kind, 'none');

  const nullMethod = matchMemoLessTransaction(
    tx(),
    [order({ payment_method: null })],
  );
  assert.strictEqual(nullMethod.kind, 'unique');
});

test('parseSqliteUtc parses only valid SQLite timestamps as UTC', () => {
  assert.strictEqual(
    parseSqliteUtc('2026-06-21 21:27:35').toISOString(),
    '2026-06-21T21:27:35.000Z',
  );

  for (const value of [
    null,
    undefined,
    '2026-06-21T21:27:35Z',
    '2026-06-21 21:27',
    '2026-02-30 21:27:35',
    'invalid',
  ]) {
    assert.strictEqual(parseSqliteUtc(value), null);
  }
});

test('formatDateInTimeZone uses the requested timezone', () => {
  const instant = new Date('2026-06-21T17:30:00Z');
  assert.strictEqual(formatDateInTimeZone(instant, 'UTC'), '2026-06-21');
  assert.strictEqual(
    formatDateInTimeZone(instant, VIETNAM_TIME_ZONE),
    '2026-06-22',
  );
});

test('buildTransactionQuery lowers order minimum by tolerance', () => {
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

test('buildTransactionQuery handles UTC to Vietnam date boundary', () => {
  const result = buildTransactionQuery(
    [order({ created_at: '2026-06-21 17:30:00' })],
    [],
    new Date('2026-06-21T17:45:00Z'),
  );

  assert.strictEqual(result.from_date, '2026-06-22');
  assert.strictEqual(result.to_date, '2026-06-22');
});

test('buildTransactionQuery uses a lower topup amount and earliest valid date', () => {
  const result = buildTransactionQuery(
    [order()],
    [{ amount: 50000, created_at: '2026-06-21 20:00:00' }],
    new Date('2026-06-22T01:00:00Z'),
  );

  assert.deepStrictEqual(result, {
    from_date: '2026-06-22',
    to_date: '2026-06-22',
    min_amount: 40000,
    sort_order: 'desc',
  });
});

test('buildTransactionQuery falls back to now when no created timestamp is valid', () => {
  const now = new Date('2026-06-21T17:45:00Z');
  const result = buildTransactionQuery(
    [order({ created_at: 'invalid', total_price: 5000 })],
    [],
    now,
  );

  assert.deepStrictEqual(result, {
    from_date: '2026-06-22',
    to_date: '2026-06-22',
    min_amount: 0,
    sort_order: 'desc',
  });
});
