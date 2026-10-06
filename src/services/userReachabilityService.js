const db = require('../database');

// Telegram error descriptions that mean the chat can never be reached again
// until the user acts (unblocks the bot, reactivates their account) — safe
// to stop retrying on every broadcast. Transient errors (timeouts, 429s,
// temporary network issues) are NOT matched here on purpose.
const PERMANENT_FAILURE_PATTERNS = [
  /bot was blocked by the user/i,
  /user is deactivated/i,
  /chat not found/i,
];

function isPermanentFailure(err) {
  const msg = String(err?.message || err?.description || '');
  return PERMANENT_FAILURE_PATTERNS.some((re) => re.test(msg));
}

function markUnreachable(telegramId) {
  db.prepare(`
    UPDATE users SET telegram_unreachable_at = CURRENT_TIMESTAMP
    WHERE telegram_id = ? AND telegram_unreachable_at IS NULL
  `).run(telegramId);
}

function markReachable(telegramId) {
  db.prepare(`
    UPDATE users SET telegram_unreachable_at = NULL
    WHERE telegram_id = ? AND telegram_unreachable_at IS NOT NULL
  `).run(telegramId);
}

module.exports = { isPermanentFailure, markUnreachable, markReachable };
