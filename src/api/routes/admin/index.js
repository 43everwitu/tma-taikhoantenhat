const { Router } = require('express');

const router = Router();

router.use('/dashboard', require('./dashboard'));
router.use('/orders', require('./orders'));
router.use('/products', require('./products'));
router.use('/products/:productId/variants', require('./variants'));
router.use('/categories', require('./categories'));
router.use('/stock', require('./stock'));
router.use('/users', require('./users'));
router.use('/transactions', require('./transactions'));
router.use('/topups', require('./topups'));
router.use('/wallet', require('./wallet'));
router.use('/announcements', require('./announcements'));
router.use('/messages', require('./messages'));
router.use('/settings', require('./settings'));
router.use('/audit-log', require('./audit'));
router.use('/payment-poller', require('./poller'));
router.use('/sync', require('./sync'));
router.use('/features', require('./features'));
router.use('/upload', require('./upload'));
router.use('/uploads', require('./upload'));
router.use('/me', require('./me'));
router.use('/admins', require('./admins'));
router.use('/discounts', require('./discounts'));

module.exports = router;
