const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      this.ended = true;
      return this;
    },
  };
}

async function runRoute(method, routePath, { body = {}, params = {}, appLocals = {} } = {}) {
  const router = require('../../src/api/routes/admin/discounts');
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${routePath}`);
  const req = {
    body,
    params,
    admin: { adminId: 1, role: 'super_admin', username: 'admin' },
    app: { locals: appLocals },
    ip: '127.0.0.1',
  };
  const res = mockRes();

  for (const item of layer.route.stack) {
    if (res.ended) break;
    const handle = item.handle;
    if (handle.length >= 3) {
      await new Promise((resolve, reject) => {
        let nextCalled = false;
        const next = (err) => {
          nextCalled = true;
          err ? reject(err) : resolve();
        };
        Promise.resolve(handle(req, res, next))
          .then(() => {
            if (res.ended || nextCalled) resolve();
          })
          .catch(reject);
      });
    } else {
      await handle(req, res);
    }
  }

  return { status: res.statusCode, json: res.body };
}

function seedGlobalDiscount() {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const result = db.prepare(`
    INSERT INTO discount_codes (
      code, type, amount, is_active, is_global, notify_title, app_message, bot_message
    ) VALUES (?, 'percent', 10, 1, 1, ?, ?, ?)
  `).run(
    `MARKETING_${suffix}`,
    `Discount title ${suffix}`,
    `App message ${suffix}`,
    `<b>Bot message ${suffix}</b>`,
  );

  return {
    id: result.lastInsertRowid,
    code: `MARKETING_${suffix}`,
    title: `Discount title ${suffix}`,
  };
}

function cleanupDiscount(id) {
  db.prepare("DELETE FROM audit_log WHERE entity_type = 'discount' AND entity_id = ?").run(id);
  db.prepare('DELETE FROM discount_codes WHERE id = ?').run(id);
}

test('POST /:id/notify passes notificationType discount to broadcast', async (t) => {
  const discount = seedGlobalDiscount();
  const calls = [];
  t.after(() => cleanupDiscount(discount.id));

  const res = await runRoute('post', '/:id/notify', {
    params: { id: String(discount.id) },
    appLocals: {
      notificationService: {
        async broadcast(title, body, target, adminId, webBody, options = {}) {
          calls.push({ title, body, target, adminId, webBody, options });
          return { announcementId: 1, sent: 0, failed: 0, skippedByPreference: 0, total: 0, errors: [] };
        },
      },
    },
  });

  assert.strictEqual(res.status, 200, JSON.stringify(res.json));
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].options.notificationType, 'discount');
});
