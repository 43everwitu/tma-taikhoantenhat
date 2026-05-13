const db = require('../database');

function normalize(code) {
  return String(code || '').trim().toUpperCase();
}

function findByCode(code) {
  return db.prepare(`SELECT * FROM discount_codes WHERE UPPER(code) = ? AND is_active = 1`).get(normalize(code)) || null;
}

function listAll() {
  return db.prepare(`SELECT * FROM discount_codes ORDER BY created_at DESC`).all();
}

function getById(id) {
  return db.prepare(`SELECT * FROM discount_codes WHERE id = ?`).get(id) || null;
}

function create(fields) {
  const r = db.prepare(`
    INSERT INTO discount_codes
      (code, type, amount, max_discount, min_order, usage_limit, per_user_limit, starts_at, ends_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  );
  return { id: r.lastInsertRowid };
}

function update(id, fields) {
  const map = {
    code: 'code', type: 'type', amount: 'amount',
    maxDiscount: 'max_discount', minOrder: 'min_order',
    usageLimit: 'usage_limit', perUserLimit: 'per_user_limit',
    startsAt: 'starts_at', endsAt: 'ends_at', isActive: 'is_active',
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
  const r = db.prepare(`UPDATE discount_codes SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return { changes: r.changes };
}

function remove(id) {
  const r = db.prepare(`DELETE FROM discount_codes WHERE id = ?`).run(id);
  return { changes: r.changes };
}

// Validate + compute discount for a given subtotal. Returns { ok, discount, reason, code }.
function validateForOrder(rawCode, subtotal, userId = null) {
  const code = findByCode(rawCode);
  if (!code) return { ok: false, reason: 'Mã giảm giá không tồn tại hoặc đã tắt' };
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

  let discount = 0;
  if (code.type === 'percent') {
    discount = Math.floor(subtotal * code.amount / 100);
    if (code.max_discount != null) discount = Math.min(discount, code.max_discount);
  } else {
    discount = code.amount;
  }
  if (discount > subtotal) discount = subtotal;
  if (discount <= 0) return { ok: false, reason: 'Mã không áp dụng được cho đơn này' };

  return { ok: true, discount, code };
}

function incrementUsage(codeId) {
  db.prepare(`UPDATE discount_codes SET used_count = used_count + 1 WHERE id = ?`).run(codeId);
}

module.exports = {
  findByCode, listAll, getById, create, update, remove,
  validateForOrder, incrementUsage, normalize,
};
