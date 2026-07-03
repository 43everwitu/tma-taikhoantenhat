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

test('default export registers thongbao command and notify_pref callback', () => {
  const commands = [];
  const actions = [];
  const bot = {
    command(name, handler) {
      commands.push({ name, handler });
    },
    action(pattern, handler) {
      actions.push({ pattern, handler });
    },
  };

  require('../../src/commands/notificationPreferences')(bot);

  assert.deepStrictEqual(commands.map((entry) => entry.name), ['thongbao']);
  assert.strictEqual(actions.length, 1);
  assert.ok(actions[0].pattern instanceof RegExp);
  assert.ok(actions[0].pattern.test(`${CALLBACK_PREFIX}:show`));
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
