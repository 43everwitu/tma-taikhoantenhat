const assert = require('node:assert');
const test = require('node:test');
const express = require('express');
const { PassThrough, Readable, Writable } = require('node:stream');
const Database = require('better-sqlite3');
const db = require('../../src/database');
const orderNoteService = require('../../src/services/orderNoteService');
const orderNotesMigration = require('../../src/database/migrations/057_order_notes');

const WRITE_ADMIN_ID = 991001;
const READ_ADMIN_ID = 991002;

async function requestJson(app, method, path, body) {
  return await new Promise((resolve, reject) => {
    const req = new Readable({
      read() {
        this.push(body ? Buffer.from(JSON.stringify(body)) : null);
        this.push(null);
      },
    });
    req.method = method;
    req.url = path;
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    req.headers = payload ? { 'content-type': 'application/json', 'content-length': String(payload.length) } : {};
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

function makeApp(admin = { adminId: WRITE_ADMIN_ID, role: 'super_admin', username: 'note_admin', permissions: JSON.stringify(['*']) }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = admin;
    next();
  });
  app.use('/admin/orders', require('../../src/api/routes/admin/orders'));
  app.use((_req, res) => {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  });
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ success: false, error: { code: 'TEST_ERROR', message: err.message } });
  });
  return app;
}

function ensureAdmin(id, username, displayName, permissions = ['*']) {
  db.prepare(`
    INSERT INTO admins (id, username, password_hash, display_name, role, permissions, is_active)
    VALUES (?, ?, 'x', ?, 'super_admin', ?, 1)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      display_name = excluded.display_name,
      permissions = excluded.permissions,
      role = excluded.role,
      is_active = 1
  `).run(id, username, displayName, JSON.stringify(permissions));
}

function createFixture() {
  ensureAdmin(WRITE_ADMIN_ID, 'note_admin', 'Admin Ghi Chú', ['*']);
  ensureAdmin(READ_ADMIN_ID, 'note_readonly', 'Admin Chỉ Đọc', ['orders.read']);
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userId = 871_000_000 + Math.floor(Math.random() * 100000);
  return db.transaction(() => {
    db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)')
      .run(userId, `note_${suffix}`, `Khách ghi chú ${suffix}`);
    const category = db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)')
      .run(`note-category-${suffix}`, `note-category-${suffix}`);
    const product = db.prepare(`
      INSERT INTO products (category_id, name, slug, price, is_active)
      VALUES (?, ?, ?, 100000, 1)
    `).run(category.lastInsertRowid, `Sản phẩm ghi chú ${suffix}`, `note-product-${suffix}`);
    const order = db.prepare(`
      INSERT INTO orders (user_id, product_id, quantity, total_price, payment_code, status, source)
      VALUES (?, ?, 1, 100000, ?, 'paid', 'web')
    `).run(userId, product.lastInsertRowid, `PNS_NOTE_${suffix}`);
    return {
      suffix,
      userId,
      categoryId: category.lastInsertRowid,
      productId: product.lastInsertRowid,
      orderId: order.lastInsertRowid,
      paymentCode: `PNS_NOTE_${suffix}`,
    };
  })();
}

function cleanupFixture(fixture) {
  db.transaction(() => {
    db.prepare('DELETE FROM audit_log WHERE entity_type = ? AND entity_id = ?').run('order', fixture.orderId);
    db.prepare('DELETE FROM order_notes WHERE order_id = ?').run(fixture.orderId);
    db.prepare('DELETE FROM orders WHERE id = ?').run(fixture.orderId);
    db.prepare('DELETE FROM products WHERE id = ?').run(fixture.productId);
    db.prepare('DELETE FROM categories WHERE id = ?').run(fixture.categoryId);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(fixture.userId);
    db.prepare('DELETE FROM admins WHERE id IN (?, ?)').run(WRITE_ADMIN_ID, READ_ADMIN_ID);
  })();
}

test('admin order notes can be created, listed, updated, and deleted', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const app = makeApp();

  const create = await requestJson(app, 'POST', `/admin/orders/${fixture.orderId}/notes`, {
    content: '  Khách cần xử lý thủ công sau thanh toán.  ',
  });
  assert.strictEqual(create.status, 200, JSON.stringify(create.json));
  assert.strictEqual(create.json.success, true);
  assert.strictEqual(create.json.data.content, 'Khách cần xử lý thủ công sau thanh toán.');
  assert.strictEqual(create.json.data.createdByAdminName, 'Admin Ghi Chú');
  const noteId = create.json.data.id;

  const list = await requestJson(app, 'GET', `/admin/orders?page=1&limit=20&q=${fixture.paymentCode}`, null);
  const listedOrder = list.json.data.orders.find((order) => order.id === String(fixture.orderId));
  assert.ok(listedOrder);
  assert.strictEqual(listedOrder.noteCount, 1);
  assert.ok(listedOrder.latestNoteAt);

  const detail = await requestJson(app, 'GET', `/admin/orders/${fixture.orderId}`, null);
  assert.strictEqual(detail.json.data.notes.length, 1);
  assert.strictEqual(detail.json.data.notes[0].id, noteId);
  assert.strictEqual(detail.json.data.notes[0].content, 'Khách cần xử lý thủ công sau thanh toán.');

  const update = await requestJson(app, 'PATCH', `/admin/orders/${fixture.orderId}/notes/${noteId}`, {
    content: 'Đã liên hệ khách, chờ phản hồi.',
  });
  assert.strictEqual(update.status, 200, JSON.stringify(update.json));
  assert.strictEqual(update.json.data.content, 'Đã liên hệ khách, chờ phản hồi.');
  assert.strictEqual(update.json.data.updatedByAdminName, 'Admin Ghi Chú');

  const afterUpdate = await requestJson(app, 'GET', `/admin/orders/${fixture.orderId}`, null);
  assert.strictEqual(afterUpdate.json.data.notes[0].content, 'Đã liên hệ khách, chờ phản hồi.');

  const del = await requestJson(app, 'DELETE', `/admin/orders/${fixture.orderId}/notes/${noteId}`, null);
  assert.strictEqual(del.status, 200, JSON.stringify(del.json));
  assert.strictEqual(del.json.success, true);

  const afterDelete = await requestJson(app, 'GET', `/admin/orders/${fixture.orderId}`, null);
  assert.deepStrictEqual(afterDelete.json.data.notes, []);

  const auditActions = db.prepare(`
    SELECT action, details
    FROM audit_log
    WHERE entity_type = 'order' AND entity_id = ?
    ORDER BY id ASC
  `).all(fixture.orderId).map(row => ({
    action: row.action,
    details: JSON.parse(row.details),
  }));
  assert.deepStrictEqual(
    auditActions.map(row => row.action),
    ['order.note_create', 'order.note_update', 'order.note_delete'],
  );
  assert.deepStrictEqual(
    auditActions.map(row => row.details.noteId),
    [noteId, noteId, noteId],
  );
});

test('admin order note validation and ownership checks are enforced', async (t) => {
  const one = createFixture();
  const two = createFixture();
  t.after(() => {
    cleanupFixture(one);
    cleanupFixture(two);
  });
  const app = makeApp();

  const empty = await requestJson(app, 'POST', `/admin/orders/${one.orderId}/notes`, { content: '   ' });
  assert.strictEqual(empty.status, 400);

  const tooLong = await requestJson(app, 'POST', `/admin/orders/${one.orderId}/notes`, { content: 'x'.repeat(2001) });
  assert.strictEqual(tooLong.status, 400);

  const created = await requestJson(app, 'POST', `/admin/orders/${one.orderId}/notes`, { content: 'Note thuộc đơn một' });
  const wrongOrderPatch = await requestJson(app, 'PATCH', `/admin/orders/${two.orderId}/notes/${created.json.data.id}`, {
    content: 'Không được sửa qua đơn khác',
  });
  assert.strictEqual(wrongOrderPatch.status, 404);

  const wrongOrderDelete = await requestJson(app, 'DELETE', `/admin/orders/${two.orderId}/notes/${created.json.data.id}`, null);
  assert.strictEqual(wrongOrderDelete.status, 404);
});

test('admin order note writes require orders.write permission', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const writeApp = makeApp();
  const readOnlyApp = makeApp({
    adminId: READ_ADMIN_ID,
    role: 'super_admin',
    username: 'note_readonly',
    permissions: JSON.stringify(['orders.read']),
  });

  const createDenied = await requestJson(readOnlyApp, 'POST', `/admin/orders/${fixture.orderId}/notes`, {
    content: 'Không đủ quyền tạo',
  });
  assert.strictEqual(createDenied.status, 403);

  const created = await requestJson(writeApp, 'POST', `/admin/orders/${fixture.orderId}/notes`, {
    content: 'Note để kiểm tra quyền',
  });
  const noteId = created.json.data.id;

  const updateDenied = await requestJson(readOnlyApp, 'PATCH', `/admin/orders/${fixture.orderId}/notes/${noteId}`, {
    content: 'Không đủ quyền sửa',
  });
  assert.strictEqual(updateDenied.status, 403);

  const deleteDenied = await requestJson(readOnlyApp, 'DELETE', `/admin/orders/${fixture.orderId}/notes/${noteId}`, null);
  assert.strictEqual(deleteDenied.status, 403);
});

test('admin order note reads require orders.read permission', async (t) => {
  const fixture = createFixture();
  t.after(() => cleanupFixture(fixture));
  const app = makeApp({
    adminId: READ_ADMIN_ID,
    role: 'super_admin',
    username: 'note_blocked',
    permissions: JSON.stringify([]),
  });

  const list = await requestJson(app, 'GET', `/admin/orders?q=${fixture.paymentCode}`, null);
  assert.strictEqual(list.status, 403);

  const detail = await requestJson(app, 'GET', `/admin/orders/${fixture.orderId}`, null);
  assert.strictEqual(detail.status, 403);

  const exportRes = await requestJson(app, 'GET', '/admin/orders/export', null);
  assert.strictEqual(exportRes.status, 403);
});

test('order notes migration cascades when an order is hard-deleted', () => {
  const memoryDb = new Database(':memory:');
  memoryDb.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE orders (id INTEGER PRIMARY KEY);
    CREATE TABLE admins (id INTEGER PRIMARY KEY);
  `);

  orderNotesMigration.up(memoryDb);

  const orderFk = memoryDb.prepare('PRAGMA foreign_key_list(order_notes)').all()
    .find(row => row.table === 'orders' && row.from === 'order_id');
  assert.strictEqual(orderFk.on_delete, 'CASCADE');

  memoryDb.close();
});

test('order note audit preview is capped at 120 characters including suffix', () => {
  const preview = orderNoteService.previewContent('x'.repeat(121));

  assert.strictEqual(preview.length, 120);
  assert.strictEqual(preview, `${'x'.repeat(117)}...`);
});
