const { Router } = require('express');
const db = require('../../../database');

const router = Router();

// GET /admin/transactions?status=&from=&to=&page=1&limit=20
router.get('/', (req, res) => {
  const { status, from, to, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = '1=1';
  const params = [];

  if (status) { where += ' AND match_status = ?'; params.push(status); }
  if (from) { where += ' AND detected_at >= ?'; params.push(from); }
  if (to) { where += " AND detected_at <= ? || ' 23:59:59'"; params.push(to); }

  const rows = db.prepare(`
    SELECT t.*, o.user_id, o.status as order_status
    FROM transactions t
    LEFT JOIN orders o ON t.matched_order_id = o.id
    WHERE ${where}
    ORDER BY t.detected_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM transactions WHERE ${where}`).all(...params)[0].c;
  res.json({ success: true, data: rows, meta: { page: parseInt(page), limit: parseInt(limit), total } });
});

module.exports = router;
