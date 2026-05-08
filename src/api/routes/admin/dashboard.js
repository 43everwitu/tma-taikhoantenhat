const { Router } = require('express');
const statsService = require('../../../services/statsService');

const router = Router();

// GET /admin/dashboard/stats
router.get('/stats', (req, res) => {
  const stats = statsService.getDashboardStats();
  res.json({ success: true, data: stats });
});

// GET /admin/dashboard/revenue?period=30
router.get('/revenue', (req, res) => {
  const days = parseInt(req.query.period) || 30;
  const data = statsService.getRevenueChart(days);
  res.json({ success: true, data });
});

// GET /admin/dashboard/top-products?limit=10
router.get('/top-products', (req, res) => {
  const limit = parseInt(req.query.limit) || 10;
  const data = statsService.getTopProducts(limit);
  res.json({ success: true, data });
});

module.exports = router;
