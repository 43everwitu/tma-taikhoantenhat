# Announcement Markdown Lite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `admin/announcements` accept lightweight Markdown for bold and strikethrough, then store/send safe HTML that renders correctly on Telegram and TMA.

**Architecture:** Add a narrow announcement formatter at the admin announcement route boundary. Store sanitized rich HTML in `announcements.body`; keep resend using the stored body. Before Telegram delivery, normalize the body through `toTelegramHtml()` while leaving DB/web notification content as sanitized HTML.

**Tech Stack:** Node.js, Express router, `sanitize-html` via `src/utils/richHtml.js`, Telegraf `parse_mode: 'HTML'`, Node built-in test runner.

---

### Task 1: Add API coverage for Markdown-lite announcement bodies

**Files:**
- Modify: `tests/api/admin-announcements-image.test.js`
- Test: `tests/api/admin-announcements-image.test.js`

- [ ] **Step 1: Add a POST route test for Markdown conversion**

Append this test to `tests/api/admin-announcements-image.test.js`:

```js
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
```

- [ ] **Step 2: Add a PATCH route test for direct `<s>` HTML**

Append this test to the same file:

```js
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
```

- [ ] **Step 3: Run the focused API test and verify it fails before implementation**

Run:

```bash
node --test tests/api/admin-announcements-image.test.js
```

Expected before implementation: FAIL because `**...**` stays literal and `<s>` is stripped by the current route sanitizer.

### Task 2: Implement announcement body formatter

**Files:**
- Modify: `src/api/routes/admin/announcements.js`
- Test: `tests/api/admin-announcements-image.test.js`

- [ ] **Step 1: Replace local `sanitize-html` usage with the shared rich sanitizer**

At the top of `src/api/routes/admin/announcements.js`, replace:

```js
const sanitizeHtml = require('sanitize-html');
```

with:

```js
const { sanitizeRich } = require('../../../utils/richHtml');
```

- [ ] **Step 2: Add a narrow Markdown-lite formatter**

Add this helper after `shapeAnnouncement()`:

```js
function formatAnnouncementBody(raw) {
  if (raw == null) return '';
  const withMarkdown = String(raw)
    .replace(/\*\*([^\n*][\s\S]*?[^\n*]|\S)\*\*/g, '<b>$1</b>')
    .replace(/~~([^\n~][\s\S]*?[^\n~]|\S)~~/g, '<s>$1</s>');
  return sanitizeRich(withMarkdown);
}
```

- [ ] **Step 3: Use the helper in POST and PATCH**

In the POST handler, replace the current `cleanBody` block with:

```js
  const cleanBody = formatAnnouncementBody(d.body);
```

In the PATCH handler, replace the current `cleanBody` block with:

```js
    const cleanBody = formatAnnouncementBody(req.validated.body);
```

- [ ] **Step 4: Run the focused API test**

Run:

```bash
node --test tests/api/admin-announcements-image.test.js
```

Expected after implementation: PASS.

### Task 3: Normalize Telegram announcement body at send time

**Files:**
- Modify: `src/services/notificationService.js`
- Modify: `tests/services/announcementImageBroadcast.test.js`
- Test: `tests/services/announcementImageBroadcast.test.js`

- [ ] **Step 1: Add a service test for Telegram-ready body and unchanged web body**

Append this test to `tests/services/announcementImageBroadcast.test.js`:

```js
test('broadcast sends Telegram-ready HTML while keeping web rich HTML', async (t) => {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const userTg = 992_000_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, username, full_name) VALUES (?, ?, ?)').run(userTg, `ann_html_${suffix}`, 'Ann Html');
  t.after(() => {
    db.prepare('DELETE FROM announcements WHERE title = ?').run(`HTML ${suffix}`);
    db.prepare('DELETE FROM notifications WHERE user_id = ?').run(userTg);
    db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userTg);
  });

  const bot = createBot();
  const service = new NotificationService(bot);
  await service.broadcast(`HTML ${suffix}`, '<b>99K</b><br><s>149K</s>', 'all', 1);

  const call = bot.calls.find((item) => item.chatId === userTg);
  assert.ok(call, 'expected Telegram call for seeded user');
  assert.strictEqual(call.body, '<b>99K</b>\n<s>149K</s>');

  const notification = db.prepare('SELECT body FROM notifications WHERE user_id = ? ORDER BY id DESC').get(userTg);
  assert.strictEqual(notification.body, '<b>99K</b><br><s>149K</s>');
});
```

- [ ] **Step 2: Import `toTelegramHtml` in notification service**

At the top of `src/services/notificationService.js`, add:

```js
const { toTelegramHtml } = require('../utils/richHtml');
```

- [ ] **Step 3: Use Telegram-normalized body only for bot sends**

Inside `broadcast()`, after `telegramImageUrl`, add:

```js
    const telegramBody = body ? toTelegramHtml(body) : '';
```

Then replace Telegram send calls:

```js
await this.bot.telegram.sendPhoto(user.telegram_id, telegramImageUrl, { caption: body, parse_mode: 'HTML' });
await this.bot.telegram.sendMessage(user.telegram_id, body, { parse_mode: 'HTML' });
```

with:

```js
await this.bot.telegram.sendPhoto(user.telegram_id, telegramImageUrl, { caption: telegramBody, parse_mode: 'HTML' });
await this.bot.telegram.sendMessage(user.telegram_id, telegramBody, { parse_mode: 'HTML' });
```

Keep announcement DB insert and web notification body unchanged.

- [ ] **Step 4: Run service test**

Run:

```bash
node --test tests/services/announcementImageBroadcast.test.js
```

Expected after implementation: PASS.

### Task 4: Final verification

**Files:**
- Verify only.

- [ ] **Step 1: Run all focused announcement tests**

Run:

```bash
node --test tests/api/admin-announcements-image.test.js tests/services/announcementImageBroadcast.test.js
```

Expected: PASS.

- [ ] **Step 2: Check syntax for touched backend files**

Run:

```bash
node --check src/api/routes/admin/announcements.js
node --check src/services/notificationService.js
```

Expected: no output and exit code 0 for both commands.

- [ ] **Step 3: Review changed files only**

Run:

```bash
git diff -- src/api/routes/admin/announcements.js src/services/notificationService.js tests/api/admin-announcements-image.test.js tests/services/announcementImageBroadcast.test.js
```

Expected: diff is limited to announcement Markdown-lite support and Telegram send normalization.
