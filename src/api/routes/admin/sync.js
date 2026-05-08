const { Router } = require('express');
const { syncFromSheet } = require('../../../services/sheetSync');

const router = Router();

// POST /admin/sync/google-sheet — Manual sync trigger
router.post('/google-sheet', async (req, res) => {
  try {
    await syncFromSheet();
    res.json({ success: true, data: { message: 'Sync completed' } });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'SYNC_FAILED', message: err.message } });
  }
});

module.exports = router;
