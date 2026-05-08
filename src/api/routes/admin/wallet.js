const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const auditService = require('../../../services/auditService');
const { validate } = require('../../middleware/validate');

const router = Router();

// POST /admin/wallet/:tgid/adjust — manually +/- a user's balance
router.post('/:tgid/adjust', validate(z.object({
  delta: z.number().int().refine(n => n !== 0, 'delta cannot be zero'),
  reason: z.string().min(1).max(500),
})), (req, res) => {
  const tgid = parseInt(req.params.tgid);
  const { delta, reason } = req.validated;

  const user = db.prepare('SELECT telegram_id, balance FROM users WHERE telegram_id = ?').get(tgid);
  if (!user) return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND' } });

  const newBalance = user.balance + delta;
  if (newBalance < 0) {
    return res.status(400).json({
      success: false,
      error: { code: 'NEGATIVE_BALANCE', message: `Số dư không thể âm. Hiện tại: ${user.balance}, delta: ${delta}` },
    });
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET balance = ?, updated_at = CURRENT_TIMESTAMP WHERE telegram_id = ?')
      .run(newBalance, tgid);
    db.prepare(`
      INSERT INTO notifications (user_id, type, title, body, channel, sent_telegram, sent_web)
      VALUES (?, 'wallet_adjust', 'Số dư cập nhật', ?, 'web', 0, 1)
    `).run(tgid,
      `${delta > 0 ? '➕ Cộng' : '➖ Trừ'} ${Math.abs(delta).toLocaleString('vi')}đ vào ví. Lý do: ${reason}. Số dư mới: ${newBalance.toLocaleString('vi')}đ.`);
  });
  tx();

  auditService.log(req.admin.adminId, 'wallet.adjust', 'user', tgid, { delta, reason, newBalance }, req.ip);
  res.json({ success: true, data: { telegramId: tgid, balance: newBalance, delta } });
});

module.exports = router;
