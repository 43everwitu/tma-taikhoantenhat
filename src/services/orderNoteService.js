const db = require('../database');

const CONTENT_MAX_LENGTH = 2000;

function normalizeContent(content) {
  const value = String(content ?? '').trim();
  if (!value) {
    const err = new Error('EMPTY_NOTE');
    err.status = 400;
    throw err;
  }
  if (value.length > CONTENT_MAX_LENGTH) {
    const err = new Error('NOTE_TOO_LONG');
    err.status = 400;
    throw err;
  }
  return value;
}

function shapeNote(row) {
  return {
    id: String(row.id),
    content: row.content,
    createdByAdminId: row.created_by_admin_id == null ? null : String(row.created_by_admin_id),
    createdByAdminName: row.created_by_admin_name ?? null,
    createdByAdminUsername: row.created_by_admin_username ?? null,
    updatedByAdminId: row.updated_by_admin_id == null ? null : String(row.updated_by_admin_id),
    updatedByAdminName: row.updated_by_admin_name ?? null,
    updatedByAdminUsername: row.updated_by_admin_username ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function previewContent(content) {
  const preview = String(content ?? '').replace(/\s+/g, ' ').trim();
  return preview.length > 120 ? `${preview.slice(0, 120)}...` : preview;
}

const selectNoteSql = `
  SELECT
    n.*,
    created_admin.display_name AS created_by_admin_name,
    created_admin.username AS created_by_admin_username,
    updated_admin.display_name AS updated_by_admin_name,
    updated_admin.username AS updated_by_admin_username
  FROM order_notes n
  LEFT JOIN admins created_admin ON created_admin.id = n.created_by_admin_id
  LEFT JOIN admins updated_admin ON updated_admin.id = n.updated_by_admin_id
`;

function listForOrder(orderId) {
  return db.prepare(`
    ${selectNoteSql}
    WHERE n.order_id = ?
    ORDER BY n.created_at DESC, n.id DESC
  `).all(orderId).map(shapeNote);
}

function getByIdForOrder(orderId, noteId) {
  const row = db.prepare(`
    ${selectNoteSql}
    WHERE n.order_id = ? AND n.id = ?
  `).get(orderId, noteId);
  return row ? shapeNote(row) : null;
}

function create(orderId, adminId, content) {
  const value = normalizeContent(content);
  const result = db.prepare(`
    INSERT INTO order_notes (order_id, created_by_admin_id, updated_by_admin_id, content)
    VALUES (?, ?, ?, ?)
  `).run(orderId, adminId, adminId, value);
  return getByIdForOrder(orderId, result.lastInsertRowid);
}

function update(orderId, noteId, adminId, content) {
  const value = normalizeContent(content);
  const result = db.prepare(`
    UPDATE order_notes
    SET content = ?, updated_by_admin_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE order_id = ? AND id = ?
  `).run(value, adminId, orderId, noteId);
  if (result.changes === 0) return null;
  return getByIdForOrder(orderId, noteId);
}

function deleteNote(orderId, noteId) {
  const note = getByIdForOrder(orderId, noteId);
  if (!note) return null;
  db.prepare('DELETE FROM order_notes WHERE order_id = ? AND id = ?').run(orderId, noteId);
  return note;
}

module.exports = {
  CONTENT_MAX_LENGTH,
  normalizeContent,
  shapeNote,
  previewContent,
  listForOrder,
  getByIdForOrder,
  create,
  update,
  delete: deleteNote,
};
