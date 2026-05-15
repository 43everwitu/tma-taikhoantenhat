const db = require('../database');
const config = require('../config');

const CACHE_TTL_MS = 30_000;
const KEY_PREFIX = 'notify_admin_';

const VALID_EVENTS = ['new_order', 'payment_short', 'no_stock', 'delivered', 'low_stock', 'backorder_paid'];

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

function loadLowStockTarget() {
  if (lowStockTargetCache !== null && Date.now() - lowStockTargetCacheAt < CACHE_TTL_MS) {
    return lowStockTargetCache;
  }
  const chatRow = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_chat_id'").get();
  const threadRow = db.prepare("SELECT value FROM settings WHERE key = 'low_stock_thread_id'").get();
  const chatId = chatRow && chatRow.value ? chatRow.value : null;
  const threadId = threadRow && threadRow.value ? parseInt(threadRow.value, 10) : null;
  lowStockTargetCache = {
    chatId: chatId || null,
    threadId: Number.isFinite(threadId) && threadId > 0 ? threadId : null,
  };
  lowStockTargetCacheAt = Date.now();
  return lowStockTargetCache;
}

let bot = null;
function init(b) { bot = b; }

function isEnabled(eventType) {
  const toggles = loadToggles();
  if (toggles[eventType] === undefined) {
    return eventType === 'delivered' || eventType === 'low_stock' || eventType === 'backorder_paid';
  }
  return toggles[eventType];
}

/**
 * Resolve target chat for an event. low_stock routes via settings; everything
 * else uses ADMIN_ID (with BOT_NOISE_CHAT_ID as muted fallback).
 */
function resolveTarget(eventType) {
  if (eventType === 'low_stock') {
    const t = loadLowStockTarget();
    if (t.chatId) return { chatId: t.chatId, threadId: t.threadId };
  }
  return { chatId: isEnabled(eventType) ? config.ADMIN_ID : (config.BOT_NOISE_CHAT_ID || null), threadId: null };
}

async function notify(eventType, message, opts = {}) {
  if (!VALID_EVENTS.includes(eventType)) {
    console.warn(`adminNotifyService: unknown eventType '${eventType}'`);
  }
  if (!bot) {
    console.error('adminNotifyService.notify called before init()');
    return;
  }

  // For low_stock with explicit chat override, send regardless of toggle.
  // The chat-id override IS the routing decision; the toggle is for DM-only mute.
  if (eventType !== 'low_stock' && !isEnabled(eventType) && !config.BOT_NOISE_CHAT_ID) return;

  const { chatId, threadId } = resolveTarget(eventType);
  if (!chatId) return;

  const finalOpts = { ...opts };
  if (threadId) finalOpts.message_thread_id = threadId;

  try {
    await bot.telegram.sendMessage(chatId, message, finalOpts);
  } catch (err) {
    console.error(`adminNotifyService notify [${eventType}] -> ${chatId}:`, err.message);
  }
}

function invalidateCache() {
  toggleCache = null;
  toggleCacheAt = 0;
  lowStockTargetCache = null;
  lowStockTargetCacheAt = 0;
}

module.exports = { init, notify, invalidateCache, VALID_EVENTS };
