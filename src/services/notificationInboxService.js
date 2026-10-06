const db = require('../database');

const TYPE_RE = /^[a-z_]{1,40}$/;
const MAX_TYPES = 8;

/** Parses `?type=a,b&unread=1` from GET /notifications/my. Unsafe type names are dropped. */
function parseInboxQuery(query = {}) {
  const types = String(query.type || '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => TYPE_RE.test(part))
    .slice(0, MAX_TYPES);
  const unreadOnly = query.unread === '1' || query.unread === 'true';
  return { types, unreadOnly };
}

/**
 * A user's newest notifications. Filtering by type in SQL matters: the home
 * screen only shows a few kinds, and an unfiltered LIMIT 50 let bulk rows push
 * older renewal reminders out of the window.
 */
function listForUser(userId, { types = [], unreadOnly = false, limit = 50 } = {}, database = db) {
  const where = ['user_id = ?'];
  const params = [userId];
  if (types.length > 0) {
    where.push(`type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  if (unreadOnly) where.push('is_read = 0');
  return database.prepare(`
    SELECT * FROM notifications
    WHERE ${where.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `).all(...params, limit);
}

module.exports = { listForUser, parseInboxQuery };
