const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const db = require('../../src/database');

async function requestJson(app, method, path) {
  return await new Promise((resolve, reject) => {
    const request = new Readable({
      read() {
        this.push(null);
      },
    });
    request.method = method;
    request.url = path;
    request.headers = {};
    request.socket = new PassThrough();
    request.socket.remoteAddress = '127.0.0.1';

    const chunks = [];
    const response = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    response.statusCode = 200;
    response.headers = {};
    response.setHeader = (key, value) => {
      response.headers[key.toLowerCase()] = value;
    };
    response.getHeader = key => response.headers[key.toLowerCase()];
    response.removeHeader = (key) => {
      delete response.headers[key.toLowerCase()];
    };
    response.writeHead = (status, headers) => {
      response.statusCode = status;
      if (headers) {
        for (const [key, value] of Object.entries(headers)) response.setHeader(key, value);
      }
      return response;
    };
    const end = response.end.bind(response);
    response.end = (chunk, encoding, callback) => {
      if (chunk) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding : undefined));
      }
      end(callback);
      try {
        resolve({
          status: response.statusCode,
          json: JSON.parse(Buffer.concat(chunks).toString() || '{}'),
        });
      } catch (error) {
        reject(error);
      }
    };

    app.handle(request, response, reject);
  });
}

function makeApp(permissions = ['users.read']) {
  const app = express();
  app.use((req, _res, next) => {
    req.admin = {
      adminId: 1,
      role: 'viewer',
      username: 'admin-users-test',
      permissions: JSON.stringify(permissions),
    };
    next();
  });
  app.use('/admin/users', require('../../src/api/routes/admin/users'));
  app.use((err, _req, res, _next) => {
    res.status(500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

function uniqueFixture(prefix) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  return {
    suffix,
    userId: 880_000_000 + Math.floor(Math.random() * 10_000_000),
    categoryName: `${prefix}-category-${suffix}`,
    productName: `${prefix}-product-${suffix}`,
    slug: `${prefix}-product-${suffix}`,
  };
}

function seedRealUserWithOrders() {
  const fixture = uniqueFixture('admin-users-real');

  return db.transaction(() => {
    db.prepare(`
      INSERT INTO users (telegram_id, username, full_name, balance, created_at)
      VALUES (?, ?, ?, 5000, '2099-01-02 03:04:05')
    `).run(fixture.userId, `real_${fixture.suffix}`, `Real User ${fixture.suffix}`);
    const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
      fixture.categoryName,
      `category-${fixture.slug}`,
    );
    const product = db.prepare(`
      INSERT INTO products (category_id, name, slug, price, is_active)
      VALUES (?, ?, ?, 1000, 1)
    `).run(category.lastInsertRowid, fixture.productName, fixture.slug);
    const delivered = db.prepare(`
      INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, created_at)
      VALUES (?, ?, 1, 1000, ?, 'delivered', '2099-01-02 03:04:05')
    `).run(fixture.userId, product.lastInsertRowid, `PNS_REAL_DELIVERED_${fixture.suffix}`);
    const paid = db.prepare(`
      INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, created_at)
      VALUES (?, ?, 1, 1000, ?, 'paid', '2099-01-02 03:04:04')
    `).run(fixture.userId, product.lastInsertRowid, `PNS_REAL_PAID_${fixture.suffix}`);
    const topup = db.prepare(`
      INSERT INTO wallet_topups (user_id, amount, memo, status)
      VALUES (?, 20000, ?, 'matched')
    `).run(fixture.userId, `PNSU_REAL_${fixture.suffix}`);

    return {
      ...fixture,
      categoryId: category.lastInsertRowid,
      productId: product.lastInsertRowid,
      orderIds: [delivered.lastInsertRowid, paid.lastInsertRowid],
      topupId: topup.lastInsertRowid,
    };
  })();
}

function cleanupRealFixture(fixture) {
  db.transaction(() => {
    db.prepare('DELETE FROM wallet_topups WHERE id = ?').run(fixture.topupId);
    db.prepare('DELETE FROM orders WHERE id IN (?, ?)').run(...fixture.orderIds);
    db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
  })();
}

function seedOrderWithoutUser() {
  const fixture = uniqueFixture('admin-users-virtual');
  const base = db.transaction(() => {
    const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(
      fixture.categoryName,
      `category-${fixture.slug}`,
    );
    const product = db.prepare(`
      INSERT INTO products (category_id, name, slug, price, is_active)
      VALUES (?, ?, ?, 1000, 1)
    `).run(category.lastInsertRowid, fixture.productName, fixture.slug);
    return {
      ...fixture,
      categoryId: category.lastInsertRowid,
      productId: product.lastInsertRowid,
    };
  })();

  db.pragma('foreign_keys = OFF');
  try {
    return db.transaction(() => {
      const first = db.prepare(`
        INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, created_at)
        VALUES (?, ?, 1, 1000, ?, 'paid', '2099-01-03 03:04:05')
      `).run(base.userId, base.productId, `PNS_VIRTUAL_PAID_${base.suffix}`);
      const second = db.prepare(`
        INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, created_at)
        VALUES (?, ?, 1, 1000, ?, 'expired', '2099-01-03 03:04:04')
      `).run(base.userId, base.productId, `PNS_VIRTUAL_EXPIRED_${base.suffix}`);
      return { ...base, orderIds: [first.lastInsertRowid, second.lastInsertRowid] };
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

function cleanupOrderOnlyFixture(fixture) {
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM orders WHERE id IN (?, ?)').run(...fixture.orderIds);
      db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
      db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

test('GET /admin/users trả users, stats, meta và giữ delivered order_count cho real user', async (t) => {
  const fixture = seedRealUserWithOrders();
  t.after(() => cleanupRealFixture(fixture));

  const res = await requestJson(
    makeApp(),
    'GET',
    `/admin/users?search=${encodeURIComponent(`  ${fixture.userId}  `)}&page=1&limit=20`,
  );

  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.success, true);
  assert.strictEqual(res.json.data.users.length, 1);
  assert.strictEqual(res.json.data.users[0].telegram_id, fixture.userId);
  assert.strictEqual(res.json.data.users[0].order_count, 1);
  assert.strictEqual(res.json.data.users[0].is_virtual, false);
  assert.ok(res.json.data.stats.totalUsers >= 1);
  assert.ok(res.json.data.stats.buyers >= 1);
  assert.strictEqual(typeof res.json.data.stats.missingProfiles, 'number');
  assert.deepStrictEqual(res.json.meta, {
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  });
});

test('GET /admin/users gồm virtual user cho orphan orders và đếm mọi order', async (t) => {
  const fixture = seedOrderWithoutUser();
  t.after(() => cleanupOrderOnlyFixture(fixture));

  const res = await requestJson(makeApp(), 'GET', `/admin/users?search=${fixture.userId}`);

  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.data.users.length, 1);
  assert.deepStrictEqual(res.json.data.users[0], {
    telegram_id: fixture.userId,
    username: null,
    full_name: `ID ${fixture.userId}`,
    balance: 0,
    created_at: '2099-01-03 03:04:05',
    order_count: 2,
    is_virtual: true,
  });
  assert.ok(res.json.data.stats.missingProfiles >= 1);
});

test('GET /admin/users clamp page và limit vào khoảng hợp lệ', async () => {
  const low = await requestJson(makeApp(), 'GET', '/admin/users?page=0&limit=0');
  const high = await requestJson(makeApp(), 'GET', '/admin/users?page=-5&limit=500');

  assert.strictEqual(low.status, 200);
  assert.strictEqual(low.json.meta.page, 1);
  assert.strictEqual(low.json.meta.limit, 1);
  assert.strictEqual(high.status, 200);
  assert.strictEqual(high.json.meta.page, 1);
  assert.strictEqual(high.json.meta.limit, 100);
});

test('GET /admin/users không crash khi page quá lớn cho SQLite OFFSET', async () => {
  const res = await requestJson(makeApp(), 'GET', '/admin/users?page=999999999999999999999999&limit=100');

  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.meta.page, 1);
  assert.strictEqual(res.json.meta.limit, 100);
});

test('GET /admin/users/:telegramId trả real user và dữ liệu liên quan', async (t) => {
  const fixture = seedRealUserWithOrders();
  t.after(() => cleanupRealFixture(fixture));

  const res = await requestJson(makeApp(), 'GET', `/admin/users/${fixture.userId}`);

  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(res.json.data.user.telegram_id, fixture.userId);
  assert.strictEqual(res.json.data.user.is_virtual, false);
  assert.strictEqual(res.json.data.orders.length, 2);
  assert.strictEqual(res.json.data.recentTopups.length, 1);
});

test('GET /admin/users/:telegramId trả synthetic read-only user khi chỉ có orders', async (t) => {
  const fixture = seedOrderWithoutUser();
  t.after(() => cleanupOrderOnlyFixture(fixture));

  const res = await requestJson(makeApp(), 'GET', `/admin/users/${fixture.userId}`);

  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.deepStrictEqual(res.json.data.user, {
    telegram_id: fixture.userId,
    username: null,
    full_name: `ID ${fixture.userId}`,
    balance: 0,
    created_at: null,
    is_virtual: true,
  });
  assert.strictEqual(res.json.data.orders.length, 2);
  assert.deepStrictEqual(res.json.data.recentTopups, []);
});

test('GET /admin/users/:telegramId trả 400 cho id không phải số nguyên hợp lệ', async () => {
  for (const telegramId of ['abc', '123abc', '1.5']) {
    const res = await requestJson(makeApp(), 'GET', `/admin/users/${telegramId}`);
    assert.strictEqual(res.status, 400, `${telegramId}: ${JSON.stringify(res.json)}`);
    assert.strictEqual(res.json.error.code, 'INVALID_TELEGRAM_ID');
  }
});

test('GET /admin/users/:telegramId trả 404 khi không có profile lẫn order', async () => {
  const res = await requestJson(makeApp(), 'GET', '/admin/users/799999999');

  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.json.error.code, 'NOT_FOUND');
});

test('admin users routes yêu cầu users.read', async () => {
  const list = await requestJson(makeApp([]), 'GET', '/admin/users');
  const detail = await requestJson(makeApp([]), 'GET', '/admin/users/123');

  assert.strictEqual(list.status, 403);
  assert.strictEqual(list.json.error.code, 'FORBIDDEN');
  assert.strictEqual(detail.status, 403);
  assert.strictEqual(detail.json.error.code, 'FORBIDDEN');
});
