const { Router } = require('express');
const db = require('../../../database');

const router = Router();

// GET /admin/users?search=&page=1&limit=20
router.get('/', (req, res) => {
  const { search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = '1=1';
  const params = [];

  if (search) {
    where += ' AND (full_name LIKE ? OR username LIKE ? OR CAST(telegram_id AS TEXT) LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const rows = db.prepare(`
    SELECT u.*, (SELECT COUNT(*) FROM orders o WHERE o.user_id = u.telegram_id AND o.status = 'delivered') as order_count
    FROM users u WHERE ${where}
    ORDER BY u.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  const total = db.prepare(`SELECT COUNT(*) as c FROM users WHERE ${where}`).all(...params)[0].c;
  res.json({ success: true, data: rows, meta: { page: parseInt(page), limit: parseInt(limit), total } });
});

// GET /admin/users/:telegramId
router.get('/:telegramId', (req, res) => {
  const telegramId = parseInt(req.params.telegramId);
  const user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId);
  if (!user) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });

  const orders = db.prepare(`
    SELECT o.*, p.name as product_name FROM orders o
    JOIN products p ON o.product_id = p.id
    WHERE o.user_id = ? ORDER BY o.created_at DESC LIMIT 50
  `).all(telegramId);

  const recentTopups = db.prepare(`
    SELECT id, amount, memo, status, requested_at, matched_at
    FROM wallet_topups
    WHERE user_id = ?
    ORDER BY requested_at DESC LIMIT 10
  `).all(telegramId);

  res.json({ success: true, data: { user, orders, recentTopups } });
});

module.exports = router;
