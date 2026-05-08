const { Router } = require('express');
const { z } = require('zod');
const authService = require('../../services/authService');
const userService = require('../../services/userService');
const { verifyInitData } = require('../../utils/initData');
const config = require('../../config');
const { validate } = require('../middleware/validate');
const { requireCustomer } = require('../middleware/auth');

const router = Router();

// POST /auth/login — Admin login
router.post('/login', validate(z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1).max(100),
})), async (req, res) => {
  const { username, password } = req.validated;
  const result = await authService.adminLogin(username, password);

  if (!result) {
    return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Sai tên đăng nhập hoặc mật khẩu' } });
  }

  res.json({ success: true, data: result });
});

// POST /auth/link-telegram — Send verification code to Telegram ID
// Coerce: clients sometimes JSON-stringify the ID (e.g. to preserve precision
// for IDs > Number.MAX_SAFE_INTEGER, which Telegram doesn't currently produce
// but might in the future). z.coerce.number handles both shapes.
router.post('/link-telegram', validate(z.object({
  telegramId: z.coerce.number().int().positive(),
})), async (req, res) => {
  const { telegramId } = req.validated;
  const code = authService.generateLinkCode(telegramId);

  if (!code) {
    return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'Telegram ID chưa đăng ký bot. Gửi /start cho bot trước.' } });
  }

  // Send code via Telegram bot
  try {
    const bot = req.app.locals.bot;
    if (bot) {
      await bot.telegram.sendMessage(telegramId,
        `🔑 Mã xác nhận liên kết web: <b>${code}</b>\nHiệu lực 5 phút.`,
        { parse_mode: 'HTML' });
    }
  } catch (err) {
    return res.status(500).json({ success: false, error: { code: 'SEND_FAILED', message: 'Không gửi được mã. Kiểm tra Telegram ID.' } });
  }

  res.json({ success: true, data: { message: 'Mã xác nhận đã gửi qua Telegram' } });
});

// POST /auth/verify-code — Verify code and get customer JWT
router.post('/verify-code', validate(z.object({
  telegramId: z.coerce.number().int().positive(),
  code: z.string().length(6),
})), async (req, res) => {
  const { telegramId, code } = req.validated;
  const result = await authService.verifyLinkCode(telegramId, code);

  if (!result) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_CODE', message: 'Mã sai hoặc hết hạn' } });
  }

  res.json({ success: true, data: result });
});

// ============================================================
// Customer email + password
// ============================================================

// POST /auth/customer/set-password — set/change password (must be Telegram-linked)
router.post('/customer/set-password', requireCustomer, validate(z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(100),
})), async (req, res) => {
  const { email, password } = req.validated;
  const result = await authService.setCustomerPassword(req.customer.telegramId, email, password);
  if (!result.ok) {
    const code = result.error;
    const map = {
      INVALID_EMAIL: 'Email không hợp lệ',
      PASSWORD_TOO_SHORT: 'Mật khẩu cần tối thiểu 8 ký tự',
      EMAIL_TAKEN: 'Email này đã được tài khoản khác sử dụng',
      USER_NOT_FOUND: 'Không tìm thấy tài khoản',
    };
    return res.status(400).json({ success: false, error: { code, message: map[code] || code } });
  }
  res.json({ success: true });
});

// POST /auth/customer/login — email/password login → customer JWT
router.post('/customer/login', validate(z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(100),
})), async (req, res) => {
  const { email, password } = req.validated;
  const result = await authService.customerEmailLogin(email, password);
  if (!result) {
    return res.status(401).json({ success: false, error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng' } });
  }
  res.json({ success: true, data: result });
});

// POST /auth/customer/forgot — send reset code via Telegram bot
router.post('/customer/forgot', validate(z.object({
  email: z.string().email().max(200),
})), async (req, res) => {
  const { email } = req.validated;
  const result = authService.generatePasswordResetCode(email);
  // Always return success to avoid email enumeration leak. Only DM if found.
  if (result) {
    try {
      const bot = req.app.locals.bot;
      if (bot) {
        await bot.telegram.sendMessage(result.telegramId,
          `🔑 Mã đặt lại mật khẩu: <b>${result.code}</b>\n` +
          `Hiệu lực 10 phút. Nếu bạn không yêu cầu, hãy bỏ qua tin này.`,
          { parse_mode: 'HTML' });
      }
    } catch (err) {
      console.error('Forgot pwd DM failed:', err.message);
    }
  }
  res.json({ success: true, data: { message: 'Nếu email tồn tại, mã đã gửi qua Telegram.' } });
});

// POST /auth/customer/reset — verify code + apply new password
router.post('/customer/reset', validate(z.object({
  email: z.string().email().max(200),
  code: z.string().length(6),
  newPassword: z.string().min(8).max(100),
})), async (req, res) => {
  const { email, code, newPassword } = req.validated;
  const result = await authService.resetCustomerPassword(email, code, newPassword);
  if (!result.ok) {
    const map = {
      PASSWORD_TOO_SHORT: 'Mật khẩu cần tối thiểu 8 ký tự',
      NOT_FOUND: 'Email không tồn tại',
      NO_PENDING_RESET: 'Chưa có yêu cầu đặt lại mật khẩu',
      CODE_EXPIRED: 'Mã đã hết hạn',
      CODE_MISMATCH: 'Mã không đúng',
    };
    return res.status(400).json({ success: false, error: { code: result.error, message: map[result.error] || result.error } });
  }
  res.json({ success: true });
});

// ============================================================
// Telegram Mini App — initData → customer JWT
// ============================================================

router.post('/miniapp', validate(z.object({
  initData: z.string().min(1).max(8192),
})), async (req, res) => {
  const { initData } = req.validated;
  const result = verifyInitData(initData, config.BOT_TOKEN);
  if (!result.ok) {
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_INIT_DATA', message: `initData rejected: ${result.reason}` },
    });
  }

  const user = userService.findOrCreateFromInitData(result.user);
  const token = await authService.issueCustomerToken(user.telegram_id);

  res.json({
    success: true,
    data: {
      token,
      user: {
        telegramId: user.telegram_id,
        username: user.username || null,
        fullName: user.full_name || '',
        balance: user.balance || 0,
      },
    },
  });
});

module.exports = router;
