const { Router } = require('express');

const router = Router();

// GET /admin/payment-poller/status
router.get('/status', (req, res) => {
  const poller = req.app.locals.getPaymentPoller?.();
  if (!poller) {
    return res.json({ success: true, data: { running: false, enabled: false } });
  }
  res.json({ success: true, data: { ...poller.getStatus(), enabled: true } });
});

// POST /admin/payment-poller/trigger — Force immediate poll
router.post('/trigger', async (req, res) => {
  const poller = req.app.locals.getPaymentPoller?.();
  if (!poller) {
    return res.status(400).json({ success: false, error: { code: 'POLLER_DISABLED', message: 'Payment poller not configured' } });
  }

  poller.ensureRunning();
  await poller._poll();

  res.json({ success: true, data: poller.getStatus() });
});

module.exports = router;
