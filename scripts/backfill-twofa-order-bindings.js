const fs = require('node:fs');

const db = require('../src/database');
const {
  extractTwofaOrderLinks,
  reconcileDeliveredOrder,
} = require('../src/services/twofaBindingService');

function getDeliveredOrders() {
  return db.prepare(`
    SELECT id, delivered_keys_json
    FROM orders
    WHERE status = 'delivered'
    ORDER BY id
  `).all();
}

function parseDeliveredKeys(value) {
  try {
    const keys = JSON.parse(value || '[]');
    return Array.isArray(keys) ? keys : [];
  } catch {
    return [];
  }
}

function analyzeOrders(orders) {
  const ordersByUurl = new Map();
  let ordersWithLinks = 0;
  let validLinks = 0;

  for (const order of orders) {
    const links = extractTwofaOrderLinks(parseDeliveredKeys(order.delivered_keys_json));
    if (links.length > 0) ordersWithLinks += 1;
    validLinks += links.length;
    for (const link of links) {
      if (!ordersByUurl.has(link.uurl)) ordersByUurl.set(link.uurl, new Set());
      ordersByUurl.get(link.uurl).add(order.id);
    }
  }

  return {
    deliveredOrders: orders.length,
    ordersWithLinks,
    validLinks,
    uniqueUurls: ordersByUurl.size,
    conflictUurls: Array.from(ordersByUurl.values())
      .filter(orderIds => orderIds.size > 1)
      .length,
  };
}

function requireExistingBackup() {
  const backupPath = process.env.TWOFA_BACKFILL_BACKUP;
  if (!backupPath) {
    throw new Error('TWOFA_BACKFILL_BACKUP phải trỏ tới file backup tồn tại');
  }

  let stat;
  try {
    stat = fs.statSync(backupPath);
  } catch {
    throw new Error('TWOFA_BACKFILL_BACKUP phải trỏ tới file backup tồn tại');
  }
  if (!stat.isFile()) {
    throw new Error('TWOFA_BACKFILL_BACKUP phải trỏ tới file backup tồn tại');
  }
}

async function runBackfill({ apply = false, register = false } = {}) {
  const orders = getDeliveredOrders();
  const report = {
    apply: Boolean(apply),
    ...analyzeOrders(orders),
    created: 0,
    active: 0,
    conflicts: 0,
    failed: 0,
  };

  if (!apply) return report;
  requireExistingBackup();

  for (const order of orders) {
    const result = await reconcileDeliveredOrder(order.id, { register });
    report.created += result.created;
    report.active += result.active;
    report.conflicts += result.conflicts;
    report.failed += result.failed;
  }

  return report;
}

async function main() {
  const apply = process.argv.slice(2).includes('--apply');
  const report = await runBackfill({ apply, register: apply });
  console.log(JSON.stringify(report));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { runBackfill };
