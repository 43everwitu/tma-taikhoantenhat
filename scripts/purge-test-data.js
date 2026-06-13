#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const db = require('../src/database');

const APPLY = process.argv.includes('--apply');
const repoRoot = path.join(__dirname, '..');
const dbPath = path.join(repoRoot, 'data', 'shop.db');
const TEST_USER_ID = 9990001;

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
  const products = db.prepare(`
    SELECT DISTINCT p.id, p.name, p.slug
    FROM products p
    LEFT JOIN orders o ON o.product_id = p.id
    WHERE p.name IN ('R', 'Test')
       OR p.slug LIKE 'r-%'
       OR o.user_id = ?
  `).all(TEST_USER_ID);
  const productIds = allIds(products);

  const orderWhere = productIds.length
    ? `user_id = ? OR product_id IN (${placeholders(productIds)})`
    : 'user_id = ?';
  const orderParams = productIds.length ? [TEST_USER_ID, ...productIds] : [TEST_USER_ID];
  const orders = db.prepare(`SELECT id, user_id, product_id FROM orders WHERE ${orderWhere}`).all(...orderParams);
  const orderIds = allIds(orders);

  const nonTestUserOrders = orders.filter(o => o.user_id !== TEST_USER_ID);
  const stockRows = productIds.length
    ? db.prepare(`SELECT id FROM stock WHERE product_id IN (${placeholders(productIds)})`).all(...productIds)
    : [];
  const transactions = orderIds.length
    ? db.prepare(`SELECT id FROM transactions WHERE matched_order_id IN (${placeholders(orderIds)})`).all(...orderIds)
    : [];
  const targetUser = db.prepare('SELECT telegram_id FROM users WHERE telegram_id = ?').get(TEST_USER_ID);

  return { products, productIds, orders, orderIds, nonTestUserOrders, stockRows, transactions, targetUser };
}

function printCounts(label, targets) {
  console.log(`\n${label}`);
  console.log(`target user: ${targets.targetUser ? 1 : 0}`);
  console.log(`target products: ${targets.products.length}`);
  console.log(`target orders: ${targets.orders.length}`);
  console.log(`non-test-user orders via product rule: ${targets.nonTestUserOrders.length}`);
  console.log(`target stock rows: ${targets.stockRows.length}`);
  console.log(`target transactions: ${targets.transactions.length}`);
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
      db.prepare(`DELETE FROM stock WHERE product_id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
      db.prepare(`DELETE FROM product_variants WHERE product_id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
      db.prepare(`DELETE FROM product_follows WHERE product_id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
      db.prepare(`DELETE FROM products WHERE id IN (${placeholders(targets.productIds)})`).run(...targets.productIds);
    }
    const remaining = db.prepare('SELECT COUNT(*) AS c FROM orders WHERE user_id = ?').get(TEST_USER_ID).c;
    if (remaining === 0) db.prepare('DELETE FROM users WHERE telegram_id = ?').run(TEST_USER_ID);
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
