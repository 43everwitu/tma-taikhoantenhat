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
