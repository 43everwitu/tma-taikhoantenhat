const AMOUNT_TOLERANCE = 10_000;
const RECOVERY_WINDOW_MS = 24 * 60 * 60 * 1000;
const VIETNAM_TIME_ZONE = 'Asia/Ho_Chi_Minh';

function parseSqliteUtc(value) {
  if (typeof value !== 'string') return null;

  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  );
  if (!match) return null;

  const parts = match.slice(1).map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second
  ) {
    return null;
  }

  return date;
}

function formatDateInTimeZone(date, timeZone = VIETNAM_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function parseTransactionInstant(value) {
  if (
    typeof value !== 'string'
    || !/(Z|[+-]\d{2}:?\d{2})$/.test(value)
  ) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isAmountEligibleOrder(order, amount) {
  if (order.deleted_at) return false;
  if (order.payment_method !== 'bank' && order.payment_method !== null) return false;
  if (order.status !== 'pending' && order.status !== 'expired') return false;

  const total = Number(order.total_price);
  if (!Number.isFinite(total)) return false;

  return Math.abs(amount - total) <= AMOUNT_TOLERANCE;
}

function isEligibleOrder(order, transactionAt, amount) {
  if (!isAmountEligibleOrder(order, amount)) return false;

  const createdAt = parseSqliteUtc(order.created_at);
  const expiresAt = parseSqliteUtc(order.expires_at);
  if (!createdAt || !expiresAt) return false;

  const recoveryEndsAt = expiresAt.getTime() + RECOVERY_WINDOW_MS;
  return transactionAt.getTime() >= createdAt.getTime()
    && transactionAt.getTime() <= recoveryEndsAt;
}

function matchMemoLessTransaction(transaction, orders) {
  const amount = Number(transaction.amount);
  const transactionAt = parseTransactionInstant(transaction.transactionTime);
  if (!transactionAt) {
    // No parseable timestamp from the bank — we can't apply the time window,
    // so fall back to an amount-only check. Without this, a transaction that
    // doesn't belong to us at all (e.g. another system's payment code) would
    // still trigger a review alert just because the bank omitted a timestamp.
    const candidates = orders.filter(order => isAmountEligibleOrder(order, amount));
    if (candidates.length === 0) {
      return {
        kind: 'none',
        reason: 'no_candidate',
        candidates: [],
        candidateOrderIds: [],
      };
    }
    return {
      kind: 'review',
      reason: 'missing_transaction_time',
      candidates,
      candidateOrderIds: candidates.map(order => order.id),
    };
  }

  const candidates = orders.filter(order => (
    isEligibleOrder(order, transactionAt, amount)
  ));
  const candidateOrderIds = candidates.map(order => order.id);

  if (candidates.length === 0) {
    return {
      kind: 'none',
      reason: 'no_candidate',
      candidates,
      candidateOrderIds,
    };
  }

  if (candidates.length > 1) {
    return {
      kind: 'review',
      reason: 'ambiguous',
      candidates,
      candidateOrderIds,
    };
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
  const createdDates = [
    ...orders.map(row => parseSqliteUtc(row.created_at)),
    ...topups.map(row => parseSqliteUtc(row.requested_at)),
  ]
    .filter(Boolean);
  const earliest = createdDates.length
    ? new Date(Math.min(...createdDates.map(date => date.getTime())))
    : now;
  const amounts = [
    ...orders.map(row => Number(row.total_price)),
    ...topups.map(row => Number(row.amount)),
  ].filter(Number.isFinite);
  const minimum = amounts.length ? Math.min(...amounts) : 0;

  return {
    from_date: formatDateInTimeZone(earliest, VIETNAM_TIME_ZONE),
    to_date: formatDateInTimeZone(now, VIETNAM_TIME_ZONE),
    min_amount: Math.max(0, minimum - AMOUNT_TOLERANCE),
    sort_order: 'desc',
  };
}

module.exports = {
  AMOUNT_TOLERANCE,
  RECOVERY_WINDOW_MS,
  VIETNAM_TIME_ZONE,
  buildTransactionQuery,
  formatDateInTimeZone,
  matchMemoLessTransaction,
  parseSqliteUtc,
};
