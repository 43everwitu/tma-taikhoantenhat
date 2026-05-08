const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const topupService = require('../../../services/topupService');
const auditService = require('../../../services/auditService');
const { validate } = require('../../middleware/validate');

const router = Router();

function shapeTopup(r) {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.full_name || null,
    username: r.username || null,
    amount: r.amount,
    actualAmount: r.actual_amount != null ? r.actual_amount : r.amount,
    memo: r.memo,
    status: r.status,
    mbTransactionNumber: r.mb_transaction_number || null,
    requestedAt: r.requested_at,
    matchedAt: r.matched_at || null,
    expiresAt: r.expires_at || null,
    cancelReason: r.cancel_reason || null,
  };
}

const VALID_STATUS = ['pending', 'awaiting_credit', 'matched', 'expired', 'cancelled'];

// GET /admin/topups?status=&search=&page=1&limit=20
router.get('/', (req, res) => {
  const { status, search, page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  let where = '1=1';
  const params = [];
  if (status && VALID_STATUS.includes(status)) {
    where += ' AND t.status = ?';
    params.push(status);
  }
  if (search) {
    where += ' AND (t.memo LIKE ? OR CAST(t.user_id AS TEXT) LIKE ? OR u.username LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  const rows = db.prepare(`
    SELECT t.*, u.full_name, u.username
    FROM wallet_topups t
    LEFT JOIN users u ON t.user_id = u.telegram_id
    WHERE ${where}
    ORDER BY t.requested_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), offset);

  const total = db.prepare(`
    SELECT COUNT(*) as c FROM wallet_topups t
    LEFT JOIN users u ON t.user_id = u.telegram_id
    WHERE ${where}
  `).all(...params)[0].c;

  res.json({
    success: true,
    data: rows.map(shapeTopup),
    meta: { page: parseInt(page), limit: parseInt(limit), total },
  });
});

// GET /admin/topups/:id
router.get('/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const row = db.prepare(`
    SELECT t.*, u.full_name, u.username
    FROM wallet_topups t
    LEFT JOIN users u ON t.user_id = u.telegram_id
    WHERE t.id = ?
  `).get(id);
  if (!row) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  res.json({ success: true, data: shapeTopup(row) });
});

// POST /admin/topups/:id/manual-credit — admin force-credits a stuck topup
router.post('/:id/manual-credit', (req, res) => {
  const id = parseInt(req.params.id);
  const topup = topupService.getById(id);
  if (!topup) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  if (topup.status !== 'pending' && topup.status !== 'awaiting_credit') {
    return res.status(409).json({ success: false, error: { code: 'NOT_CREDITABLE', message: `Topup status is '${topup.status}'` } });
  }

  const result = topupService.manualCredit(id, req.admin.adminId);
  if (!result) return res.status(500).json({ success: false, error: { code: 'CREDIT_FAILED' } });

  auditService.log(req.admin.adminId, 'topup.manual_credit', 'topup', id,
    { amount: result.amount, newBalance: result.newBalance }, req.ip);

  // Notify the user via Telegram so they know admin approved it
  try {
    const bot = req.app.get('bot');
    if (bot) {
      const messageTemplateService = require('../../../services/messageTemplateService');
      bot.telegram.sendMessage(topup.user_id,
        messageTemplateService.render('topup_success', {
          amount: result.amount.toLocaleString('vi'),
          newBalance: result.newBalance.toLocaleString('vi'),
          memo: topup.memo || '',
        }),
        { parse_mode: 'HTML' }).catch(() => {});
    }
  } catch {}

  res.json({ success: true, data: { id, newBalance: result.newBalance } });
});

// POST /admin/topups/:id/cancel
router.post('/:id/cancel', validate(z.object({
  reason: z.string().max(500).optional(),
})), (req, res) => {
  const id = parseInt(req.params.id);
  const topup = topupService.getById(id);
  if (!topup) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND' } });
  if (topup.status !== 'pending') {
    return res.status(409).json({ success: false, error: { code: 'NOT_PENDING' } });
  }

  const ok = topupService.cancel(id, req.validated.reason);
  if (!ok) return res.status(500).json({ success: false, error: { code: 'CANCEL_FAILED' } });

  auditService.log(req.admin.adminId, 'topup.cancel', 'topup', id, { reason: req.validated.reason }, req.ip);
  res.json({ success: true });
});

module.exports = router;
