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
