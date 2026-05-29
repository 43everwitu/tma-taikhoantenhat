const db = require('../database');

const CACHE_TTL_MS = 30_000;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Variables whose values are already HTML-safe — pre-formatted by callers.
// Everything NOT in this set is escaped at substitution time.
const TRUSTED_VARS = new Set([
  'keysBlock',
  'usageInstructions',
  // Pre-built HTML wrapper for delivery usage instructions (📘 <b>Hướng dẫn:</b>
  // + richified body). Must pass through unescaped or the <b>/<a> tags render
  // as literal text in the delivery message.
  'usageBlock',
  // Spoiler/mention HTML built by callers (orderChannelService, paymentPoller).
  'userMention',
  'userSpoiler',
  'totalSpoiler',
  // Pre-rendered sub-blocks (multi-line HTML stitched up by callers).
  'inputBlock',
  'overpayBlock',
  'stockUrlBlock',
  'customerLine',
  'productLine',
  'waitMsg',
]);

// Templates the system needs to function. The toggle UI shows these as locked
// on; the toggle API rejects writes against them.
const CORE_TEMPLATE_KEYS = new Set([
  'delivery_keys',
  'payment_short',
  'payment_success',
  'topup_success',
  'bot.backorder_wait',
  'admin.payment_short',
  'admin.backorder_paid',
  'admin.no_stock',
  'group.order_card',
]);

let cache = { ts: 0, rows: null };

function loadAll() {
  if (cache.rows && Date.now() - cache.ts < CACHE_TTL_MS) return cache.rows;
  const rows = db.prepare('SELECT key, body, default_body, variables, is_enabled FROM message_templates').all();
  const map = {};
  for (const r of rows) {
    map[r.key] = {
      body: (r.body && r.body.trim()) || r.default_body,
      variables: JSON.parse(r.variables),
      enabled: !!r.is_enabled,
    };
  }
  cache = { ts: Date.now(), rows: map };
  return map;
}

function invalidate() {
  cache = { ts: 0, rows: null };
}

function render(key, vars = {}) {
  const all = loadAll();
  const tpl = all[key];
  if (!tpl) throw new Error(`Unknown message template: ${key}`);
  return tpl.body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name) => {
    const v = vars[name];
    if (v === undefined || v === null) return '';
    const str = String(v);
    return TRUSTED_VARS.has(name) ? str : escapeHtml(str);
  });
}

function isEnabled(key) {
  if (CORE_TEMPLATE_KEYS.has(key)) return true;
  const tpl = loadAll()[key];
  return !!tpl && tpl.enabled !== false;
}

// Returns the rendered body or null when the template is disabled. Lets call
// sites bail before calling Telegram / adminNotify when an admin has turned
// the message off.
function renderIfEnabled(key, vars = {}) {
  if (!isEnabled(key)) return null;
  return render(key, vars);
}

function get(key) {
  return loadAll()[key];
}

function list() {
  const rows = db.prepare(`
    SELECT key, channel, label, variables, body, default_body, is_enabled, updated_at
    FROM message_templates ORDER BY channel, key
  `).all();
  return rows.map((r) => ({
    ...r,
    variables: JSON.parse(r.variables),
    enabled: !!r.is_enabled,
    core: CORE_TEMPLATE_KEYS.has(r.key),
  }));
}

function update(key, body) {
  const result = db.prepare('UPDATE message_templates SET body = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(body, key);
  if (result.changes === 0) throw new Error(`Unknown template: ${key}`);
  invalidate();
}

function reset(key) {
  const result = db.prepare('UPDATE message_templates SET body = default_body, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(key);
  if (result.changes === 0) throw new Error(`Unknown template: ${key}`);
  invalidate();
}

function setEnabled(key, enabled) {
  if (CORE_TEMPLATE_KEYS.has(key)) {
    const err = new Error('CORE_TEMPLATE');
    err.code = 'CORE_TEMPLATE';
    throw err;
  }
  const result = db.prepare('UPDATE message_templates SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?').run(enabled ? 1 : 0, key);
  if (result.changes === 0) throw new Error(`Unknown template: ${key}`);
  invalidate();
}

module.exports = {
  render,
  renderIfEnabled,
  isEnabled,
  get,
  list,
  update,
  reset,
  setEnabled,
  invalidate,
  escapeHtml,
  TRUSTED_VARS,
  CORE_TEMPLATE_KEYS,
};
