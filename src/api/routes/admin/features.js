const { Router } = require('express');
const config = require('../../../config');

const router = Router();

router.get('/', (req, res) => {
  res.json({
    success: true,
    data: {
      topups: !!config.FEATURE_TOPUPS,
      broadcast: !!config.FEATURE_BROADCAST,
      telegramNotify: config.FEATURE_TELEGRAM_NOTIFY || 'order_only',
    },
  });
});

module.exports = router;
