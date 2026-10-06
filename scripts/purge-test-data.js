#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const db = require('../src/database');

const APPLY = process.argv.includes('--apply');
const repoRoot = path.join(__dirname, '..');
const dbPath = path.join(repoRoot, 'data', 'shop.db');
// 9990001: generic test fixture user. 9991001: tests/services/paymentPollerLateRecovery.test.js
// fixture user (INSERT OR IGNORE, persists across runs by design — see that test's TEST_USER_ID).
const TEST_USER_IDS = [9990001, 9991001];
// Fixture users left by crashed/interrupted tests carry usernames shaped
// `<prefix>_<13-digit ms timestamp>_<random>` (note_*, marketing_*, stock_user_*, ann_html_*).
// Only users that never placed an order are treated as junk.
const JUNK_USERNAME_GLOB = '*_[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]_*';

function allIds(rows) {
  return rows.map(r => r.id);
}

function placeholders(values) {
  return values.map(() => '?').join(',');
}

function nowStamp() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return [
    d.getFullYear(),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    '-',
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join('');
}

function collectTargets() {
  const userPh = placeholders(TEST_USER_IDS);
  const products = db.prepare(`
    SELECT DISTINCT p.id, p.name, p.slug
    FROM products p
    LEFT JOIN orders o ON o.product_id = p.id
    WHERE p.name IN ('R', 'Test')
       OR p.name = 'Dedup'
       OR p.name LIKE 'Notify variant product %'
       OR p.slug LIKE 'r-%'
       OR p.slug LIKE 'notify-variant-product-%'
       OR o.user_id IN (${userPh})
  `).all(...TEST_USER_IDS);
  const productIds = allIds(products);

  const orderWhere = productIds.length
    ? `user_id IN (${userPh}) OR product_id IN (${placeholders(productIds)})`
    : `user_id IN (${userPh})`;
  const orderParams = productIds.length ? [...TEST_USER_IDS, ...productIds] : [...TEST_USER_IDS];
  const orders = db.prepare(`SELECT id, user_id, product_id FROM orders WHERE ${orderWhere}`).all(...orderParams);
  const orderIds = allIds(orders);

  const nonTestUserOrders = orders.filter(o => !TEST_USER_IDS.includes(o.user_id));
  const stockRows = productIds.length
    ? db.prepare(`SELECT id FROM stock WHERE product_id IN (${placeholders(productIds)})`).all(...productIds)
    : [];
  const lowStockAlertStates = productIds.length
    ? db.prepare(`SELECT COUNT(*) AS c FROM low_stock_alert_states WHERE product_id IN (${placeholders(productIds)})`).get(...productIds).c
    : 0;
  const transactions = orderIds.length
    ? db.prepare(`SELECT id FROM transactions WHERE matched_order_id IN (${placeholders(orderIds)})`).all(...orderIds)
    : [];
  const notifications = db.prepare(`SELECT id FROM notifications WHERE user_id IN (${userPh})`).all(...TEST_USER_IDS);
  const walletTopups = db.prepare(`SELECT id FROM wallet_topups WHERE user_id IN (${userPh})`).all(...TEST_USER_IDS);
  const userProductFollows = db.prepare(`SELECT user_id, product_id FROM product_follows WHERE user_id IN (${userPh})`).all(...TEST_USER_IDS);
  const targetUsers = db.prepare(`SELECT telegram_id FROM users WHERE telegram_id IN (${userPh})`).all(...TEST_USER_IDS);
  const junkUserIds = db.prepare(`
    SELECT u.telegram_id FROM users u
    WHERE u.username GLOB ?
      AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.telegram_id)
  `).all(JUNK_USERNAME_GLOB).map(r => r.telegram_id);
  const junkNotifications = junkUserIds.length
    ? db.prepare(`SELECT COUNT(*) AS c FROM notifications WHERE user_id IN (${placeholders(junkUserIds)})`).get(...junkUserIds).c
    : 0;

  return {
    products,
    productIds,
    orders,
    orderIds,
    nonTestUserOrders,
    stockRows,
    lowStockAlertStates,
    transactions,
    notifications,
    walletTopups,
    userProductFollows,
    targetUsers,
    junkUserIds,
    junkNotifications,
  };
}

function printCounts(label, targets) {
  console.log(`\n${label}`);
  console.log(`target users: ${targets.targetUsers.length}`);
  console.log(`target products: ${targets.products.length}`);
  console.log(`target orders: ${targets.orders.length}`);
  console.log(`non-test-user orders via product rule: ${targets.nonTestUserOrders.length}`);
  console.log(`target stock rows: ${targets.stockRows.length}`);
  console.log(`target low stock alert states: ${targets.lowStockAlertStates}`);
  console.log(`target transactions: ${targets.transactions.length}`);
  console.log(`target notifications: ${targets.notifications.length}`);
  console.log(`target wallet topups: ${targets.walletTopups.length}`);
  console.log(`target user product follows: ${targets.userProductFollows.length}`);
  console.log(`junk fixture users (no orders): ${targets.junkUserIds.length} (${targets.junkNotifications} notifications)`);
}

function createBackup() {
  if (!fs.existsSync(dbPath)) {
    throw new Error(`DB file not found: ${dbPath}`);
  }
  const backupPath = path.join(repoRoot, 'data', `shop.db.bak-pre-test-purge-${nowStamp()}`);
  fs.copyFileSync(dbPath, backupPath, fs.constants.COPYFILE_EXCL);
  return backupPath;
}

function runDelete(targets) {
  const tx = db.transaction(() => {
    if (targets.orderIds.length) {
      db.prepare(`DELETE FROM transactions WHERE matched_order_id IN (${placeholders(targets.orderIds)})`).run(...targets.orderIds);
    }
    if (targets.orderIds.length) {
      db.prepare(`DELETE FROM orders WHERE id IN (${placeholders(targets.orderIds)})`).run(...targets.orderIds);
    }
    if (targets.productIds.length) {
      db.prepare(`DELETE FROM low_stock_alert_states WHERE product_id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
      db.prepare(`DELETE FROM stock WHERE product_id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
      db.prepare(`DELETE FROM product_variants WHERE product_id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
      db.prepare(`DELETE FROM product_follows WHERE product_id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
      db.prepare(`DELETE FROM products WHERE id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
    }
    const userPh = placeholders(TEST_USER_IDS);
    db.prepare(`DELETE FROM notifications WHERE user_id IN (${userPh})`).run(...TEST_USER_IDS);
    db.prepare(`DELETE FROM wallet_topups WHERE user_id IN (${userPh})`).run(...TEST_USER_IDS);
    db.prepare(`DELETE FROM product_follows WHERE user_id IN (${userPh})`).run(...TEST_USER_IDS);
    for (const userId of TEST_USER_IDS) {
      const remaining = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?').get(userId).c;
      if (remaining === 0) db.prepare('DELETE FROM users WHERE telegram_id = ?').run(userId);
    }
    if (targets.junkUserIds.length) {
      const junkPh = placeholders(targets.junkUserIds);
      db.prepare(`DELETE FROM notifications WHERE user_id IN (${junkPh})`).run(...targets.junkUserIds);
      db.prepare(`DELETE FROM wallet_topups WHERE user_id IN (${junkPh})`).run(...targets.junkUserIds);
      db.prepare(`DELETE FROM product_follows WHERE user_id IN (${junkPh})`).run(...targets.junkUserIds);
      db.prepare(`DELETE FROM users WHERE telegram_id IN (${junkPh})`).run(...targets.junkUserIds);
    }
  });
  tx();
}

const before = collectTargets();
printCounts('Before purge', before);

if (!APPLY) {
  console.log('\nDry run only. Re-run with --apply to create a backup and delete these rows.');
  process.exit(0);
}

const backupPath = createBackup();
console.log(`\nBackup created: ${backupPath}`);
runDelete(before);
const after = collectTargets();
printCounts('After purge', after);
