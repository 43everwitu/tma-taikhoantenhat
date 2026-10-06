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

async function runRoute(method, routePath, { body = {}, params = {}, query = {}, appLocals = {} } = {}) {
  const router = require('../../src/api/routes/admin/announcements');
  const layer = router.stack.find((l) => l.route?.path === routePath && l.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${routePath}`);
  const req = {
    body,
    params,
    query,
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

test('admin announcements accepts and returns Telegram imageUrl', async (t) => {
  const title = `Announcement image ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const calls = [];
  const notificationService = {
    async broadcast(sentTitle, body, target, adminId, webBody, options = {}) {
      calls.push({ sentTitle, body, target, adminId, webBody, options });
      const result = db.prepare(`
        INSERT INTO announcements (title, body, admin_id, target, image_url)
        VALUES (?, ?, ?, ?, ?)
      `).run(sentTitle, body, adminId, target, options.imageUrl || null);
      return { announcementId: result.lastInsertRowid, sent: 0, failed: 0, total: 0, errors: [] };
    },
  };
  t.after(() => {
    db.prepare('DELETE FROM announcements WHERE title = ?').run(title);
  });

  const imageUrl = 'https://example.com/admin-announcement.png';
  const created = await runRoute('post', '/', {
    appLocals: { notificationService },
    body: { title, body: '<b>Nội dung</b>', target: 'telegram', isPinned: false, imageUrl },
  });

  assert.strictEqual(created.status, 200, `unexpected body: ${JSON.stringify(created.json)}`);
  assert.strictEqual(calls[0].options.imageUrl, imageUrl);

  const listed = await runRoute('get', '/');
  assert.strictEqual(listed.status, 200, `unexpected body: ${JSON.stringify(listed.json)}`);
  const row = listed.json.data.find((item) => item.id === String(created.json.data.announcementId));
  assert.ok(row, 'expected created announcement in list');
  assert.strictEqual(row.imageUrl, imageUrl);
});

test('admin announcements convert markdown-lite body to safe rich HTML', async (t) => {
  const title = `Announcement markdown ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const calls = [];
  const notificationService = {
    async broadcast(sentTitle, body, target, adminId, webBody, options = {}) {
      calls.push({ sentTitle, body, target, adminId, webBody, options });
      const result = db.prepare(`
        INSERT INTO announcements (title, body, admin_id, target, image_url)
        VALUES (?, ?, ?, ?, ?)
      `).run(sentTitle, body, adminId, target, options.imageUrl || null);
      return { announcementId: result.lastInsertRowid, sent: 0, failed: 0, total: 0, errors: [] };
    },
  };
  t.after(() => {
    db.prepare('DELETE FROM announcements WHERE title = ?').run(title);
  });

  const created = await runRoute('post', '/', {
    appLocals: { notificationService },
    body: {
      title,
      body: '🔥 6 tháng: **99K** ~~149K~~\n🎁 Giảm thêm **6%**',
      target: 'telegram',
      isPinned: false,
    },
  });

  assert.strictEqual(created.status, 200, `unexpected body: ${JSON.stringify(created.json)}`);
  assert.strictEqual(calls[0].body, '🔥 6 tháng: <b>99K</b> <s>149K</s>\n🎁 Giảm thêm <b>6%</b>');

  const row = db.prepare('SELECT body FROM announcements WHERE title = ?').get(title);
  assert.strictEqual(row.body, calls[0].body);
});

test('admin announcements patch keeps strikethrough HTML', async (t) => {
  const title = `Announcement patch ${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const result = db.prepare(`
    INSERT INTO announcements (title, body, admin_id, target)
    VALUES (?, ?, ?, ?)
  `).run(title, 'old body', 1, 'all');
  const id = result.lastInsertRowid;
  t.after(() => {
    db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  });

  const updated = await runRoute('patch', '/:id', {
    params: { id: String(id) },
    body: { body: '<b>99K</b> <s>149K</s><script>alert(1)</script>' },
  });

  assert.strictEqual(updated.status, 200, `unexpected body: ${JSON.stringify(updated.json)}`);
  const row = db.prepare('SELECT body FROM announcements WHERE id = ?').get(id);
  assert.strictEqual(row.body, '<b>99K</b> <s>149K</s>');
});
