const db = require('../database');

function normalize(code) {
  return String(code || '').trim().toUpperCase();
}

function findByCode(code) {
  return db.prepare(`SELECT * FROM discount_codes WHERE UPPER(code) = ? AND is_active = 1`).get(normalize(code)) || null;
}

function isUsableNow(code) {
  const now = new Date();
  if (code.starts_at && new Date(code.starts_at) > now) return false;
  if (code.ends_at && new Date(code.ends_at) < now) return false;
  if (code.usage_limit != null && code.used_count >= code.usage_limit) return false;
  return true;
}

function findActiveGlobal() {
  const rows = db.prepare(`
    SELECT * FROM discount_codes
    WHERE is_global = 1 AND is_active = 1
    ORDER BY updated_at DESC, id DESC
  `).all();
  return rows.find(isUsableNow) || null;
}

function listAll() {
  return db.prepare(`SELECT * FROM discount_codes ORDER BY created_at DESC`).all();
}

function getById(id) {
  return db.prepare(`SELECT * FROM discount_codes WHERE id = ?`).get(id) || null;
}

function create(fields) {
  return db.transaction(() => {
    const isGlobal = fields.isGlobal === true ? 1 : 0;
    if (isGlobal) db.prepare(`UPDATE discount_codes SET is_global = 0 WHERE is_global = 1`).run();
    const r = db.prepare(`
      INSERT INTO discount_codes
        (code, type, amount, max_discount, min_order, usage_limit, per_user_limit, starts_at, ends_at, is_active, is_global, notify_title, app_meta_mode, app_meta_text, app_message, bot_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      normalize(fields.code),
      fields.type,
      fields.amount,
      fields.maxDiscount ?? null,
      fields.minOrder ?? 0,
      fields.usageLimit ?? null,
      fields.perUserLimit ?? null,
      fields.startsAt ?? null,
      fields.endsAt ?? null,
      fields.isActive === false ? 0 : 1,
      isGlobal,
      fields.notifyTitle ?? null,
      fields.appMetaMode ?? 'auto',
      fields.appMetaText ?? null,
      fields.appMessage ?? null,
      fields.botMessage ?? null,
    );
    return { id: r.lastInsertRowid };
  })();
}

function update(id, fields) {
  const map = {
    code: 'code', type: 'type', amount: 'amount',
    maxDiscount: 'max_discount', minOrder: 'min_order',
    usageLimit: 'usage_limit', perUserLimit: 'per_user_limit',
    startsAt: 'starts_at', endsAt: 'ends_at', isActive: 'is_active',
    isGlobal: 'is_global', notifyTitle: 'notify_title',
    appMetaMode: 'app_meta_mode', appMetaText: 'app_meta_text',
    appMessage: 'app_message', botMessage: 'bot_message',
  };
  const sets = []; const params = [];
  for (const [js, sql] of Object.entries(map)) {
    if (fields[js] === undefined) continue;
    sets.push(`${sql} = ?`);
    let v = fields[js];
    if (js === 'code') v = normalize(v);
    if (typeof v === 'boolean') v = v ? 1 : 0;
    params.push(v);
  }
  if (sets.length === 0) return { changes: 0 };
  sets.push(`updated_at = CURRENT_TIMESTAMP`);
  params.push(id);
  return db.transaction(() => {
    if (fields.isGlobal === true) {
      db.prepare(`UPDATE discount_codes SET is_global = 0 WHERE is_global = 1 AND id != ?`).run(id);
    }
    const r = db.prepare(`UPDATE discount_codes SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return { changes: r.changes };
  })();
}

function remove(id) {
  const r = db.prepare(`DELETE FROM discount_codes WHERE id = ?`).run(id);
  return { changes: r.changes };
}

function computeDiscount(code, subtotal) {
  let discount = 0;
  if (code.type === 'percent') {
    discount = Math.floor(subtotal * code.amount / 100);
    if (code.max_discount != null) discount = Math.min(discount, code.max_discount);
  } else {
    discount = code.amount;
  }
  if (discount > subtotal) discount = subtotal;
  return discount;
}

function validateCodeRecord(code, subtotal, userId = null) {
  const now = new Date();
  if (code.starts_at && new Date(code.starts_at) > now) return { ok: false, reason: 'Mã chưa có hiệu lực' };
  if (code.ends_at && new Date(code.ends_at) < now) return { ok: false, reason: 'Mã đã hết hạn' };
  if (code.usage_limit != null && code.used_count >= code.usage_limit) return { ok: false, reason: 'Mã đã hết lượt sử dụng' };
  if (code.min_order && subtotal < code.min_order) {
    return { ok: false, reason: `Đơn tối thiểu ${code.min_order.toLocaleString('vi-VN')}đ để dùng mã này` };
  }
  if (userId && code.per_user_limit != null) {
    const used = db.prepare(`
      SELECT COUNT(*) AS c FROM orders WHERE user_id = ? AND discount_code_id = ? AND status != 'cancelled' AND status != 'expired'
    `).get(userId, code.id).c;
    if (used >= code.per_user_limit) return { ok: false, reason: 'Bạn đã dùng mã này tối đa số lần cho phép' };
  }

  const discount = computeDiscount(code, subtotal);
  if (discount <= 0) return { ok: false, reason: 'Mã không áp dụng được cho đơn này' };

  return { ok: true, discount, code };
}

// Validate + compute discount for a given subtotal. Returns { ok, discount, reason, code }.
function validateForOrder(rawCode, subtotal, userId = null) {
  const code = findByCode(rawCode);
  if (!code) return { ok: false, reason: 'Mã giảm giá không tồn tại hoặc đã tắt' };
  return validateCodeRecord(code, subtotal, userId);
}

function resolveBestForOrder(rawCode, subtotal, userId = null) {
  const candidates = [];
  const global = findActiveGlobal();
  if (global) {
    const r = validateCodeRecord(global, subtotal, userId);
    if (r.ok) candidates.push({ ...r, source: 'global' });
  }
  if (rawCode) {
    const manual = validateForOrder(rawCode, subtotal, userId);
    if (manual.ok) candidates.push({ ...manual, source: manual.code.is_global ? 'global' : 'manual' });
    else if (candidates.length === 0) return manual;
  }
  if (candidates.length === 0) return { ok: true, discount: 0, code: null, source: null };
  candidates.sort((a, b) => b.discount - a.discount || (a.source === 'manual' ? -1 : 1));
  return candidates[0];
}

function incrementUsage(codeId) {
  db.prepare(`UPDATE discount_codes SET used_count = used_count + 1 WHERE id = ?`).run(codeId);
}

module.exports = {
  findByCode, findActiveGlobal, listAll, getById, create, update, remove,
  validateForOrder, resolveBestForOrder, computeDiscount, incrementUsage, normalize,
};
