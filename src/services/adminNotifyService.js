const db = require('../database');
const config = require('../config');

const CACHE_TTL_MS = 30_000;
const KEY_PREFIX = 'notify_admin_';

const VALID_EVENTS = ['new_order', 'payment_short', 'no_stock', 'delivered', 'low_stock'];

let cache = null;
let cacheAt = 0;

function loadToggles() {
  if (cache && Date.now() - cacheAt < CACHE_TTL_MS) return cache;
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE ?`).all(`${KEY_PREFIX}%`);
  cache = {};
  for (const r of rows) {
    cache[r.key.slice(KEY_PREFIX.length)] = r.value === 'true' || r.value === '1';
  }
  cacheAt = Date.now();
  return cache;
}

let bot = null;
function init(b) { bot = b; }

function isEnabled(eventType) {
  const toggles = loadToggles();
  // Default ON for delivered + low_stock if no explicit setting yet
  if (toggles[eventType] === undefined) {
    return eventType === 'delivered' || eventType === 'low_stock';
  }
  return toggles[eventType];
}

/**
 * Send an admin event to ADMIN_ID if its toggle is on. If toggle is off and
 * BOT_NOISE_CHAT_ID is set, forward to the noise channel for audit. Otherwise
 * drop silently.
 */
async function notify(eventType, message, opts = {}) {
  if (!VALID_EVENTS.includes(eventType)) {
    console.warn(`adminNotifyService: unknown eventType '${eventType}'`);
  }
  if (!bot) {
    console.error('adminNotifyService.notify called before init()');
    return;
  }

  const targetId = isEnabled(eventType) ? config.ADMIN_ID : (config.BOT_NOISE_CHAT_ID || null);
  if (!targetId) return;

  try {
    await bot.telegram.sendMessage(targetId, message, opts);
  } catch (err) {
    console.error(`adminNotifyService notify [${eventType}] -> ${targetId}:`, err.message);
  }
}

function invalidateCache() {
  cache = null;
  cacheAt = 0;
}

module.exports = { init, notify, invalidateCache, VALID_EVENTS };
