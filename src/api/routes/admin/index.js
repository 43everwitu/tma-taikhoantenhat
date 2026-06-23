const { Router } = require('express');
const { requireFullAuth } = require('../../middleware/auth');

const router = Router();

// /me and its 2FA sub-routes are reachable with an enrollment-step token so a
// manager flagged totp_required can complete setup before getting a full
// session. Everything else requires a full-step token via requireFullAuth.
router.use('/me', require('./me'));

router.use(requireFullAuth);

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
router.use('/renewals', require('./renewals'));
router.use('/settings', require('./settings'));
router.use('/audit-log', require('./audit'));
router.use('/payment-poller', require('./poller'));
router.use('/features', require('./features'));
router.use('/upload', require('./upload'));
router.use('/uploads', require('./upload'));
router.use('/admins', require('./admins'));
router.use('/discounts', require('./discounts'));

module.exports = router;
