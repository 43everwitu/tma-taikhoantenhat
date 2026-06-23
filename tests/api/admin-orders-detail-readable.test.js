const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

async function requestJson(app, method, path) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    req.headers = {};
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
  app.use((req, _res, next) => {
    req.admin = { adminId: 1, role: 'super_admin', username: 'admin' };
    next();
  });
  app.use('/admin/orders', require('../../src/api/routes/admin/orders'));
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  });
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

function createFixture() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 897_000_000 + Math.floor(Math.random() * 100000);
  const account = `readable-key-${suffix}`;
  const longMessage = `Thông báo gia hạn ${suffix} `.padEnd(220, 'x');

  return db.transaction(() => {
    db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)')
      .run(userId, `readable_${suffix}`, `Khách đọc được ${suffix}`);
    const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)')
      .run(`readable-category-${suffix}`, `readable-category-${suffix}`);
    const product = db.prepare(`
      INSERT INTO products (category_id, name, slug, price, is_active)
      VALUES (?, ?, ?, 120000, 1)
    `).run(
      category.lastInsertRowid,
      `Gói đọc được ${suffix}`,
      `readable-product-${suffix}`,
    );
    const variant = db.prepare(`
      INSERT INTO product_variants (product_id, name, price, default_duration_days)
      VALUES (?, ?, 120000, 30)
    `).run(product.lastInsertRowid, 'Gói 30 ngày');
    const otherVariant = db.prepare(`
      INSERT INTO product_variants (product_id, name, price, default_duration_days)
      VALUES (?, ?, 120000, 365)
    `).run(product.lastInsertRowid, 'Gói khác');
    const order = db.prepare(`
      INSERT INTO orders (
        user_id, product_id, variant_id, quantity, total_price, payment_code,
        status, source, paid_at, delivered_at, delivered_keys_json
      ) VALUES (?, ?, ?, 1, 120000, ?, 'delivered', 'web',
        datetime('now', '-40 days'), datetime('now', '-40 days'), ?)
    `).run(
      userId,
      product.lastInsertRowid,
      variant.lastInsertRowid,
      `PNS_READABLE_${suffix}`,
      JSON.stringify([account]),
    );
    const stock = db.prepare(`
      INSERT INTO stock (
        product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at
      ) VALUES (?, ?, ?, 30, 1, ?, datetime('now', '-40 days'))
    `).run(product.lastInsertRowid, variant.lastInsertRowid, account, userId);
    const otherStock = db.prepare(`
      INSERT INTO stock (
        product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at
      ) VALUES (?, ?, ?, 365, 1, ?, datetime('now', '-40 days'))
    `).run(
      product.lastInsertRowid,
      otherVariant.lastInsertRowid,
      `wrong-variant-key-${suffix}`,
      userId,
    );
    const oldTransaction = db.prepare(`
      INSERT INTO transactions (
        mb_transaction_number, amount, description, matched_order_id,
        matched_payment_code, match_status, detected_at, bank_transaction_at
      ) VALUES (?, 110000, ?, ?, ?, 'matched', datetime('now', '-2 days'), NULL)
    `).run(
      `READABLE_OLD_${suffix}`,
      `Giao dịch cũ ${suffix}`,
      order.lastInsertRowid,
      `PNS_READABLE_${suffix}`,
    );
    const transaction = db.prepare(`
      INSERT INTO transactions (
        mb_transaction_number, amount, description, matched_order_id,
        matched_payment_code, match_status, detected_at, bank_transaction_at
      ) VALUES (?, 120000, ?, ?, ?, 'matched', datetime('now', '-1 day'), '2026-06-20 08:30:00')
    `).run(
      `READABLE_NEW_${suffix}`,
      `Thanh toán ${suffix}`,
      order.lastInsertRowid,
      `PNS_READABLE_${suffix}`,
    );
    const orderLog = db.prepare(`
      INSERT INTO renewal_reminder_logs (
        stock_id, order_id, user_id, product_id, product_name, expiry_date,
        days_before_expiry, status, message_body, created_at
      ) VALUES (NULL, ?, ?, ?, ?, DATE('now', '-10 days'), 3, 'sent', ?, datetime('now', '-2 hours'))
    `).run(
      order.lastInsertRowid,
      userId,
      product.lastInsertRowid,
      `Gói đọc được ${suffix}`,
      longMessage,
    );
    const stockLog = db.prepare(`
      INSERT INTO renewal_reminder_logs (
        stock_id, order_id, user_id, product_id, product_name, expiry_date,
        days_before_expiry, status, message_body, created_at
      ) VALUES (?, NULL, ?, ?, ?, DATE('now', '-9 days'), 1, 'failed', 'stock log', datetime('now', '-1 hour'))
    `).run(
      stock.lastInsertRowid,
      userId,
      product.lastInsertRowid,
      `Gói đọc được ${suffix}`,
    );

    return {
      suffix,
      userId,
      account,
      longMessage,
      categoryId: category.lastInsertRowid,
      productId: product.lastInsertRowid,
      variantId: variant.lastInsertRowid,
      variantName: 'Gói 30 ngày',
      otherVariantId: otherVariant.lastInsertRowid,
      orderId: order.lastInsertRowid,
      stockId: stock.lastInsertRowid,
      otherStockId: otherStock.lastInsertRowid,
      oldTransactionId: oldTransaction.lastInsertRowid,
      transactionId: transaction.lastInsertRowid,
      orderLogId: orderLog.lastInsertRowid,
      stockLogId: stockLog.lastInsertRowid,
    };
  })();
}

function cleanupFixture(fixture) {
  db.transaction(() => {
    db.prepare('DELETE FROM renewal_reminder_logs WHERE id IN (?, ?)')
      .run(fixture.orderLogId, fixture.stockLogId);
    db.prepare('DELETE FROM transactions WHERE id IN (?, ?)')
      .run(fixture.oldTransactionId, fixture.transactionId);
    db.prepare('DELETE FROM stock WHERE id IN (?, ?)')
      .run(fixture.stockId, fixture.otherStockId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
    db.prepare('DELETE FROM product_variants WHERE id IN (?, ?)')
      .run(fixture.variantId, fixture.otherVariantId);
    db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
  })();
}

test('GET /admin/orders/:id trả DTO chi tiết dễ đọc cho đơn đã giao', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));

  const res = await requestJson(makeApp(), 'GET', `/admin/orders/${fixture.orderId}`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.success, true);
  assert.deepStrictEqual(res.json.data.customer, {
    telegramId: String(fixture.userId),
    fullName: `Khách đọc được ${fixture.suffix}`,
    username: `readable_${fixture.suffix}`,
  });
  assert.deepStrictEqual(res.json.data.product, {
    id: String(fixture.productId),
    name: `Gói đọc được ${fixture.suffix}`,
    variantId: String(fixture.variantId),
    variantName: fixture.variantName,
    variantLabel: fixture.variantName,
  });
  assert.deepStrictEqual(res.json.data.accounts, [fixture.account]);
  assert.strictEqual(res.json.data.stockItems.length, 1);
  assert.deepStrictEqual(res.json.data.stockItems[0], {
    id: String(fixture.stockId),
    value: fixture.account,
    variantId: String(fixture.variantId),
    variantName: fixture.variantName,
    soldAt: res.json.data.stockItems[0].soldAt,
    durationDays: 30,
    expiresAt: db.prepare("SELECT DATE('now', '-10 days') AS d").get().d,
    expired: true,
  });
  assert.ok(res.json.data.stockItems[0].soldAt);
  assert.deepStrictEqual(res.json.data.matchedTransaction, {
    id: String(fixture.transactionId),
    amount: 120000,
    description: `Thanh toán ${fixture.suffix}`,
    transactionDate: '2026-06-20 08:30:00',
    bankReference: `READABLE_NEW_${fixture.suffix}`,
  });
  assert.deepStrictEqual(
    res.json.data.renewalLogs.map((log) => log.id),
    [String(fixture.stockLogId), String(fixture.orderLogId)],
  );
  assert.deepStrictEqual(res.json.data.renewalLogs[0], {
    id: String(fixture.stockLogId),
    stockId: String(fixture.stockId),
    status: 'failed',
    expiryDate: db.prepare("SELECT DATE('now', '-9 days') AS d").get().d,
    daysBeforeExpiry: 1,
    messagePreview: 'stock log',
    createdAt: res.json.data.renewalLogs[0].createdAt,
  });
  assert.strictEqual(res.json.data.renewalLogs[1].messagePreview, fixture.longMessage.slice(0, 180));
  assert.strictEqual(res.json.data.renewalLogs[1].messagePreview.length, 180);
});

test('GET /admin/orders/:id ưu tiên stock khớp delivered snapshot dù trạng thái và variant đã đổi', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  db.prepare(`
    UPDATE stock
    SET variant_id = ?, is_sold = 0
    WHERE id = ?
  `).run(fixture.otherVariantId, fixture.stockId);

  const res = await requestJson(makeApp(), 'GET', `/admin/orders/${fixture.orderId}`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.deepStrictEqual(res.json.data.accounts, [fixture.account]);
  assert.strictEqual(res.json.data.stockItems.length, 1);
  assert.strictEqual(res.json.data.stockItems[0].id, String(fixture.stockId));
  assert.strictEqual(res.json.data.stockItems[0].value, fixture.account);
  assert.strictEqual(res.json.data.stockItems[0].variantId, String(fixture.otherVariantId));
  assert.strictEqual(res.json.data.stockItems[0].variantName, 'Gói khác');
});

test('GET /admin/orders/:id giới hạn stock snapshot theo quantity và không kéo log của row trùng data', async (t) => {
  const fixture = createFixture();
  let duplicateStockId = null;
  let duplicateLogId = null;
  t.after(() => {
    if (duplicateLogId) db.prepare('DELETE FROM renewal_reminder_logs WHERE id = ?').run(duplicateLogId);
    if (duplicateStockId) db.prepare('DELETE FROM stock WHERE id = ?').run(duplicateStockId);
    cleanupFixture(fixture);
  });
  const duplicateStock = db.prepare(`
    INSERT INTO stock (
      product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at
    ) VALUES (?, ?, ?, 30, 1, ?, datetime('now'))
  `).run(fixture.productId, fixture.variantId, fixture.account, fixture.userId);
  duplicateStockId = duplicateStock.lastInsertRowid;
  const duplicateLog = db.prepare(`
    INSERT INTO renewal_reminder_logs (
      stock_id, order_id, user_id, product_id, product_name, expiry_date,
      days_before_expiry, status, message_body
    ) VALUES (?, NULL, ?, ?, ?, DATE('now', '+30 days'), 3, 'sent', 'duplicate log')
  `).run(
    duplicateStock.lastInsertRowid,
    fixture.userId,
    fixture.productId,
    `Gói đọc được ${fixture.suffix}`,
  );
  duplicateLogId = duplicateLog.lastInsertRowid;

  const res = await requestJson(makeApp(), 'GET', `/admin/orders/${fixture.orderId}`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.data.stockItems.length, 1);
  assert.strictEqual(res.json.data.stockItems[0].id, String(fixture.stockId));
  assert.ok(
    !res.json.data.renewalLogs.some(log => log.id === String(duplicateLog.lastInsertRowid)),
  );
});

test('GET /admin/orders/:id fallback legacy không lấy stock bán sau delivered_at', async (t) => {
  const fixture = createFixture();
  let newerStockId = null;
  let newerLogId = null;
  t.after(() => {
    if (newerLogId) db.prepare('DELETE FROM renewal_reminder_logs WHERE id = ?').run(newerLogId);
    if (newerStockId) db.prepare('DELETE FROM stock WHERE id = ?').run(newerStockId);
    cleanupFixture(fixture);
  });
  db.prepare('UPDATE orders SET delivered_keys_json = NULL WHERE id = ?').run(fixture.orderId);
  const newerStock = db.prepare(`
    INSERT INTO stock (
      product_id, variant_id, data, duration_days, is_sold, sold_to, sold_at
    ) VALUES (?, ?, ?, 30, 1, ?, datetime('now'))
  `).run(
    fixture.productId,
    fixture.variantId,
    `newer-key-${fixture.suffix}`,
    fixture.userId,
  );
  newerStockId = newerStock.lastInsertRowid;
  const newerLog = db.prepare(`
    INSERT INTO renewal_reminder_logs (
      stock_id, order_id, user_id, product_id, product_name, expiry_date,
      days_before_expiry, status, message_body
    ) VALUES (?, NULL, ?, ?, ?, DATE('now', '+30 days'), 3, 'sent', 'newer stock log')
  `).run(
    newerStock.lastInsertRowid,
    fixture.userId,
    fixture.productId,
    `Gói đọc được ${fixture.suffix}`,
  );
  newerLogId = newerLog.lastInsertRowid;

  const res = await requestJson(makeApp(), 'GET', `/admin/orders/${fixture.orderId}`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.deepStrictEqual(res.json.data.accounts, [fixture.account]);
  assert.strictEqual(res.json.data.stockItems.length, 1);
  assert.strictEqual(res.json.data.stockItems[0].id, String(fixture.stockId));
  assert.strictEqual(res.json.data.stockItems[0].value, fixture.account);
  assert.ok(
    !res.json.data.renewalLogs.some(log => log.id === String(newerLog.lastInsertRowid)),
  );
});

test('GET /admin/orders/:id bỏ qua transaction unmatched đã claim order', async (t) => {
  const fixture = createFixture();
  let unmatchedId = null;
  t.after(() => {
    if (unmatchedId) db.prepare('DELETE FROM transactions WHERE id = ?').run(unmatchedId);
    cleanupFixture(fixture);
  });
  const unmatched = db.prepare(`
    INSERT INTO transactions (
      mb_transaction_number, amount, description, matched_order_id,
      matched_payment_code, match_status, detected_at
    ) VALUES (?, 120000, ?, ?, ?, 'unmatched', datetime('now'))
  `).run(
    `READABLE_CLAIM_${fixture.suffix}`,
    `Claim chưa match ${fixture.suffix}`,
    fixture.orderId,
    `PNS_READABLE_${fixture.suffix}`,
  );
  unmatchedId = unmatched.lastInsertRowid;

  const res = await requestJson(makeApp(), 'GET', `/admin/orders/${fixture.orderId}`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.strictEqual(res.json.data.matchedTransaction.id, String(fixture.transactionId));
  assert.strictEqual(
    res.json.data.matchedTransaction.bankReference,
    `READABLE_NEW_${fixture.suffix}`,
  );
});

test('GET /admin/orders/:id giữ null cho customer và transaction metadata bị thiếu', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  db.prepare('UPDATE users SET full_name = NULL, username = NULL WHERE telegram_id = ?')
    .run(fixture.userId);
  db.prepare(`
    UPDATE transactions
    SET mb_transaction_number = NULL, bank_transaction_at = NULL, detected_at = NULL
    WHERE id = ?
  `).run(fixture.transactionId);
  db.prepare('DELETE FROM transactions WHERE id = ?').run(fixture.oldTransactionId);

  const res = await requestJson(makeApp(), 'GET', `/admin/orders/${fixture.orderId}`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.deepStrictEqual(res.json.data.customer, {
    telegramId: String(fixture.userId),
    fullName: null,
    username: null,
  });
  assert.strictEqual(res.json.data.matchedTransaction.id, String(fixture.transactionId));
  assert.strictEqual(res.json.data.matchedTransaction.transactionDate, null);
  assert.strictEqual(res.json.data.matchedTransaction.bankReference, null);
});

test('GET /admin/orders/:id dùng nhãn legacy khi đơn và stock không còn variant', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  db.prepare('UPDATE orders SET variant_id = NULL, delivered_keys_json = NULL WHERE id = ?')
    .run(fixture.orderId);
  db.prepare("UPDATE stock SET variant_id = NULL, sold_at = datetime('now', '-41 days') WHERE id = ?")
    .run(fixture.stockId);
  db.prepare('DELETE FROM product_variants WHERE id = ?').run(fixture.variantId);

  const res = await requestJson(makeApp(), 'GET', `/admin/orders/${fixture.orderId}`);

  assert.strictEqual(res.status, 200, `unexpected body: ${JSON.stringify(res.json)}`);
  assert.deepStrictEqual(res.json.data.product, {
    id: String(fixture.productId),
    name: `Gói đọc được ${fixture.suffix}`,
    variantId: null,
    variantName: null,
    variantLabel: 'mặc định/legacy',
  });
  assert.deepStrictEqual(res.json.data.accounts, [fixture.account]);
  assert.strictEqual(res.json.data.stockItems.length, 1);
  assert.strictEqual(res.json.data.stockItems[0].value, fixture.account);
  assert.strictEqual(res.json.data.stockItems[0].variantId, null);
  assert.strictEqual(res.json.data.stockItems[0].variantName, null);
});
