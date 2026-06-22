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

function isEligibleOrder(order, transactionAt, amount) {
  if (order.deleted_at) return false;
  if (order.payment_method !== 'bank' && order.payment_method !== null) return false;
  if (order.status !== 'pending' && order.status !== 'expired') return false;

  const createdAt = parseSqliteUtc(order.created_at);
  const expiresAt = parseSqliteUtc(order.expires_at);
  const total = Number(order.total_price);
  if (!createdAt || !expiresAt || !Number.isFinite(total)) return false;

  const recoveryEndsAt = expiresAt.getTime() + RECOVERY_WINDOW_MS;
  return transactionAt.getTime() >= createdAt.getTime()
    && transactionAt.getTime() <= recoveryEndsAt
    && Math.abs(amount - total) <= AMOUNT_TOLERANCE;
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
  const createdDates = [...orders, ...topups]
    .map(row => parseSqliteUtc(row.created_at))
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
