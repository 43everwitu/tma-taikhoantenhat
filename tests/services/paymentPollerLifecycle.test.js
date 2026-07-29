const assert = require('node:assert');
const test = require('node:test');

function makeDb() {
  return {
    prepare() {
      return {
        get: () => undefined,
        all: () => [],
        run: () => ({ changes: 0 }),
      };
    },
  };
}

function makeDecisionDb(initialRows = [], options = {}) {
  const rows = new Map(
    initialRows.map(row => [row.mb_transaction_number, { ...row }]),
  );

  return {
    rows,
    prepare(sql) {
      if (
        sql.includes('SELECT')
        && sql.includes('match_status')
        && sql.includes('FROM transactions')
      ) {
        return { get: txNumber => rows.get(txNumber) };
      }
      if (
        sql.includes('SELECT id FROM transactions')
        && sql.includes("match_status = 'matched'")
      ) {
        return {
          get: (txNumber) => {
            const row = rows.get(txNumber);
            return row?.match_status === 'matched' ? row : undefined;
          },
        };
      }
      if (
        sql.includes('SELECT match_status FROM transactions')
        && sql.includes('mb_transaction_number')
      ) {
        return { get: txNumber => rows.get(txNumber) };
      }
      if (sql.includes('INSERT OR IGNORE INTO transactions')) {
        return {
          run: (
            txNumber,
            amount,
            description,
            orderId,
            paymentCode,
            status,
            rawData,
            bankTransactionAt,
            reason,
            candidateJson,
          ) => {
            if (options.throwOnInsert) throw new Error(options.throwOnInsert);
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
      if (
        sql.includes('UPDATE transactions')
        && sql.includes("match_status = 'unmatched'")
        && sql.includes('matched_order_id IS NULL')
      ) {
        return {
          run: (
            orderId,
            paymentCode,
            rawData,
            bankTransactionAt,
            reason,
            candidateJson,
            txNumber,
          ) => {
            const current = rows.get(txNumber);
            if (!current || current.match_status !== 'unmatched' || current.matched_order_id != null) {
              return { changes: 0 };
            }
            rows.set(txNumber, {
              ...current,
              matched_order_id: orderId,
              matched_payment_code: paymentCode,
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
            orderId,
            paymentCode,
            status,
            rawData,
            bankTransactionAt,
            reason,
            candidateJson,
            txNumber,
          ) => {
            if (status === 'matched' && options.throwOnMatchedUpdate) {
              throw new Error(options.throwOnMatchedUpdate);
            }
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

function makeBot() {
  return {
    telegram: {
      sendMessage: async () => ({ message_id: 1 }),
      deleteMessage: async () => true,
    },
  };
}

async function withPaymentPollerFakes(t, fakes, fn) {
  const pollerPath = require.resolve('../../src/services/paymentPoller');
  const modulePaths = {
    orderService: require.resolve('../../src/services/orderService'),
    topupService: require.resolve('../../src/services/topupService'),
    pollerConfig: require.resolve('../../src/services/pollerConfig'),
    adminNotifyService: require.resolve('../../src/services/adminNotifyService'),
    messageTemplateService: require.resolve('../../src/services/messageTemplateService'),
    orderChannelService: require.resolve('../../src/services/orderChannelService'),
    variantService: require.resolve('../../src/services/variantService'),
    productService: require.resolve('../../src/services/productService'),
    database: require.resolve('../../src/database'),
  };
  const previous = new Map();

  for (const path of [pollerPath, ...Object.values(modulePaths)]) {
    previous.set(path, require.cache[path]);
  }

  delete require.cache[pollerPath];
  for (const [key, exports] of Object.entries(fakes)) {
    require.cache[modulePaths[key]] = {
      id: modulePaths[key],
      filename: modulePaths[key],
      loaded: true,
      exports,
    };
  }

  t.after(() => {
    delete require.cache[pollerPath];
    for (const [path, cached] of previous.entries()) {
      if (cached) require.cache[path] = cached;
      else delete require.cache[path];
    }
  });

  const { PaymentPoller } = require('../../src/services/paymentPoller');
  await fn(PaymentPoller);
}

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

test('fetch timeout aborts while response body is still pending', async (t) => {
  const originalFetch = global.fetch;
  const originalConsoleError = console.error;
  let signalAborted = false;
  const errors = [];
  global.fetch = async (_url, options) => ({
    ok: true,
    json: () => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        signalAborted = true;
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    }),
  });
  console.error = (...args) => {
    errors.push(args.map(String).join(' '));
  };
  t.after(() => {
    global.fetch = originalFetch;
    console.error = originalConsoleError;
  });

  await withPaymentPollerFakes(t, {}, async (PaymentPoller) => {
    const poller = new PaymentPoller(makeDb(), makeBot());
    const result = await Promise.race([
      poller._fetchTransactions({
        from_date: '2026-06-22',
        to_date: '2026-06-22',
        min_amount: 0,
        sort_order: 'desc',
      }, 20),
      new Promise(resolve => setTimeout(() => resolve('timeout-not-aborted'), 100)),
    ]);

    assert.strictEqual(result, null);
  });

  assert.strictEqual(signalAborted, true);
  assert.ok(errors.some(message => message.includes('aborted')));
});

test('ensureRunning reset so dem khi poller dang chay va co don moi', async (t) => {
  await withPaymentPollerFakes(t, {}, async (PaymentPoller) => {
    const poller = new PaymentPoller(makeDb(), makeBot());
    poller.running = true;
    poller.attempts = 59;

    poller.ensureRunning();

    assert.strictEqual(poller.running, true);
    assert.strictEqual(poller.attempts, 0);
  });
});

test('poller expire stale pending truoc khi tinh danh sach recoverable', async (t) => {
  const expiredOrder = {
    id: 123456,
    user_id: 999123456,
    product_id: 42,
    product_name: 'Fixture',
    payment_code: 'PNS123456',
    total_price: 1000,
    status: 'expired',
  };
  let expireCalls = 0;
  let fetchedQuery;

  const orderService = {
    cleanupExpiredOrders: () => 0,
    cleanupDeletedOrders: () => 0,
    expireStaleOrders: () => {
      expireCalls += 1;
      return [expiredOrder];
    },
    getActivePending: () => [],
    getRecentlyExpired: () => (expireCalls > 0 ? [expiredOrder] : []),
    getPaymentMatchCandidates: () => (expireCalls > 0 ? [expiredOrder] : []),
    getById: () => ({ ...expiredOrder, status: 'expired' }),
  };
  const topupService = {
    getActivePending: () => [],
    expireStale: () => [],
  };

  await withPaymentPollerFakes(t, { orderService, topupService }, async (PaymentPoller) => {
    const poller = new PaymentPoller(makeDb(), makeBot());
    poller.running = true;
    poller._fetchTransactions = async (query) => {
      fetchedQuery = query;
      return [];
    };
    poller._notifyExpired = async () => {};

    await poller._poll();
  });

  assert.strictEqual(expireCalls, 1);
  assert.strictEqual(fetchedQuery.min_amount, 0);
  assert.strictEqual(fetchedQuery.sort_order, 'desc');
});

test('poller fetches and stays running for a boundary match candidate', async (t) => {
  const boundaryOrder = {
    id: 123457,
    user_id: 999123457,
    product_id: 43,
    product_name: 'Boundary Fixture',
    payment_code: 'PNS123457',
    total_price: 432000,
    payment_method: 'bank',
    status: 'expired',
    created_at: '2026-06-21 21:30:00',
    expires_at: '2026-06-21 21:40:00',
    deleted_at: null,
  };
  let fetchCalls = 0;

  const orderService = {
    expireStaleOrders: () => [],
    getActivePending: () => [],
    getRecentlyExpired: () => [],
    getPaymentMatchCandidates: () => [boundaryOrder],
    getById: () => boundaryOrder,
  };
  const topupService = {
    getActivePending: () => [],
    expireStale: () => [],
  };

  await withPaymentPollerFakes(t, { orderService, topupService }, async (PaymentPoller) => {
    const poller = new PaymentPoller(makeDb(), makeBot());
    poller.running = true;
    poller._fetchTransactions = async () => {
      fetchCalls += 1;
      return [];
    };

    await poller._poll();

    assert.strictEqual(poller.running, true);
  });

  assert.strictEqual(fetchCalls, 1);
});

test('orphaned transaction cua don da ton tai van danh dau payment_matched_at', async (t) => {
  let markedOrderId = null;
  let loggedTransaction = null;
  const db = {
    prepare(sql) {
      if (sql.includes('INSERT OR IGNORE INTO transactions')) {
        return {
          run: (...args) => {
            loggedTransaction = args;
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
  const orderService = {
    getByPaymentCode: () => ({ id: 777, status: 'delivered', user_id: 999777 }),
    getRecoverableExpiredByPaymentCode: () => null,
    markPaymentMatched: (orderId) => { markedOrderId = orderId; },
  };
  const adminNotifyService = { notify: () => {} };
  const messageTemplateService = { render: () => 'admin notice' };

  await withPaymentPollerFakes(t, { orderService, adminNotifyService, messageTemplateService }, async (PaymentPoller) => {
    const poller = new PaymentPoller(db, makeBot());
    await poller._handleOrphanedOrderTx(
      { transactionNumber: 'FT_ORPHAN', amount: 1000, description: 'Thanh toan PNS777' },
      'PNS777',
    );
  });

  assert.strictEqual(markedOrderId, 777);
  assert.ok(loggedTransaction);
});

test('transaction co ma PNS ngoai DB local phai la unmatched', async (t) => {
  const db = makeDecisionDb();
  let notifyCalls = 0;
  const orderService = {
    getByPaymentCode: () => null,
    getRecoverableExpiredByPaymentCode: () => null,
  };
  const adminNotifyService = {
    notify: () => { notifyCalls += 1; },
  };
  const messageTemplateService = { render: () => 'admin notice' };

  await withPaymentPollerFakes(t, { orderService, adminNotifyService, messageTemplateService }, async (PaymentPoller) => {
    const poller = new PaymentPoller(db, makeBot());
    await poller._handleOrphanedOrderTx(
      {
        transactionNumber: 'FT_EXTERNAL_PNS',
        amount: 149000,
        description: 'NGUYEN QUOC LONG PNS100033',
      },
      'PNS100033',
    );
  });

  const row = db.rows.get('FT_EXTERNAL_PNS');
  assert.strictEqual(row.match_status, 'unmatched');
  assert.strictEqual(row.matched_order_id, null);
  assert.strictEqual(row.matched_payment_code, null);
  assert.strictEqual(notifyCalls, 0);
});

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

    assert.strictEqual(processed.paymentCode, 'PNS100908');
    assert.strictEqual(processed.order.id, 100908);
    assert.strictEqual(processed.options.matchReason, 'amount_time_unique');
    const row = holder.rows.get('FT_MEMO_LESS');
    assert.strictEqual(row.match_status, 'unmatched');
    assert.strictEqual(row.matched_order_id, 100908);
  });
});

test('memo-less transaction must be claimed before order delivery starts', async (t) => {
  const selected = memoLessOrder();
  const orderService = {
    getPaymentMatchCandidates: () => [selected],
  };

  await withPaymentPollerFakes(t, { orderService }, async (PaymentPoller) => {
    const holder = makeDecisionDb([], { throwOnInsert: 'claim failed' });
    const poller = new PaymentPoller(holder, makeBot());
    let processed = 0;
    poller._processOrderMatch = async () => {
      processed += 1;
      return { success: true };
    };

    await assert.rejects(
      poller._processMemoLessTransaction(memoLessTx(), [selected]),
      /claim failed/,
    );
    assert.strictEqual(processed, 0);
  });
});

test('memo-less claimed transaction finalizes the claimed order instead of rematching another candidate', async (t) => {
  const claimed = memoLessOrder({ id: 100908, status: 'delivered' });
  const other = memoLessOrder({
    id: 100909,
    payment_code: 'PNS100909',
    total_price: 431900,
  });
  const orderService = {
    getById: id => (Number(id) === 100908 ? claimed : other),
    getPaymentMatchCandidates: () => [other],
    markPaymentMatched: () => {},
  };

  await withPaymentPollerFakes(t, { orderService }, async (PaymentPoller) => {
    const holder = makeDecisionDb([{
      id: 1,
      mb_transaction_number: 'FT_MEMO_LESS',
      match_status: 'unmatched',
      matched_order_id: 100908,
      matched_payment_code: 'PNS100908',
      match_reason: 'amount_time_unique',
    }]);
    const poller = new PaymentPoller(holder, makeBot());
    poller._processOrderMatch = async (_tx, _paymentCode, order) => {
      throw new Error(`must not process order ${order.id}`);
    };

    await poller._processMemoLessTransaction(memoLessTx(), [other]);

    const row = holder.rows.get('FT_MEMO_LESS');
    assert.strictEqual(row.match_status, 'matched');
    assert.strictEqual(row.matched_order_id, 100908);
    assert.strictEqual(row.matched_payment_code, 'PNS100908');
  });
});

test('memo-less retry after matched-record failure finalizes the original claimed order only', async (t) => {
  const selected = memoLessOrder({ product_id: 42, product_name: 'Fixture' });
  const other = memoLessOrder({
    id: 100909,
    payment_code: 'PNS100909',
    total_price: 431900,
  });
  let delivered = false;
  let deliveryCalls = 0;
  let deliveredNotifications = 0;
  let deliveredAccounts = null;
  const orderService = {
    getById: id => (Number(id) === 100908
      ? { ...selected, status: delivered ? 'delivered' : 'pending' }
      : other),
    getPaymentMatchCandidates: () => (delivered ? [other] : [selected]),
    getDeliveredKeys: () => ['key-1'],
    confirmAndDeliver: () => {
      deliveryCalls += 1;
      delivered = true;
      return {
        success: true,
        order: { ...selected, variant_id: null },
        accounts: ['key-1'],
      };
    },
    markPaymentMatched: () => {},
  };
  const messageTemplateService = {
    render: () => 'fixture message',
    renderIfEnabled: () => null,
  };
  const orderChannelService = { postOrderCard: async () => {} };
  const variantService = { getById: () => null };
  const productService = { getById: () => ({ id: 42, name: 'Fixture' }) };

  await withPaymentPollerFakes(
    t,
    {
      orderService,
      messageTemplateService,
      orderChannelService,
      variantService,
      productService,
    },
    async (PaymentPoller) => {
      const dbOptions = { throwOnMatchedUpdate: 'record failed' };
      const holder = makeDecisionDb([], dbOptions);
      const poller = new PaymentPoller(holder, makeBot());
      poller._notifyCustomerDelivered = async () => {};

      await assert.rejects(
        poller._processMemoLessTransaction(memoLessTx(), [selected]),
        /record failed/,
      );
      assert.strictEqual(holder.rows.get('FT_MEMO_LESS').match_status, 'unmatched');
      assert.strictEqual(holder.rows.get('FT_MEMO_LESS').matched_order_id, 100908);

      delete dbOptions.throwOnMatchedUpdate;
      const retryPoller = new PaymentPoller(holder, makeBot());
      retryPoller._notifyCustomerDelivered = async (_order, accounts) => {
        deliveredNotifications += 1;
        deliveredAccounts = accounts;
      };
      await retryPoller._processMemoLessTransaction(memoLessTx(), [other]);
    },
  );

  assert.strictEqual(deliveryCalls, 1);
  assert.strictEqual(deliveredNotifications, 1);
  assert.deepStrictEqual(deliveredAccounts, ['key-1']);
});

test('late-recovered memo-less backorder uses backorder flow instead of no-stock', async (t) => {
  const selected = memoLessOrder({
    status: 'expired',
    variant_id: 77,
    product_id: 42,
    product_name: 'Backorder Fixture',
  });
  let confirmOptions;
  let noStockNotifications = 0;
  let customerMessages = [];
  const orderService = {
    markRecoveredPaid: () => true,
    confirmAndDeliver: (_orderId, _autoConfirmed, options) => {
      confirmOptions = options;
      return {
        success: true,
        backorder: true,
        order: {
          ...selected,
          status: 'paid',
        },
      };
    },
    markPaymentMatched: () => {},
  };
  const adminNotifyService = {
    notify: async (event) => {
      if (event === 'no_stock') noStockNotifications += 1;
      return true;
    },
  };
  const messageTemplateService = {
    render: (name) => name,
    renderIfEnabled: () => null,
  };
  const orderChannelService = { postOrderCard: async () => {} };
  const variantService = { getById: () => ({ id: 77, is_backorder: 1 }) };
  const productService = { getById: () => ({ id: 42, name: 'Backorder Fixture' }) };

  await withPaymentPollerFakes(
    t,
    {
      orderService,
      adminNotifyService,
      messageTemplateService,
      orderChannelService,
      variantService,
      productService,
      database: makeDecisionDb(),
    },
    async (PaymentPoller) => {
      const poller = new PaymentPoller(makeDecisionDb(), makeBot());
      poller._notifyCustomer = async (_userId, message) => {
        customerMessages.push(message);
      };

      await poller._processOrderMatch(
        memoLessTx(),
        'PNS100908',
        selected,
        { matchReason: 'amount_time_unique' },
      );
    },
  );

  assert.deepStrictEqual(confirmOptions, { allowPaidBackorder: true });
  assert.strictEqual(noStockNotifications, 0);
  assert.deepStrictEqual(customerMessages, ['bot.backorder_wait']);
});

test('memo-less unique candidate is revalidated against the full fresh snapshot', async (t) => {
  const first = memoLessOrder();
  const second = memoLessOrder({
    id: 100909,
    total_price: 438000,
    payment_code: 'PNS100909',
  });
  const orderService = {
    getById: () => first,
    getPaymentMatchCandidates: () => [first, second],
  };
  const adminNotifyService = {
    calls: 0,
    notify: async () => {
      adminNotifyService.calls += 1;
      return true;
    },
  };

  await withPaymentPollerFakes(
    t,
    { orderService, adminNotifyService },
    async (PaymentPoller) => {
      const holder = makeDecisionDb();
      const poller = new PaymentPoller(holder, makeBot());
      poller._processOrderMatch = async () => {
        throw new Error('ambiguous fresh snapshot must not process an order');
      };

      await poller._processMemoLessTransaction(memoLessTx(), [first]);

      const row = holder.rows.get('FT_MEMO_LESS');
      assert.strictEqual(row.match_status, 'review');
      assert.strictEqual(row.match_reason, 'ambiguous');
      assert.strictEqual(row.candidate_order_ids_json, '[100908,100909]');
      assert.strictEqual(adminNotifyService.calls, 1);
    },
  );
});

test('memo-less ambiguous transaction is stored as terminal review once', async (t) => {
  const candidates = [
    memoLessOrder({ id: 100908 }),
    memoLessOrder({
      id: 100909,
      total_price: 438000,
      payment_code: 'PNS100909',
    }),
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
      assert.strictEqual(row.matched_order_id, null);
      assert.strictEqual(row.matched_payment_code, null);
      assert.strictEqual(row.match_status, 'review');
      assert.strictEqual(row.match_reason, 'ambiguous');
      assert.strictEqual(row.bank_transaction_at, '2026-06-21 21:30:12');
      assert.strictEqual(
        row.candidate_order_ids_json,
        JSON.stringify([100908, 100909]),
      );
      assert.strictEqual(adminNotifyService.calls, 1);
    },
  );
});

test('memo-less review shows candidate creation time in vietnam timezone', async (t) => {
  let notificationBody = '';
  let notificationEvent = '';
  const adminNotifyService = {
    notify: async (event, body) => {
      notificationEvent = event;
      notificationBody = body;
      return true;
    },
  };
  const expectedTime = new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(Date.UTC(2026, 5, 21, 21, 27, 35)));
  const candidates = [
    memoLessOrder({ id: 100908 }),
    memoLessOrder({
      id: 100909,
      total_price: 438000,
      payment_code: 'PNS100909',
      created_at: 'khong-hop-le',
    }),
  ];

  await withPaymentPollerFakes(
    t,
    { adminNotifyService },
    async (PaymentPoller) => {
      const poller = new PaymentPoller(makeDecisionDb(), makeBot());
      await poller._notifyMemoLessReview(memoLessTx(), {
        kind: 'review',
        reason: 'ambiguous',
        candidates,
        candidateOrderIds: candidates.map(order => order.id),
      });
    },
  );

  assert.match(
    notificationBody,
    new RegExp(`#100908: 431\\.460đ \\(\\+540đ\\) — pending — Tạo: ${expectedTime}`),
  );
  assert.match(
    notificationBody,
    /#100909: 438\.000đ \(-6\.000đ\) — pending — Tạo: Không có/,
  );
  assert.strictEqual(notificationEvent, 'payment_review');
});

test('memo-less review logs transaction number when admin notification returns false', async (t) => {
  const transaction = memoLessTx({ transactionNumber: 'FT_NOTIFY_FALSE' });
  let notificationEvent = '';
  const adminNotifyService = {
    notify: async (event) => {
      notificationEvent = event;
      return false;
    },
  };
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => {
    errors.push(args.map(String).join(' '));
  };
  t.after(() => { console.error = originalConsoleError; });

  await withPaymentPollerFakes(
    t,
    { adminNotifyService },
    async (PaymentPoller) => {
      const poller = new PaymentPoller(makeDecisionDb(), makeBot());
      await poller._notifyMemoLessReview(transaction, {
        kind: 'review',
        reason: 'ambiguous',
        candidates: [memoLessOrder()],
        candidateOrderIds: [100908],
      });
    },
  );

  assert.ok(errors.some(message => message.includes('FT_NOTIFY_FALSE')));
  assert.strictEqual(notificationEvent, 'payment_review');
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
    assert.strictEqual(
      holder.rows.get('FT_MEMO_LESS').match_status,
      'unmatched',
    );

    await poller._processMemoLessTransaction(memoLessTx(), [selected]);
    assert.strictEqual(processCalls, 1);
  });
});

test('missing transaction time becomes terminal review', async (t) => {
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
      const transaction = memoLessTx({ transactionTime: null });

      await poller._processMemoLessTransaction(
        transaction,
        [memoLessOrder()],
      );
      await poller._processMemoLessTransaction(
        transaction,
        [memoLessOrder()],
      );

      const row = holder.rows.get('FT_MEMO_LESS');
      assert.strictEqual(row.match_status, 'review');
      assert.strictEqual(row.match_reason, 'missing_transaction_time');
      assert.strictEqual(row.bank_transaction_at, null);
      assert.strictEqual(row.candidate_order_ids_json, '[]');
      assert.strictEqual(adminNotifyService.calls, 1);
    },
  );
});

test('full memo-less order match persists matched audit metadata', async (t) => {
  const holder = makeDecisionDb();
  const selected = memoLessOrder({
    product_id: 42,
    product_name: 'Fixture',
    quantity: 1,
  });
  let markedOrderId = null;
  const orderService = {
    markPaymentMatched: (orderId) => { markedOrderId = orderId; },
    confirmAndDeliver: () => ({
      success: true,
      backorder: true,
      order: {
        ...selected,
        variant_id: null,
      },
    }),
  };
  const messageTemplateService = {
    render: () => 'fixture message',
    renderIfEnabled: () => null,
  };
  const orderChannelService = { postOrderCard: async () => {} };
  const variantService = { getById: () => null };
  const productService = { getById: () => ({ id: 42, name: 'Fixture' }) };

  await withPaymentPollerFakes(
    t,
    {
      orderService,
      messageTemplateService,
      orderChannelService,
      variantService,
      productService,
      database: holder,
    },
    async (PaymentPoller) => {
      const poller = new PaymentPoller(holder, makeBot());
      poller._notifyCustomer = async () => {};

      await poller._processOrderMatch(
        memoLessTx(),
        'PNS100908',
        selected,
        { matchReason: 'amount_time_unique' },
      );

      const row = holder.rows.get('FT_MEMO_LESS');
      assert.strictEqual(row.match_status, 'matched');
      assert.strictEqual(row.matched_order_id, 100908);
      assert.strictEqual(row.matched_payment_code, 'PNS100908');
      assert.strictEqual(row.match_reason, 'amount_time_unique');
      assert.strictEqual(row.bank_transaction_at, '2026-06-21 21:30:12');
      assert.strictEqual(row.candidate_order_ids_json, '[100908]');
      assert.strictEqual(markedOrderId, 100908);
    },
  );
});

test('full payment stays retryable when confirmAndDeliver throws', async (t) => {
  const holder = makeDecisionDb([{
    id: 1,
    mb_transaction_number: 'FT_MEMO_LESS',
    match_status: 'unmatched',
  }]);
  let markPaymentCalls = 0;
  const orderService = {
    confirmAndDeliver: () => {
      throw new Error('delivery transaction failed');
    },
    markPaymentMatched: () => {
      markPaymentCalls += 1;
    },
  };

  await withPaymentPollerFakes(
    t,
    { orderService },
    async (PaymentPoller) => {
      const poller = new PaymentPoller(holder, makeBot());

      await assert.rejects(
        poller._processOrderMatch(
          memoLessTx(),
          'PNS100908',
          memoLessOrder(),
          { matchReason: 'amount_time_unique' },
        ),
        /delivery transaction failed/,
      );
    },
  );

  assert.strictEqual(holder.rows.get('FT_MEMO_LESS').match_status, 'unmatched');
  assert.strictEqual(markPaymentCalls, 0);
});

test('failed order claim does not persist match or send no-stock success notifications', async (t) => {
  const holder = makeDecisionDb();
  let markPaymentCalls = 0;
  let adminCalls = 0;
  let customerCalls = 0;
  const orderService = {
    confirmAndDeliver: () => ({ success: false, error: 'no stock' }),
    markPaid: () => ({ success: false, error: 'order changed' }),
    markPaymentMatched: () => {
      markPaymentCalls += 1;
    },
  };
  const adminNotifyService = {
    notify: async () => {
      adminCalls += 1;
      return true;
    },
  };

  await withPaymentPollerFakes(
    t,
    { orderService, adminNotifyService },
    async (PaymentPoller) => {
      const poller = new PaymentPoller(holder, makeBot());
      poller._notifyCustomer = async () => {
        customerCalls += 1;
      };

      const result = await poller._processOrderMatch(
        memoLessTx(),
        'PNS100908',
        memoLessOrder(),
        { matchReason: 'amount_time_unique' },
      );

      assert.strictEqual(result, null);
    },
  );

  assert.strictEqual(holder.rows.has('FT_MEMO_LESS'), false);
  assert.strictEqual(markPaymentCalls, 0);
  assert.strictEqual(adminCalls, 0);
  assert.strictEqual(customerCalls, 0);
});

test('manual-review order is marked paid without auto delivery', async (t) => {
  const holder = makeDecisionDb();
  const order = memoLessOrder({
    product_id: 42,
    product_name: 'Manual Review Product',
    quantity: 1,
    requires_manual_review: 1,
    manual_review_reason: 'shadow_banned',
  });
  let confirmCalls = 0;
  let markPaidCalls = 0;
  let markPaymentCalls = 0;
  const channelCalls = [];
  const customerMessages = [];

  const orderService = {
    confirmAndDeliver: () => {
      confirmCalls += 1;
      throw new Error('confirmAndDeliver should not be called');
    },
    markPaid: (orderId) => {
      markPaidCalls += 1;
      return { success: true, order: { ...order, id: orderId, status: 'paid' } };
    },
    markPaymentMatched: () => {
      markPaymentCalls += 1;
    },
  };
  const messageTemplateService = {
    render: key => key,
    renderIfEnabled: () => null,
  };
  const orderChannelService = {
    postOrderCard: async (payload) => {
      channelCalls.push(payload);
    },
  };
  const productService = { getById: () => ({ id: 42, name: 'Manual Review Product' }) };
  const variantService = { getById: () => null };

  await withPaymentPollerFakes(
    t,
    {
      orderService,
      messageTemplateService,
      orderChannelService,
      productService,
      variantService,
      database: holder,
    },
    async (PaymentPoller) => {
      const poller = new PaymentPoller(holder, makeBot());
      poller._notifyCustomer = async (_userId, message) => {
        customerMessages.push(message);
      };

      const result = await poller._processOrderMatch(
        memoLessTx(),
        'PNS100908',
        order,
        { matchReason: 'amount_time_unique' },
      );

      assert.strictEqual(result.success, true);
    },
  );

  const tx = holder.rows.get('FT_MEMO_LESS');
  assert.strictEqual(tx.match_status, 'matched');
  assert.strictEqual(tx.matched_order_id, order.id);
  assert.strictEqual(confirmCalls, 0);
  assert.strictEqual(markPaidCalls, 1);
  assert.strictEqual(markPaymentCalls, 1);
  assert.deepStrictEqual(customerMessages, ['bot.backorder_wait']);
  assert.strictEqual(channelCalls.length, 1);
  assert.strictEqual(channelCalls[0].keys, null);
});

test('two pollers cannot both claim and persist the same order payment', async (t) => {
  const holder = makeDecisionDb();
  let orderStatus = 'pending';
  let deliverySuccessCount = 0;
  let markPaymentCalls = 0;
  const selected = memoLessOrder({
    product_id: 42,
    product_name: 'Fixture',
    quantity: 1,
  });
  const orderService = {
    confirmAndDeliver: () => {
      if (orderStatus !== 'pending') {
        return { success: false, error: 'already processed' };
      }
      orderStatus = 'delivered';
      deliverySuccessCount += 1;
      return {
        success: true,
        backorder: true,
        order: { ...selected, variant_id: null },
      };
    },
    markPaid: () => ({ success: false, error: 'already processed' }),
    markPaymentMatched: () => {
      markPaymentCalls += 1;
    },
  };
  const messageTemplateService = {
    render: () => 'fixture message',
    renderIfEnabled: () => null,
  };
  const orderChannelService = { postOrderCard: async () => {} };
  const variantService = { getById: () => null };
  const productService = { getById: () => ({ id: 42, name: 'Fixture' }) };

  await withPaymentPollerFakes(
    t,
    {
      orderService,
      messageTemplateService,
      orderChannelService,
      variantService,
      productService,
      database: holder,
    },
    async (PaymentPoller) => {
      const firstPoller = new PaymentPoller(holder, makeBot());
      const secondPoller = new PaymentPoller(holder, makeBot());
      firstPoller._notifyCustomer = async () => {};
      secondPoller._notifyCustomer = async () => {};

      await Promise.all([
        firstPoller._processOrderMatch(
          memoLessTx(),
          'PNS100908',
          { ...selected },
          { matchReason: 'amount_time_unique' },
        ),
        secondPoller._processOrderMatch(
          memoLessTx(),
          'PNS100908',
          { ...selected },
          { matchReason: 'amount_time_unique' },
        ),
      ]);
    },
  );

  const row = holder.rows.get('FT_MEMO_LESS');
  assert.strictEqual(deliverySuccessCount, 1);
  assert.strictEqual(markPaymentCalls, 1);
  assert.strictEqual(row.match_status, 'matched');
  assert.strictEqual(row.matched_order_id, 100908);
  assert.strictEqual(row.match_reason, 'amount_time_unique');
});

test('transaction with PNS uses code branch before memo-less matcher', async (t) => {
  const codedOrder = memoLessOrder({
    id: 100777,
    payment_code: 'PNS100777',
  });
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
      assert.strictEqual(processedId, 100777);
    },
  );
});

test('transaction with topup memo uses topup branch before memo-less matcher', async (t) => {
  const pendingTopup = {
    id: 77,
    memo: 'PNSU12345',
    amount: 432000,
    requested_at: '2026-06-21 21:27:35',
  };
  const orderService = {
    expireStaleOrders: () => [],
    getActivePending: () => [],
    getRecentlyExpired: () => [],
    getPaymentMatchCandidates: () => [memoLessOrder()],
  };
  const topupService = {
    getActivePending: () => [pendingTopup],
    expireStale: () => [],
  };

  await withPaymentPollerFakes(
    t,
    { orderService, topupService },
    async (PaymentPoller) => {
      const poller = new PaymentPoller(makeDecisionDb(), makeBot());
      poller.running = true;
      poller._fetchTransactions = async () => [{
        ...memoLessTx(),
        description: 'Nap vi PNSU12345',
      }];
      let processedTopupId = null;
      poller._processTopupMatch = async (_tx, memo, topup) => {
        assert.strictEqual(memo, 'PNSU12345');
        processedTopupId = topup.id;
      };
      poller._processMemoLessTransaction = async () => {
        throw new Error('memo-less branch must not run');
      };

      await poller._poll();
      assert.strictEqual(processedTopupId, 77);
    },
  );
});

test('concurrent poll calls share one in-flight execution', async (t) => {
  const orderService = {
    expireStaleOrders: () => [],
    getActivePending: () => [],
    getRecentlyExpired: () => [],
    getPaymentMatchCandidates: () => [],
  };
  const topupService = {
    getActivePending: () => [],
    expireStale: () => [],
  };

  await withPaymentPollerFakes(
    t,
    { orderService, topupService },
    async (PaymentPoller) => {
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
      assert.strictEqual(calls, 1);
      release();
      await Promise.all([first, second]);
      assert.strictEqual(poller.pollInFlight, null);
    },
  );
});

test('payment_review is a mandatory admin notification event', async (t) => {
  const servicePath = require.resolve('../../src/services/adminNotifyService');
  const databasePath = require.resolve('../../src/database');
  const configPath = require.resolve('../../src/config');
  const telegramApiClient = require('../../src/services/telegramApiClient');
  const previous = new Map([
    [servicePath, require.cache[servicePath]],
    [databasePath, require.cache[databasePath]],
    [configPath, require.cache[configPath]],
  ]);
  const sent = [];

  delete require.cache[servicePath];
  require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: {
      prepare: () => ({
        all: () => [{ key: 'notify_admin_payment_review', value: 'false' }],
        get: () => undefined,
      }),
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      ADMIN_ID: 'admin-chat',
      BOT_NOISE_CHAT_ID: null,
    },
  };
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest(null);
    delete require.cache[servicePath];
    for (const [path, cached] of previous.entries()) {
      if (cached) require.cache[path] = cached;
      else delete require.cache[path];
    }
  });
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    sent.push([method, payload]);
    return { message_id: 1 };
  });

  const service = require('../../src/services/adminNotifyService');
  service.init({
    telegram: {
      sendMessage: async () => {
        throw new Error('legacy transport should not be called');
      },
    },
  });

  assert.ok(service.VALID_EVENTS.includes('payment_review'));
  assert.strictEqual(await service.notify('payment_review', 'body'), true);
  assert.strictEqual(sent.length, 1);
});
