const { Router } = require('express');
const db = require('../../../database');
const { requirePermission } = require('../../middleware/auth');

const router = Router();

router.use(requirePermission('users.read'));

// GET /admin/users?search=&page=1&limit=20
router.get('/', (req, res) => {
  const parsedPage = Number.parseInt(req.query.page, 10);
  const parsedLimit = Number.parseInt(req.query.limit, 10);
  const page = Math.max(1, Number.isNaN(parsedPage) ? 1 : parsedPage);
  const limit = Math.max(1, Math.min(100, Number.isNaN(parsedLimit) ? 20 : parsedLimit));
  const offset = (page - 1) * limit;
  const search = String(req.query.search || '').trim();
  const like = `%${search}%`;

  const combinedUsersSql = `
    WITH combined_users AS (
      SELECT
        u.telegram_id,
        u.username,
        u.full_name,
        u.balance,
        u.created_at,
        (
          SELECT COUNT(*)
          FROM orders delivered_orders
          WHERE delivered_orders.user_id = u.telegram_id
            AND delivered_orders.status = 'delivered'
        ) AS order_count,
        0 AS is_virtual
      FROM users u

      UNION ALL

      SELECT
        o.user_id AS telegram_id,
        NULL AS username,
        'ID ' || o.user_id AS full_name,
        0 AS balance,
        MAX(o.created_at) AS created_at,
        COUNT(*) AS order_count,
        1 AS is_virtual
      FROM orders o
      LEFT JOIN users u ON u.telegram_id = o.user_id
      WHERE u.telegram_id IS NULL
      GROUP BY o.user_id
    )
  `;
  const searchSql = search
    ? `WHERE (
        full_name LIKE ?
        OR username LIKE ?
        OR CAST(telegram_id AS TEXT) LIKE ?
      )`
    : '';
  const searchParams = search ? [like, like, like] : [];

  const rows = db.prepare(`
    ${combinedUsersSql}
    SELECT *
    FROM combined_users
    ${searchSql}
    ORDER BY created_at DESC, telegram_id DESC
    LIMIT ? OFFSET ?
  `).all(...searchParams, limit, offset).map(row => ({
    ...row,
    is_virtual: !!row.is_virtual,
  }));

  const total = db.prepare(`
    ${combinedUsersSql}
    SELECT COUNT(*) AS c
    FROM combined_users
    ${searchSql}
  `).get(...searchParams).c;

  const stats = {
    totalUsers: db.prepare('SELECT COUNT(*) AS c FROM users').get().c,
    buyers: db.prepare('SELECT COUNT(DISTINCT user_id) AS c FROM orders').get().c,
    missingProfiles: db.prepare(`
      SELECT COUNT(DISTINCT o.user_id) AS c
      FROM orders o
      LEFT JOIN users u ON u.telegram_id = o.user_id
      WHERE u.telegram_id IS NULL
    `).get().c,
  };

  res.json({
    success: true,
    data: { users: rows, stats },
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// GET /admin/users/:telegramId
router.get('/:telegramId', (req, res) => {
  const rawTelegramId = String(req.params.telegramId);
  const telegramId = Number(rawTelegramId);
  if (!/^\d+$/.test(rawTelegramId) || !Number.isSafeInteger(telegramId)) {
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_TELEGRAM_ID', message: 'Telegram ID phải là số nguyên hợp lệ.' },
    });
  }

  const realUser = db.prepare('SELECT *, 0 AS is_virtual FROM users WHERE telegram_id = ?').get(telegramId);
  const hasOrders = db.prepare('SELECT 1 FROM orders WHERE user_id = ? LIMIT 1').get(telegramId);
  if (!realUser && !hasOrders) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  }
  const user = realUser
    ? { ...realUser, is_virtual: false }
    : {
        telegram_id: telegramId,
        username: null,
        full_name: `ID ${telegramId}`,
        balance: 0,
        created_at: null,
        is_virtual: true,
      };

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
