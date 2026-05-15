const { Router } = require('express');
const { z } = require('zod');
const db = require('../../../database');
const authService = require('../../../services/authService');
const totpService = require('../../../services/totpService');
const auditService = require('../../../services/auditService');
const { validate } = require('../../middleware/validate');

const router = Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      adminId: req.admin.adminId,
      role: req.admin.role,
      username: req.admin.username,
      permissions: req.admin.perms,
      step: req.admin.step || null,
    },
  });
});

function loadAdmin(req) {
  return db.prepare('SELECT * FROM admins WHERE id = ? AND is_active = 1').get(req.admin.adminId);
}

function shape2faState(admin) {
  const required = require('../../../services/twofaPolicy').isRequired(admin);
  let backupCount = 0;
  if (admin.totp_backup_codes) {
    try { backupCount = JSON.parse(admin.totp_backup_codes).length; } catch {}
  }
  return {
    enabled: !!admin.totp_enabled,
    required,
    backupCount,
  };
}

router.get('/2fa', (req, res) => {
  const admin = loadAdmin(req);
  if (!admin) return res.status(401).json({ success: false, error: { code: 'ADMIN_INACTIVE' } });
  res.json({ success: true, data: shape2faState(admin) });
});

// POST /admin/me/2fa/setup — generate (or rotate) provisional secret.
// Stores encrypted secret with totp_enabled=0 so a partial enrollment doesn't
// lock the admin out. Returns QR + raw secret for one-time display.
router.post('/2fa/setup', async (req, res) => {
  const admin = loadAdmin(req);
  if (!admin) return res.status(401).json({ success: false, error: { code: 'ADMIN_INACTIVE' } });
  if (admin.totp_enabled) {
    return res.status(409).json({ success: false, error: { code: 'ALREADY_ENABLED', message: '2FA đã bật. Tắt trước khi cài lại.' } });
  }
  const secret = totpService.generateSecret();
  const url = totpService.otpauthUrl(secret, admin.username);
  const qrDataUrl = await totpService.makeQrDataUrl(url);
  db.prepare('UPDATE admins SET totp_secret = ?, totp_enabled = 0 WHERE id = ?')
    .run(totpService.encryptSecret(secret), admin.id);
  auditService.log(admin.id, 'admin.2fa.setup', 'admin', admin.id, {}, req.ip);
  res.json({ success: true, data: { secret, otpauthUrl: url, qrDataUrl } });
});

// POST /admin/me/2fa/enable — verify the code from authenticator, persist
// totp_enabled=1, mint backup codes (returned once in plaintext), and — when
// called with an enroll-step token — exchange it for a full session token.
router.post('/2fa/enable', validate(z.object({ code: z.string().min(6).max(8) })), async (req, res) => {
  const admin = loadAdmin(req);
  if (!admin) return res.status(401).json({ success: false, error: { code: 'ADMIN_INACTIVE' } });
  if (!admin.totp_secret) {
    return res.status(400).json({ success: false, error: { code: 'NO_SETUP', message: 'Chưa khởi tạo. Bấm Bật 2FA trước.' } });
  }
  const secret = totpService.decryptSecret(admin.totp_secret);
  if (!totpService.verifyCode(secret, req.validated.code)) {
    auditService.log(admin.id, 'admin.2fa.verify_fail', 'admin', admin.id, { context: 'enable' }, req.ip);
    return res.status(401).json({ success: false, error: { code: 'BAD_CODE', message: 'Mã không đúng' } });
  }
  const backup = await totpService.generateBackupCodes();
  db.prepare(`
    UPDATE admins SET totp_enabled = 1, totp_backup_codes = ?
     WHERE id = ?
  `).run(JSON.stringify(backup.hashes), admin.id);
  auditService.log(admin.id, 'admin.2fa.enable', 'admin', admin.id, {}, req.ip);

  // If this came from an enroll-step token, swap it for a full token.
  let token = null;
  if (req.admin.step === 'enroll') {
    token = await authService.issueFullAdminToken({
      id: admin.id, username: admin.username, role: admin.role,
    });
  }
  res.json({ success: true, data: { backupCodes: backup.plaintext, token } });
});

// POST /admin/me/2fa/disable — verify code, then turn off (refused when the
// admin is in the required cohort).
router.post('/2fa/disable', validate(z.object({ code: z.string().min(6).max(20) })), async (req, res) => {
  const admin = loadAdmin(req);
  if (!admin) return res.status(401).json({ success: false, error: { code: 'ADMIN_INACTIVE' } });
  if (require('../../../services/twofaPolicy').isRequired(admin)) {
    return res.status(403).json({ success: false, error: { code: 'TOTP_REQUIRED', message: 'Tài khoản bắt buộc 2FA — không thể tắt.' } });
  }
  if (!admin.totp_enabled || !admin.totp_secret) {
    return res.status(400).json({ success: false, error: { code: 'NOT_ENABLED' } });
  }
  const secret = totpService.decryptSecret(admin.totp_secret);
  if (!totpService.verifyCode(secret, req.validated.code)) {
    return res.status(401).json({ success: false, error: { code: 'BAD_CODE' } });
  }
  db.prepare('UPDATE admins SET totp_enabled = 0, totp_secret = NULL, totp_backup_codes = NULL WHERE id = ?').run(admin.id);
  auditService.log(admin.id, 'admin.2fa.disable', 'admin', admin.id, {}, req.ip);
  res.json({ success: true, data: { disabled: true } });
});

// POST /admin/me/2fa/regenerate-backup — mint a fresh 10-code set, invalidates
// any unused old code. Requires a current TOTP / backup-code verification.
router.post('/2fa/regenerate-backup', validate(z.object({ code: z.string().min(6).max(20) })), async (req, res) => {
  const admin = loadAdmin(req);
  if (!admin) return res.status(401).json({ success: false, error: { code: 'ADMIN_INACTIVE' } });
  if (!admin.totp_enabled || !admin.totp_secret) {
    return res.status(400).json({ success: false, error: { code: 'NOT_ENABLED' } });
  }
  const secret = totpService.decryptSecret(admin.totp_secret);
  if (!totpService.verifyCode(secret, req.validated.code)) {
    return res.status(401).json({ success: false, error: { code: 'BAD_CODE' } });
  }
  const backup = await totpService.generateBackupCodes();
  db.prepare('UPDATE admins SET totp_backup_codes = ? WHERE id = ?').run(JSON.stringify(backup.hashes), admin.id);
  auditService.log(admin.id, 'admin.2fa.regenerate_backup', 'admin', admin.id, {}, req.ip);
  res.json({ success: true, data: { backupCodes: backup.plaintext } });
});

module.exports = router;
