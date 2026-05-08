const db = require('../database');

const statsService = {
  getDashboardStats() {
    const totalOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'delivered'").get().c;
    const totalRevenue = db.prepare("SELECT COALESCE(SUM(total_price), 0) as s FROM orders WHERE status = 'delivered'").get().s;
    const pendingOrders = db.prepare("SELECT COUNT(*) as c FROM orders WHERE status = 'pending'").get().c;
    const totalStock = db.prepare('SELECT COUNT(*) as c FROM stock WHERE is_sold = 0').get().c;
    const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
    const totalProducts = db.prepare("SELECT COUNT(*) as c FROM products WHERE is_active = 1").get().c;

    // Today
    const todayRevenue = db.prepare(
      "SELECT COALESCE(SUM(total_price), 0) as s FROM orders WHERE status = 'delivered' AND date(delivered_at) = date('now')"
    ).get().s;
    const todayOrders = db.prepare(
      "SELECT COUNT(*) as c FROM orders WHERE status = 'delivered' AND date(delivered_at) = date('now')"
    ).get().c;

    // This week
    const weekRevenue = db.prepare(
      "SELECT COALESCE(SUM(total_price), 0) as s FROM orders WHERE status = 'delivered' AND delivered_at >= datetime('now', '-7 days')"
    ).get().s;

    // This month
    const monthRevenue = db.prepare(
      "SELECT COALESCE(SUM(total_price), 0) as s FROM orders WHERE status = 'delivered' AND delivered_at >= datetime('now', '-30 days')"
    ).get().s;

    // Unmatched transactions
    const unmatchedTx = db.prepare(
      "SELECT COUNT(*) as c FROM transactions WHERE match_status = 'unmatched'"
    ).get().c;

    // Low stock products
    const lowStockCount = db.prepare(`
      SELECT COUNT(*) as c FROM products p
      WHERE p.is_active = 1 AND p.low_stock_threshold > 0
        AND (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) <= p.low_stock_threshold
        AND (SELECT COUNT(*) FROM stock s WHERE s.product_id = p.id AND s.is_sold = 0) > 0
    `).get().c;

    return {
      totalOrders,
      totalRevenue,
      pendingOrders,
      totalStock,
      totalUsers,
      activeUsers: totalUsers,
      totalProducts,
      revenueToday: todayRevenue,
      ordersToday: todayOrders,
      revenueWeek: weekRevenue,
      revenueMonth: monthRevenue,
      unmatchedTransactions: unmatchedTx,
      lowStockCount,
    };
  },

  getRevenueChart(days = 30) {
    const rows = db.prepare(`
      SELECT date(delivered_at) as date, SUM(total_price) as revenue, COUNT(*) as orders
      FROM orders
      WHERE status = 'delivered' AND delivered_at >= datetime('now', '-' || ? || ' days')
      GROUP BY date(delivered_at)
      ORDER BY date
    `).all(days);
    return rows.map(r => ({ date: r.date, revenue: r.revenue, orders: r.orders }));
  },

  getTopProducts(limit = 10) {
    const rows = db.prepare(`
      SELECT p.id, p.name, p.emoji, COUNT(o.id) as order_count, SUM(o.total_price) as total_revenue
      FROM orders o
      JOIN products p ON o.product_id = p.id
      WHERE o.status = 'delivered'
      GROUP BY p.id
      ORDER BY total_revenue DESC
      LIMIT ?
    `).all(limit);
    return rows.map(r => ({
      id: String(r.id),
      name: r.name,
      emoji: r.emoji || '📦',
      sold: r.order_count,
      revenue: r.total_revenue,
    }));
  },
};

module.exports = statsService;
