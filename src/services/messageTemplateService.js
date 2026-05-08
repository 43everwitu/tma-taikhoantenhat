const db = require('../database');

const CACHE_TTL_MS = 30_000;

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Variables whose values are already HTML-safe — pre-formatted by callers.
// Everything NOT in this set is escaped at substitution time.
const TRUSTED_VARS = new Set(['keysBlock', 'usageInstructions']);
let cache = { ts: 0, rows: null };

function loadAll() {
  if (cache.rows && Date.now() - cache.ts < CACHE_TTL_MS) return cache.rows;
  const rows = db.prepare('SELECT key, body, default_body, variables FROM message_templates').all();
  const map = {};
  for (const r of rows) {
    map[r.key] = {
      body: (r.body && r.body.trim()) || r.default_body,
      variables: JSON.parse(r.variables),
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

function get(key) {
  return loadAll()[key];
}

function list() {
  const rows = db.prepare(`
    SELECT key, channel, label, variables, body, default_body, updated_at
    FROM message_templates ORDER BY channel, key
  `).all();
  return rows.map((r) => ({ ...r, variables: JSON.parse(r.variables) }));
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

module.exports = { render, get, list, update, reset, invalidate, escapeHtml, TRUSTED_VARS };
