const db = require('../database');
const config = require('../config');
const telegramApiClient = require('./telegramApiClient');

const CACHE_TTL_MS = 30_000;
const KEY_PREFIX = 'notify_admin_';

const VALID_EVENTS = [
  'new_order',
  'payment_short',
  'payment_review',
  'no_stock',
  'delivered',
  'low_stock',
  'backorder_paid',
];

let toggleCache = null;
let toggleCacheAt = 0;
let lowStockTargetCache = null;
let lowStockTargetCacheAt = 0;

function loadToggles() {
  if (toggleCache && Date.now() - toggleCacheAt < CACHE_TTL_MS) return toggleCache;
  const rows = db.prepare(`SELECT key, value FROM settings WHERE key LIKE ?`).all(`${KEY_PREFIX}%`);
  toggleCache = {};
  for (const r of rows) {
    toggleCache[r.key.slice(KEY_PREFIX.length)] = r.value === 'true' || r.value === '1';
  }
  toggleCacheAt = Date.now();
  return toggleCache;
}

const DEFAULT_LOW_STOCK_CHAT_ID = '-1003865156744';
const DEFAULT_LOW_STOCK_THREAD_ID = 2;

function loadLowStockTarget() {
  if (lowStockTargetCache !== null && Date.now() - lowStockTargetCacheAt < CACHE_TTL_MS) {
    return lowStockTargetCache;
  }
  const chatRow = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_chat_id'").get();
  const threadRow = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_thread_id'").get();
  const chatRaw = (chatRow?.value ?? '').trim();
  const threadRaw = (threadRow?.value ?? '').trim();
  const chatId = chatRaw || DEFAULT_LOW_STOCK_CHAT_ID;
  const parsedThread = threadRaw !== '' ? parseInt(threadRaw, 10) : NaN;
  const threadId = Number.isFinite(parsedThread) && parsedThread > 0
    ? parsedThread
    : DEFAULT_LOW_STOCK_THREAD_ID;
  lowStockTargetCache = { chatId, threadId };
  lowStockTargetCacheAt = Date.now();
  return lowStockTargetCache;
}

let bot = null;
function init(b) { bot = b; }

function isEnabled(eventType) {
  if (eventType === 'payment_review') return true;
  const toggles = loadToggles();
  if (toggles[eventType] === undefined) {
    return eventType === 'delivered'
      || eventType === 'low_stock'
      || eventType === 'backorder_paid';
  }
  return toggles[eventType];
}

/**
 * Resolve target chat for an event. low_stock always uses settings
 * (low_stock_chat_id / low_stock_thread_id), never ADMIN_ID.
 */
function resolveTarget(eventType) {
  if (eventType === 'low_stock') {
    const t = loadLowStockTarget();
    return { chatId: t.chatId, threadId: t.threadId };
  }
  return { chatId: isEnabled(eventType) ? config.ADMIN_ID : (config.BOT_NOISE_CHAT_ID || null), threadId: null };
}

async function notify(eventType, message, opts = {}) {
  if (!VALID_EVENTS.includes(eventType)) {
    console.warn(`adminNotifyService: unknown eventType '${eventType}'`);
  }
  if (!bot) {
    console.error('adminNotifyService.notify called before init()');
    return false;
  }

  // low_stock routes to low_stock_chat_id (group), not ADMIN_ID; always send.
  // notify_admin_low_stock only applies if we ever route low_stock to DM again.
  if (eventType !== 'low_stock' && !isEnabled(eventType) && !config.BOT_NOISE_CHAT_ID) return false;

  const { chatId, threadId } = resolveTarget(eventType);
  if (!chatId) return false;

  const finalOpts = { ...opts };
  if (threadId) finalOpts.message_thread_id = threadId;

  try {
    await telegramApiClient.sendMessage(chatId, message, finalOpts);
    return true;
  } catch (err) {
    console.error(`adminNotifyService notify [${eventType}] -> ${chatId}:`, err.message);
    return false;
  }
}

function invalidateCache() {
  toggleCache = null;
  toggleCacheAt = 0;
  lowStockTargetCache = null;
  lowStockTargetCacheAt = 0;
}

module.exports = { init, notify, invalidateCache, VALID_EVENTS };
