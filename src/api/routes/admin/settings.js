const { Router } = require('express');
const db = require('../../../database');
const auditService = require('../../../services/auditService');
const adminNotifyService = require('../../../services/adminNotifyService');

const router = Router();

// GET /admin/settings
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value, updated_at FROM settings').all();
  const settings = {};
  rows.forEach(r => { settings[r.key] = r.value; });
  res.json({ success: true, data: settings });
});

// PUT /admin/settings — Bulk update
router.put('/', (req, res) => {
  const updates = req.body;
  if (!updates || typeof updates !== 'object') {
    return res.status(400).json({ success: false, error: { code: 'INVALID_INPUT' } });
  }

  const upsert = db.prepare(
    'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP'
  );
  const updateAll = db.transaction(() => {
    for (const [key, value] of Object.entries(updates)) {
      if (typeof key === 'string' && key.length > 0) {
        upsert.run(key, String(value), String(value));
      }
    }
  });
  updateAll();

  // Bust the in-memory toggle cache so notify_admin_* changes take effect now.
  if (Object.keys(updates).some(k => k.startsWith('notify_admin_'))) {
    adminNotifyService.invalidateCache();
  }

  // Bust the 2FA policy cache when require_2fa_all changes.
  if (Object.prototype.hasOwnProperty.call(updates, 'require_2fa_all')) {
    require('../../../services/twofaPolicy').invalidateCache();
  }

  auditService.log(req.admin.adminId, 'settings.update', 'settings', null, updates, req.ip);
  res.json({ success: true });
});

module.exports = router;
