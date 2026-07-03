# Telegram Notification Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cho user bật/tắt Telegram bot DM dạng marketing/cập nhật bằng `/thongbao`, đồng thời sửa `/start` không được im lặng khi template `welcome` bị tắt.

**Architecture:** Lưu preference trong `users.notification_prefs` với key `telegramMarketingEnabled`, default bật để giữ hành vi user cũ. Bot command `/thongbao` và callback inline dùng chung renderer trạng thái. Notification marketing lọc Telegram per-user ở `NotificationService`, nhưng vẫn tạo web/TMA notification và không ảnh hưởng tin giao dịch quan trọng.

**Tech Stack:** Node.js 22, Telegraf, better-sqlite3, node:test, CommonJS.

---

## File Structure

- Create `src/services/userNotificationPreferenceService.js`: parse/merge JSON `notification_prefs`, đọc/ghi `telegramMarketingEnabled`, giữ nguyên key cũ.
- Create `tests/services/userNotificationPreferenceService.test.js`: test default bật, set tắt/bật, giữ key auth cũ, JSON hỏng default bật.
- Create `src/commands/notificationPreferences.js`: handler `/thongbao`, callback `notify_pref:*`, renderer text/inline keyboard và button dùng trong `/start`.
- Create `tests/bot/notificationPreferences.test.js`: test command, callback bật/tắt/bỏ qua.
- Modify `src/bot/index.js`: đăng ký command `/thongbao` trước fallback callback và thêm command menu.
- Modify `src/commands/start.js`: luôn reply dù `welcome` disabled, thêm trạng thái + nút quản lý thông báo.
- Modify `tests/bot/start-deep-link.test.js`: stub template/pref service, test fallback khi welcome disabled, test nút quản lý thông báo.
- Modify `src/services/notificationService.js`: lọc Telegram marketing theo preference trong `notify()` và `broadcast()`, thêm `skippedByPreference`.
- Create `tests/services/notificationMarketingPreference.test.js`: test broadcast skip Telegram nhưng vẫn insert web notification, stock replenish dùng cùng policy, delivery vẫn gửi.

## Task 1: User Notification Preference Service

**Files:**
- Create: `src/services/userNotificationPreferenceService.js`
- Create: `tests/services/userNotificationPreferenceService.test.js`

- [ ] **Step 1: Write failing service tests**

Create `tests/services/userNotificationPreferenceService.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const prefs = require('../../src/services/userNotificationPreferenceService');

function seedUser(overrides = {}) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const telegramId = 870_100_000 + Math.floor(Math.random() * 100000);
  db.prepare(`
    INSERT INTO users (telegram_id, username, full_name, notification_prefs)
    VALUES (?, ?, ?, ?)
  `).run(
    telegramId,
    `pref_${suffix}`,
    `Pref ${suffix}`,
    overrides.notificationPrefs === undefined ? '{}' : overrides.notificationPrefs,
  );
  return telegramId;
}

function cleanup(telegramId) {
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
}

test('telegram marketing preference defaults to enabled when key is missing', (t) => {
  const telegramId = seedUser();
  t.after(() => cleanup(telegramId));

  assert.strictEqual(prefs.isTelegramMarketingEnabled(telegramId), true);
});

test('setTelegramMarketingEnabled toggles value and preserves existing JSON keys', (t) => {
  const telegramId = seedUser({
    notificationPrefs: JSON.stringify({ linkCode: '123456', resetCode: '654321' }),
  });
  t.after(() => cleanup(telegramId));

  prefs.setTelegramMarketingEnabled(telegramId, false);
  assert.strictEqual(prefs.isTelegramMarketingEnabled(telegramId), false);

  let row = db.prepare('SELECT notification_prefs FROM users WHERE telegram_id = ?').get(telegramId);
  let parsed = JSON.parse(row.notification_prefs);
  assert.strictEqual(parsed.linkCode, '123456');
  assert.strictEqual(parsed.resetCode, '654321');
  assert.strictEqual(parsed.telegramMarketingEnabled, false);

  prefs.setTelegramMarketingEnabled(telegramId, true);
  assert.strictEqual(prefs.isTelegramMarketingEnabled(telegramId), true);

  row = db.prepare('SELECT notification_prefs FROM users WHERE telegram_id = ?').get(telegramId);
  parsed = JSON.parse(row.notification_prefs);
  assert.strictEqual(parsed.linkCode, '123456');
  assert.strictEqual(parsed.telegramMarketingEnabled, true);
});

test('invalid notification_prefs JSON is treated as empty preferences', (t) => {
  const telegramId = seedUser({ notificationPrefs: '{not-json' });
  t.after(() => cleanup(telegramId));

  assert.strictEqual(prefs.isTelegramMarketingEnabled(telegramId), true);
  prefs.setTelegramMarketingEnabled(telegramId, false);

  const row = db.prepare('SELECT notification_prefs FROM users WHERE telegram_id = ?').get(telegramId);
  assert.deepStrictEqual(JSON.parse(row.notification_prefs), { telegramMarketingEnabled: false });
});
```

- [ ] **Step 2: Run service tests and verify they fail**

Run:

```bash
node --test tests/services/userNotificationPreferenceService.test.js
```

Expected: FAIL with `Cannot find module '../../src/services/userNotificationPreferenceService'`.

- [ ] **Step 3: Implement preference service**

Create `src/services/userNotificationPreferenceService.js`:

```js
const db = require('../database');

const TELEGRAM_MARKETING_KEY = 'telegramMarketingEnabled';

function parsePrefs(raw) {
  if (!raw || typeof raw !== 'string') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getNotificationPrefs(rowOrTelegramId) {
  if (rowOrTelegramId && typeof rowOrTelegramId === 'object') {
    return parsePrefs(rowOrTelegramId.notification_prefs);
  }
  const row = db.prepare('SELECT notification_prefs FROM users WHERE telegram_id = ?').get(rowOrTelegramId);
  return parsePrefs(row?.notification_prefs);
}

function isTelegramMarketingEnabled(rowOrTelegramId) {
  const prefs = getNotificationPrefs(rowOrTelegramId);
  return prefs[TELEGRAM_MARKETING_KEY] !== false;
}

function setTelegramMarketingEnabled(telegramId, enabled) {
  const row = db.prepare('SELECT notification_prefs FROM users WHERE telegram_id = ?').get(telegramId);
  const prefs = parsePrefs(row?.notification_prefs);
  prefs[TELEGRAM_MARKETING_KEY] = enabled === true;
  db.prepare(`
    UPDATE users
    SET notification_prefs = ?, updated_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ?
  `).run(JSON.stringify(prefs), telegramId);
  return prefs;
}

module.exports = {
  TELEGRAM_MARKETING_KEY,
  getNotificationPrefs,
  isTelegramMarketingEnabled,
  setTelegramMarketingEnabled,
};
```

- [ ] **Step 4: Run service tests and verify they pass**

Run:

```bash
node --test tests/services/userNotificationPreferenceService.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add src/services/userNotificationPreferenceService.js tests/services/userNotificationPreferenceService.test.js
git commit -m "feat: add user telegram notification preferences"
```

## Task 2: `/thongbao` Bot Command

**Files:**
- Create: `src/commands/notificationPreferences.js`
- Create: `tests/bot/notificationPreferences.test.js`
- Modify: `src/bot/index.js`

- [ ] **Step 1: Write failing bot command tests**

Create `tests/bot/notificationPreferences.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const {
  CALLBACK_PREFIX,
  buildNotificationPreferenceView,
  handleNotificationCommand,
  handleNotificationCallback,
} = require('../../src/commands/notificationPreferences');

function makeCtx({ from, sentRef, editedRef, answersRef, match }) {
  return {
    from,
    match,
    reply: async (text, extra) => { sentRef.push({ text, extra }); },
    editMessageText: async (text, extra) => { editedRef.push({ text, extra }); },
    answerCbQuery: async (text) => { answersRef.push(text || ''); },
  };
}

function cleanup(telegramId) {
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
}

test('buildNotificationPreferenceView shows disable button when enabled', () => {
  const view = buildNotificationPreferenceView(true);
  assert.match(view.text, /đang bật/i);
  const buttons = view.reply_markup.inline_keyboard.flat();
  assert.ok(buttons.some((button) => button.text === 'Tắt thông báo' && button.callback_data === `${CALLBACK_PREFIX}:off`));
  assert.ok(buttons.some((button) => button.text === 'Bỏ qua' && button.callback_data === `${CALLBACK_PREFIX}:skip`));
});

test('/thongbao creates user and replies with current enabled state', async (t) => {
  const telegramId = 871_100_000 + Math.floor(Math.random() * 100000);
  t.after(() => cleanup(telegramId));

  const sent = [];
  await handleNotificationCommand(makeCtx({
    from: { id: telegramId, first_name: 'Khoa', username: 'khoa_test' },
    sentRef: sent,
    editedRef: [],
    answersRef: [],
  }));

  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /đang bật/i);
  assert.ok(db.prepare('SELECT telegram_id FROM users WHERE telegram_id = ?').get(telegramId));
});

test('notify_pref off/on callbacks update preference and edit message', async (t) => {
  const telegramId = 871_200_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name, notification_prefs) VALUES (?, ?, ?)')
    .run(telegramId, 'Toggle User', '{}');
  t.after(() => cleanup(telegramId));

  const edited = [];
  const answers = [];
  await handleNotificationCallback(makeCtx({
    from: { id: telegramId, first_name: 'Toggle' },
    sentRef: [],
    editedRef: edited,
    answersRef: answers,
    match: [`${CALLBACK_PREFIX}:off`, 'off'],
  }));

  let row = db.prepare('SELECT notification_prefs FROM users WHERE telegram_id = ?').get(telegramId);
  assert.strictEqual(JSON.parse(row.notification_prefs).telegramMarketingEnabled, false);
  assert.match(edited.at(-1).text, /đang tắt/i);
  assert.ok(answers.length >= 1);

  await handleNotificationCallback(makeCtx({
    from: { id: telegramId, first_name: 'Toggle' },
    sentRef: [],
    editedRef: edited,
    answersRef: answers,
    match: [`${CALLBACK_PREFIX}:on`, 'on'],
  }));

  row = db.prepare('SELECT notification_prefs FROM users WHERE telegram_id = ?').get(telegramId);
  assert.strictEqual(JSON.parse(row.notification_prefs).telegramMarketingEnabled, true);
  assert.match(edited.at(-1).text, /đang bật/i);
});

test('notify_pref skip answers callback without changing preference or editing message', async (t) => {
  const telegramId = 871_300_000 + Math.floor(Math.random() * 100000);
  db.prepare('INSERT INTO users (telegram_id, full_name, notification_prefs) VALUES (?, ?, ?)')
    .run(telegramId, 'Skip User', JSON.stringify({ telegramMarketingEnabled: false }));
  t.after(() => cleanup(telegramId));

  const edited = [];
  const answers = [];
  await handleNotificationCallback(makeCtx({
    from: { id: telegramId, first_name: 'Skip' },
    sentRef: [],
    editedRef: edited,
    answersRef: answers,
    match: [`${CALLBACK_PREFIX}:skip`, 'skip'],
  }));

  const row = db.prepare('SELECT notification_prefs FROM users WHERE telegram_id = ?').get(telegramId);
  assert.strictEqual(JSON.parse(row.notification_prefs).telegramMarketingEnabled, false);
  assert.strictEqual(edited.length, 0);
  assert.deepStrictEqual(answers, ['Đã giữ nguyên cài đặt.']);
});
```

- [ ] **Step 2: Run command tests and verify they fail**

Run:

```bash
node --test tests/bot/notificationPreferences.test.js
```

Expected: FAIL with `Cannot find module '../../src/commands/notificationPreferences'`.

- [ ] **Step 3: Implement `/thongbao` command module**

Create `src/commands/notificationPreferences.js`:

```js
const userService = require('../services/userService');
const preferenceService = require('../services/userNotificationPreferenceService');

const CALLBACK_PREFIX = 'notify_pref';

function buildNotificationPreferenceView(enabled) {
  const status = enabled ? 'đang bật' : 'đang tắt';
  const action = enabled
    ? { text: 'Tắt thông báo', callback_data: `${CALLBACK_PREFIX}:off` }
    : { text: 'Bật thông báo', callback_data: `${CALLBACK_PREFIX}:on` };

  return {
    text: `Thông báo từ bot ${status}.\n\nCác tin giao dịch quan trọng như giao đơn, thanh toán và bảo mật vẫn luôn được gửi.`,
    reply_markup: {
      inline_keyboard: [[
        action,
        { text: 'Bỏ qua', callback_data: `${CALLBACK_PREFIX}:skip` },
      ]],
    },
  };
}

function notificationStatusLine(telegramIdOrUserRow) {
  const enabled = preferenceService.isTelegramMarketingEnabled(telegramIdOrUserRow);
  return `Thông báo bot: ${enabled ? 'đang bật' : 'đang tắt'}`;
}

function manageNotificationsButton() {
  return { text: 'Quản lý thông báo', callback_data: `${CALLBACK_PREFIX}:show` };
}

async function replyPreferenceView(ctx, enabled) {
  const view = buildNotificationPreferenceView(enabled);
  await ctx.reply(view.text, { reply_markup: view.reply_markup });
}

async function editPreferenceView(ctx, enabled) {
  const view = buildNotificationPreferenceView(enabled);
  try {
    await ctx.editMessageText(view.text, { reply_markup: view.reply_markup });
  } catch {
    await ctx.reply(view.text, { reply_markup: view.reply_markup });
  }
}

async function handleNotificationCommand(ctx) {
  const user = userService.findOrCreate(ctx.from);
  await replyPreferenceView(ctx, preferenceService.isTelegramMarketingEnabled(user));
}

async function handleNotificationCallback(ctx) {
  const action = ctx.match?.[1] || String(ctx.callbackQuery?.data || '').split(':')[1] || 'show';
  const user = userService.findOrCreate(ctx.from);

  if (action === 'skip') {
    await ctx.answerCbQuery('Đã giữ nguyên cài đặt.');
    return;
  }

  if (action === 'on' || action === 'off') {
    preferenceService.setTelegramMarketingEnabled(user.telegram_id, action === 'on');
    await ctx.answerCbQuery(action === 'on' ? 'Đã bật thông báo.' : 'Đã tắt thông báo.');
    await editPreferenceView(ctx, action === 'on');
    return;
  }

  await ctx.answerCbQuery();
  await editPreferenceView(ctx, preferenceService.isTelegramMarketingEnabled(user));
}

module.exports = (bot) => {
  bot.command('thongbao', handleNotificationCommand);
  bot.action(new RegExp(`^${CALLBACK_PREFIX}:(show|on|off|skip)$`), handleNotificationCallback);
};

module.exports.CALLBACK_PREFIX = CALLBACK_PREFIX;
module.exports.buildNotificationPreferenceView = buildNotificationPreferenceView;
module.exports.notificationStatusLine = notificationStatusLine;
module.exports.manageNotificationsButton = manageNotificationsButton;
module.exports.handleNotificationCommand = handleNotificationCommand;
module.exports.handleNotificationCallback = handleNotificationCallback;
```

- [ ] **Step 4: Register command before fallback**

Modify `src/bot/index.js`:

```js
  require('../commands/start')(bot);
  require('../commands/notificationPreferences')(bot);

  require('./lowStockActions')(bot);
```

Replace command menu:

```js
  const COMMANDS = [
    { command: 'start', description: 'Mở cửa hàng' },
    { command: 'thongbao', description: 'Bật/tắt thông báo' },
  ];
```

- [ ] **Step 5: Run command tests and verify they pass**

Run:

```bash
node --test tests/services/userNotificationPreferenceService.test.js tests/bot/notificationPreferences.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add src/commands/notificationPreferences.js src/bot/index.js tests/bot/notificationPreferences.test.js
git commit -m "feat: add telegram notification command"
```

## Task 3: `/start` Fallback and Notification Status

**Files:**
- Modify: `src/commands/start.js`
- Modify: `tests/bot/start-deep-link.test.js`

- [ ] **Step 1: Update `/start` tests for template disabled and notification button**

Replace `tests/bot/start-deep-link.test.js` with:

```js
const test = require('node:test');
const assert = require('node:assert');

process.env.MINIAPP_URL = 'https://taikhoantenhat.example.com/';

const userServicePath = require.resolve('../../src/services/userService');
require.cache[userServicePath] = {
  id: userServicePath,
  filename: userServicePath,
  loaded: true,
  exports: {
    findOrCreate: (from) => ({
      id: 1,
      telegram_id: from?.id ?? 0,
      full_name: from?.first_name ?? '',
      username: from?.username ?? '',
      notification_prefs: from?.notification_prefs || '{}',
      balance: 0,
    }),
  },
};

const templatePath = require.resolve('../../src/services/messageTemplateService');
const templateStub = { renderIfEnabled: () => 'Xin chào Khoa' };
require.cache[templatePath] = {
  id: templatePath,
  filename: templatePath,
  loaded: true,
  exports: templateStub,
};

delete require.cache[require.resolve('../../src/commands/start')];
const { handleStart } = require('../../src/commands/start');

function makeCtx({ payload, from = { id: 1, first_name: 'Khoa' }, sentRef }) {
  return {
    from,
    startPayload: payload || '',
    botInfo: { username: 'shop_bot' },
    reply: async (text, extra) => { sentRef.push({ text, extra }); },
  };
}

function flattenButtons(sent) {
  return sent.extra.reply_markup.inline_keyboard.flat();
}

test('/start with no payload renders welcome + root Mini App button', async () => {
  templateStub.renderIfEnabled = () => 'Xin chào Khoa';
  const sent = [];
  await handleStart(makeCtx({ sentRef: sent }));
  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /Xin chào Khoa/);
  assert.match(sent[0].text, /Thông báo bot: đang bật/);
  const button = flattenButtons(sent[0]).find((item) => item.text === 'Mở cửa hàng');
  assert.strictEqual(button.web_app.url, 'https://taikhoantenhat.example.com/');
});

test('/start order_42 renders a button to the order page', async () => {
  templateStub.renderIfEnabled = () => 'Xin chào Khoa';
  const sent = [];
  await handleStart(makeCtx({ payload: 'order_42', sentRef: sent }));
  const button = flattenButtons(sent[0]).find((item) => item.text === 'Mở cửa hàng');
  assert.match(button.web_app.url, /\/don-hang\/42$/);
});

test('/start with malformed payload falls back to default', async () => {
  templateStub.renderIfEnabled = () => 'Xin chào Khoa';
  const sent = [];
  await handleStart(makeCtx({ payload: '../../etc/passwd', sentRef: sent }));
  const button = flattenButtons(sent[0]).find((item) => item.text === 'Mở cửa hàng');
  assert.strictEqual(button.web_app.url, 'https://taikhoantenhat.example.com/');
});

test('/start replies with fallback text when welcome template is disabled', async () => {
  templateStub.renderIfEnabled = () => null;
  const sent = [];
  await handleStart(makeCtx({ sentRef: sent }));

  assert.strictEqual(sent.length, 1);
  assert.match(sent[0].text, /Mở cửa hàng/);
  assert.match(sent[0].text, /Thông báo bot: đang bật/);
});

test('/start includes manage notification callback button', async () => {
  templateStub.renderIfEnabled = () => 'Xin chào Khoa';
  const sent = [];
  await handleStart(makeCtx({ sentRef: sent }));

  const button = flattenButtons(sent[0]).find((item) => item.text === 'Quản lý thông báo');
  assert.strictEqual(button.callback_data, 'notify_pref:show');
});
```

- [ ] **Step 2: Run `/start` tests and verify new tests fail**

Run:

```bash
node --test tests/bot/start-deep-link.test.js
```

Expected: FAIL because `/start` returns early when template is disabled and does not include notification status/button.

- [ ] **Step 3: Implement `/start` fallback and notification status**

Modify `src/commands/start.js`:

```js
const userService = require('../services/userService');
const messageTemplateService = require('../services/messageTemplateService');
const { openShopButton } = require('../utils/miniAppButton');
const {
    manageNotificationsButton,
    notificationStatusLine,
} = require('./notificationPreferences');

async function handleStart(ctx) {
    const user = userService.findOrCreate(ctx.from);

    const name = user.full_name || ctx.from?.first_name || ctx.from?.username || 'bạn';
    const username = user.username || ctx.from?.username || '';
    const db = require('../database');
    const supportRow = db.prepare(`SELECT value FROM settings WHERE key = 'support_contact'`).get();
    const supportContact = supportRow?.value || process.env.SUPPORT_CONTACT || '@admin';

    const welcomeText = messageTemplateService.renderIfEnabled('welcome', {
        name,
        username,
        supportContact,
    });
    const fallbackText = `Xin chào ${name}.\nBấm nút bên dưới để mở cửa hàng.`;
    const text = `${welcomeText || fallbackText}\n\n${notificationStatusLine(user)}`;

    await ctx.reply(text, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [
                    openShopButton('Mở cửa hàng', {
                        botUsername: ctx.botInfo?.username,
                        payload: ctx.startPayload,
                    }),
                ],
                [manageNotificationsButton()],
            ],
        },
    });
}

module.exports = (bot) => {
    bot.start(handleStart);
};
module.exports.handleStart = handleStart;
```

- [ ] **Step 4: Run bot tests**

Run:

```bash
node --test tests/bot/start-deep-link.test.js tests/bot/notificationPreferences.test.js tests/bot/fallback.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add src/commands/start.js tests/bot/start-deep-link.test.js
git commit -m "fix: keep start responsive with notification status"
```

## Task 4: Filter Marketing Telegram Sends

**Files:**
- Modify: `src/services/notificationService.js`
- Create: `tests/services/notificationMarketingPreference.test.js`

- [ ] **Step 1: Write failing notification policy tests**

Create `tests/services/notificationMarketingPreference.test.js`:

```js
const assert = require('node:assert');
const test = require('node:test');
const db = require('../../src/database');
const { NotificationService, sendDelivery } = require('../../src/services/notificationService');
const telegramApiClient = require('../../src/services/telegramApiClient');

function seedUser({ disabled = false } = {}) {
  const suffix = `${Date.now()}_${Math.floor(Math.random() * 100000)}`;
  const telegramId = 872_100_000 + Math.floor(Math.random() * 100000);
  const notificationPrefs = disabled ? JSON.stringify({ telegramMarketingEnabled: false }) : '{}';
  db.prepare(`
    INSERT INTO users (telegram_id, username, full_name, notification_prefs)
    VALUES (?, ?, ?, ?)
  `).run(telegramId, `marketing_${suffix}`, `Marketing ${suffix}`, notificationPrefs);
  return { telegramId, suffix };
}

function cleanupUser(telegramId) {
  db.prepare('DELETE FROM announcements WHERE title LIKE ?').run(`Marketing pref ${telegramId}%`);
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(telegramId);
  db.prepare('DELETE FROM users WHERE telegram_id = ?').run(telegramId);
}

test('broadcast skips Telegram for disabled marketing user but still creates web notification', async (t) => {
  const disabled = seedUser({ disabled: true });
  const enabled = seedUser({ disabled: false });
  const calls = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    calls.push({ method, payload });
    return { message_id: calls.length };
  });
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest(null);
    cleanupUser(disabled.telegramId);
    cleanupUser(enabled.telegramId);
  });

  const service = new NotificationService({ telegram: {} });
  const result = await service.broadcast(`Marketing pref ${disabled.telegramId}`, '<b>Sale</b>', 'all', 1);

  assert.ok(calls.some((call) => call.payload.chat_id === enabled.telegramId));
  assert.ok(!calls.some((call) => call.payload.chat_id === disabled.telegramId));
  assert.ok(result.skippedByPreference >= 1);
  assert.strictEqual(result.failed, 0);

  const notification = db.prepare('SELECT body FROM notifications WHERE user_id = ? ORDER BY id DESC').get(disabled.telegramId);
  assert.strictEqual(notification.body, '<b>Sale</b>');
});

test('notify marketing telegram channel skips disabled user without creating web notification', async (t) => {
  const disabled = seedUser({ disabled: true });
  const calls = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    calls.push({ method, payload });
    return { message_id: calls.length };
  });
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest(null);
    cleanupUser(disabled.telegramId);
  });

  const service = new NotificationService({ telegram: {} });
  const result = await service.notify(
    disabled.telegramId,
    'stock_alert',
    'Sản phẩm có hàng',
    '<b>Có hàng</b>',
    {},
    'telegram',
  );

  assert.deepStrictEqual(calls, []);
  assert.strictEqual(result.sentTelegram, 0);
  assert.strictEqual(result.sentWeb, 0);
  assert.strictEqual(result.skippedByPreference, 1);
});

test('sendDelivery still sends order keys when user disabled marketing notifications', async (t) => {
  const disabled = seedUser({ disabled: true });
  const calls = [];
  telegramApiClient.setTelegramRequestForTest(async (method, payload) => {
    calls.push({ method, payload });
    return { message_id: calls.length };
  });
  t.after(() => {
    telegramApiClient.setTelegramRequestForTest(null);
    cleanupUser(disabled.telegramId);
  });

  await sendDelivery(
    { telegram: { async deleteMessage() {} } },
    {
      id: 123456,
      user_id: disabled.telegramId,
      product_id: 0,
      product_name: 'Sản phẩm test',
      quantity: 1,
    },
    ['email@example.com|pass'],
    { usageInstructions: '' },
  );

  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].method, 'sendMessage');
  assert.strictEqual(calls[0].payload.chat_id, disabled.telegramId);
});
```

- [ ] **Step 2: Run policy tests and verify they fail**

Run:

```bash
node --test tests/services/notificationMarketingPreference.test.js
```

Expected: FAIL because `NotificationService` still sends marketing Telegram to disabled users and does not return `skippedByPreference`.

- [ ] **Step 3: Implement marketing preference filtering in `notificationService`**

Modify the top of `src/services/notificationService.js`:

```js
const userNotificationPreferenceService = require('./userNotificationPreferenceService');
```

Add helper functions near `sleep`:

```js
const MARKETING_NOTIFICATION_TYPES = new Set([
  'announcement',
  'stock_alert',
  'product_new',
  'product_updated',
  'discount',
]);

function shouldRespectTelegramMarketingPreference(type, options = {}) {
  if (options.respectTelegramMarketingPreference === true) return true;
  if (options.respectTelegramMarketingPreference === false) return false;
  return MARKETING_NOTIFICATION_TYPES.has(type);
}
```

Update `notify()` body to initialize and apply skip:

```js
  async notify(userId, type, title, body, data = {}, channel = 'all', webBody = undefined, extra = {}) {
    let sentTelegram = 0;
    let sentWeb = 0;
    let skippedByPreference = 0;
    const effectiveWeb = webBody === undefined ? body : webBody;
    const { respectTelegramMarketingPreference, ...sendExtra } = extra || {};
    const shouldSendTelegram = (channel === 'all' || channel === 'telegram') && body;
    const telegramAllowed = !shouldSendTelegram
      || !shouldRespectTelegramMarketingPreference(type, { respectTelegramMarketingPreference })
      || userNotificationPreferenceService.isTelegramMarketingEnabled(userId);

    if (shouldSendTelegram && telegramAllowed) {
      try {
        await telegramApiClient.sendMessage(userId, body, { parse_mode: 'HTML', ...sendExtra });
        sentTelegram = 1;
      } catch (err) {
        console.error(`❌ Notify telegram ${userId}:`, err.message);
      }
    } else if (shouldSendTelegram && !telegramAllowed) {
      skippedByPreference = 1;
    }

    if ((channel === 'all' || channel === 'web') && effectiveWeb) {
      db.prepare(`
        INSERT INTO notifications (user_id, type, title, body, data, channel, sent_telegram, sent_web)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
      `).run(userId, type, title, effectiveWeb, JSON.stringify(data), channel, sentTelegram);
      sentWeb = 1;
    }

    return { sentTelegram, sentWeb, skippedByPreference };
  }
```

Update `notifyNewProduct()` and `notifyProductUpdated()` broadcast calls to keep types specific:

```js
    return this.broadcast('Sản phẩm mới', botBody, 'all', adminId, webBody, { notificationType: 'product_new' });
```

```js
    return this.broadcast('Cập nhật sản phẩm', botBody, 'all', adminId, webBody, { notificationType: 'product_updated' });
```

Update `broadcast()` result counters, user query, and per-user Telegram block:

```js
    const notificationType = options.notificationType || 'announcement';
```

Replace the user query with:

```js
    const users = db.prepare('SELECT telegram_id, username, notification_prefs FROM users').all();
```

Add after `let failed = 0;`:

```js
    let skippedByPreference = 0;
```

Replace the Telegram block inside the user loop with:

```js
      if ((target === 'all' || target === 'telegram') && body) {
        if (!userNotificationPreferenceService.isTelegramMarketingEnabled(user)) {
          skippedByPreference++;
        } else {
          try {
            if (telegramImageUrl) {
              await this.bot.telegram.sendPhoto(user.telegram_id, telegramImageUrl, { caption: telegramBody, parse_mode: 'HTML' });
            } else {
              await telegramApiClient.sendMessage(user.telegram_id, telegramBody, { parse_mode: 'HTML' });
            }
            sent++;
          } catch (err) {
            failed++;
            const msg = (err && (err.description || err.message)) || String(err);
            errors.push({
              userId: user.telegram_id,
              username: user.username || null,
              error: String(msg).slice(0, 300),
              at: new Date().toISOString(),
            });
          }
          if ((sent + failed) % 25 === 0) await sleep(1000);
        }
      }
```

Update web insert type:

```js
          INSERT INTO notifications (user_id, type, title, body, channel)
          VALUES (?, ?, ?, ?, ?)
        `).run(user.telegram_id, notificationType, title, effectiveWeb, target);
```

Update return:

```js
    return { announcementId, sent, failed, skippedByPreference, total: users.length, errors };
```

- [ ] **Step 4: Run notification tests**

Run:

```bash
node --test tests/services/userNotificationPreferenceService.test.js tests/services/notificationMarketingPreference.test.js tests/services/announcementImageBroadcast.test.js tests/services/stockReplenishedVariantNotification.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add src/services/notificationService.js tests/services/notificationMarketingPreference.test.js
git commit -m "feat: respect telegram marketing notification preferences"
```

## Task 5: Final Verification

**Files:**
- No new code expected.
- May modify tests only if verification exposes a real issue in touched code.

- [ ] **Step 1: Run bot and notification test set**

Run:

```bash
node --test \
  tests/services/userNotificationPreferenceService.test.js \
  tests/bot/notificationPreferences.test.js \
  tests/bot/start-deep-link.test.js \
  tests/bot/fallback.test.js \
  tests/services/notificationMarketingPreference.test.js \
  tests/services/announcementImageBroadcast.test.js \
  tests/services/stockReplenishedVariantNotification.test.js
```

Expected: PASS.

- [ ] **Step 2: Run message template smoke**

Run:

```bash
node scripts/verify-message-templates.js
```

Expected: PASS; no missing template variables.

- [ ] **Step 3: Run purge dry-run**

Run:

```bash
node scripts/purge-test-data.js
```

Expected output includes zero counts for target prompt/test fixtures, or lists only data that must be removed by the mandated purge flow before final handoff.

- [ ] **Step 4: Inspect staged/uncommitted diff**

Run:

```bash
git status --short src/services/userNotificationPreferenceService.js src/commands/notificationPreferences.js src/bot/index.js src/commands/start.js src/services/notificationService.js tests/services/userNotificationPreferenceService.test.js tests/bot/notificationPreferences.test.js tests/bot/start-deep-link.test.js tests/services/notificationMarketingPreference.test.js docs/superpowers/plans/2026-07-03-telegram-notification-toggle.md
git diff -- src/services/userNotificationPreferenceService.js src/commands/notificationPreferences.js src/bot/index.js src/commands/start.js src/services/notificationService.js tests/services/userNotificationPreferenceService.test.js tests/bot/notificationPreferences.test.js tests/bot/start-deep-link.test.js tests/services/notificationMarketingPreference.test.js
```

Expected: only files in this plan changed. No `data/shop.db`, uploads, logs, backups, or unrelated dirty files should be staged.

- [ ] **Step 5: Commit final plan file if not already committed**

Run:

```bash
git add docs/superpowers/plans/2026-07-03-telegram-notification-toggle.md
git commit -m "docs: plan telegram notification toggle"
```

Expected: commit contains only the plan file.
