const db = require('../database');

const STATUSES = ['active', 'shadow_banned', 'banned'];

function normalizeStatus(status) {
  const value = status || 'active';
  if (!STATUSES.includes(value)) {
    const err = new Error('INVALID_STATUS');
    err.code = 'INVALID_STATUS';
    throw err;
  }
  return value;
}

function shape(row) {
  if (!row) return null;
  return {
    telegramId: row.telegram_id,
    accountStatus: normalizeStatus(row.account_status),
    banReason: row.ban_reason || null,
    bannedAt: row.banned_at || null,
    bannedBy: row.banned_by ?? null,
  };
}

function getStatus(telegramId) {
  const row = db.prepare(`
    SELECT telegram_id, account_status, ban_reason, banned_at, banned_by
    FROM users
    WHERE telegram_id = ?
  `).get(telegramId);
  return shape(row);
}

function isBanned(telegramId) {
  return getStatus(telegramId)?.accountStatus === 'banned';
}

function isShadowBanned(telegramId) {
  return getStatus(telegramId)?.accountStatus === 'shadow_banned';
}

function setStatus(telegramId, status, { reason = '', adminId = null } = {}) {
  const nextStatus = normalizeStatus(status);
  const existing = getStatus(telegramId);
  if (!existing) return null;

  if (nextStatus === 'active') {
    db.prepare(`
      UPDATE users
      SET account_status = 'active',
          ban_reason = NULL,
          banned_at = NULL,
          banned_by = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = ?
    `).run(telegramId);
  } else {
    db.prepare(`
      UPDATE users
      SET account_status = ?,
          ban_reason = ?,
          banned_at = CURRENT_TIMESTAMP,
          banned_by = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE telegram_id = ?
    `).run(nextStatus, String(reason || '').trim() || null, adminId, telegramId);
  }

  return getStatus(telegramId);
}

module.exports = {
  STATUSES,
  normalizeStatus,
  getStatus,
  isBanned,
  isShadowBanned,
  setStatus,
};
