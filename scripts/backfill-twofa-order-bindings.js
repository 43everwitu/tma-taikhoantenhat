const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Database = require('better-sqlite3');
const {
  extractTwofaOrderLinks,
  parseDeliveredKeys,
} = require('../src/services/twofaOrderLinkParser');

const DEFAULT_DATABASE_PATH = path.join(__dirname, '..', 'data', 'shop.db');
const SNAPSHOT_ATTEMPTS = 3;

function getDeliveredOrders(db) {
  return db.prepare(`
    SELECT id, delivered_keys_json
    FROM orders
    WHERE status = 'delivered'
    ORDER BY id
  `).all();
}

function getExistingBindings(db) {
  const table = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'twofa_order_bindings'
  `).get();
  if (!table) return [];
  return db.prepare(`
    SELECT shop_order_id, uurl, status, synced_at
    FROM twofa_order_bindings
  `).all();
}

function getOrdersFingerprint(db) {
  const columns = db.prepare('PRAGMA table_info(orders)').all();
  const schema = JSON.stringify(columns.map(column => ({
    name: column.name,
    type: column.type,
    notnull: column.notnull,
    defaultValue: column.dflt_value,
    primaryKey: column.pk,
  })));
  const digest = crypto.createHash('sha256');
  let rowCount = 0;
  let maxId = null;
  for (const row of db.prepare('SELECT * FROM orders ORDER BY id').iterate()) {
    digest.update(JSON.stringify(row));
    digest.update('\n');
    rowCount += 1;
    maxId = row.id;
  }
  return { schema, rowCount, maxId, digest: digest.digest('hex') };
}

function fileFingerprint(filePath) {
  try {
    const stat = fs.statSync(filePath, { bigint: true });
    return [stat.dev, stat.ino, stat.size, stat.mtimeNs].join(':');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function copyStableSnapshot(sourcePath, snapshotPath) {
  const sourceWalPath = `${sourcePath}-wal`;
  const snapshotWalPath = `${snapshotPath}-wal`;
  const beforeMain = fileFingerprint(sourcePath);
  const beforeWal = fileFingerprint(sourceWalPath);
  if (!beforeMain) throw new Error('snapshot source missing');

  fs.copyFileSync(sourcePath, snapshotPath);
  if (beforeWal) fs.copyFileSync(sourceWalPath, snapshotWalPath);

  const afterMain = fileFingerprint(sourcePath);
  const afterWal = fileFingerprint(sourceWalPath);
  if (beforeMain !== afterMain || beforeWal !== afterWal) {
    throw new Error('snapshot source changed');
  }
}

function getDeliveredOrdersFromSnapshot(databasePath) {
  for (let attempt = 0; attempt < SNAPSHOT_ATTEMPTS; attempt += 1) {
    const snapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-backfill-snapshot-'));
    const snapshotPath = path.join(snapshotDir, 'shop.db');
    let snapshotDb;
    try {
      copyStableSnapshot(databasePath, snapshotPath);
      snapshotDb = new Database(snapshotPath, { readonly: true, fileMustExist: true });
      return {
        orders: getDeliveredOrders(snapshotDb),
        bindings: getExistingBindings(snapshotDb),
      };
    } catch {
      if (attempt === SNAPSHOT_ATTEMPTS - 1) {
        throw new Error('Không thể tạo snapshot read-only cho backfill 2FA');
      }
    } finally {
      try {
        snapshotDb?.close();
      } finally {
        fs.rmSync(snapshotDir, { recursive: true, force: true });
      }
    }
  }
  throw new Error('Không thể tạo snapshot read-only cho backfill 2FA');
}

function analyzeOrders(orders, existingBindings = []) {
  const ordersByUurl = new Map();
  const desiredBindings = new Map();
  let ordersWithLinks = 0;
  let validLinks = 0;
  let invalidLinks = 0;

  for (const order of orders) {
    const values = parseDeliveredKeys(order.delivered_keys_json);
    const links = extractTwofaOrderLinks(values);
    if (links.length > 0) ordersWithLinks += 1;
    validLinks += links.length;
    for (const link of links) {
      desiredBindings.set(`${order.id}:${link.uurl}`, {
        orderId: order.id,
        uurl: link.uurl,
      });
      if (!ordersByUurl.has(link.uurl)) ordersByUurl.set(link.uurl, new Set());
      ordersByUurl.get(link.uurl).add(order.id);
    }
    invalidLinks += values.reduce((count, value) => {
      if (typeof value !== 'string') return count;
      return count + Array.from(value.matchAll(/https:\/\/[^\s<>"']+/g))
        .filter(match => extractTwofaOrderLinks([match[0]]).length === 0)
        .length;
    }, 0);
  }

  const existingByKey = new Map(
    existingBindings.map(binding => [`${binding.shop_order_id}:${binding.uurl}`, binding]),
  );
  let bindingsToCreate = 0;
  let bindingsToReactivate = 0;
  let bindingsToDeactivate = 0;
  const deliveredOrderIds = new Set(orders.map(order => order.id));
  for (const [key, desired] of desiredBindings) {
    const existing = existingByKey.get(key);
    if (!existing) bindingsToCreate += 1;
    else if (
      ordersByUurl.get(desired.uurl)?.size === 1
      && ['inactive', 'sync_failed', 'conflict'].includes(existing.status)
    ) {
      bindingsToReactivate += 1;
    }
    if (
      existing
      && ordersByUurl.get(desired.uurl)?.size > 1
      && (existing.status === 'active' || existing.synced_at !== null)
    ) {
      bindingsToDeactivate += 1;
    }
  }
  for (const binding of existingBindings) {
    if (deliveredOrderIds.has(binding.shop_order_id)
      && !desiredBindings.has(`${binding.shop_order_id}:${binding.uurl}`)
      && (binding.status !== 'inactive' || binding.synced_at !== null)) {
      bindingsToDeactivate += 1;
    }
  }

  return {
    deliveredOrders: orders.length,
    ordersWithLinks,
    validLinks,
    invalidLinks,
    uniqueUurls: ordersByUurl.size,
    conflictUurls: Array.from(ordersByUurl.values())
      .filter(orderIds => orderIds.size > 1)
      .length,
    bindingsToCreate,
    bindingsToReactivate,
    bindingsToDeactivate,
  };
}

function requireExistingBackup(targetPath = DEFAULT_DATABASE_PATH, compareTarget = true) {
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
  let targetRealPath;
  try {
    targetRealPath = fs.realpathSync(targetPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (
    path.resolve(backupPath) === path.resolve(targetPath)
    || fs.realpathSync(backupPath) === targetRealPath
  ) {
    throw new Error('TWOFA_BACKFILL_BACKUP phải khác database target');
  }

  let backupDb;
  try {
    backupDb = new Database(backupPath, { readonly: true, fileMustExist: true });
    const integrity = backupDb.prepare('PRAGMA integrity_check').get()?.integrity_check;
    if (integrity !== 'ok') throw new Error('integrity_check không đạt');
    const hasOrders = backupDb.prepare(`
      SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'orders'
    `).get();
    if (!hasOrders) throw new Error('backup thiếu bảng orders');
    if (compareTarget && fs.existsSync(targetPath)) {
      const targetDb = new Database(targetPath, { readonly: true, fileMustExist: true });
      try {
        const backupFingerprint = getOrdersFingerprint(backupDb);
        const targetFingerprint = getOrdersFingerprint(targetDb);
        if (JSON.stringify(backupFingerprint) !== JSON.stringify(targetFingerprint)) {
          throw new Error('backup không khớp fingerprint database target');
        }
      } finally {
        targetDb.close();
      }
    }
  } catch (error) {
    throw new Error(`TWOFA_BACKFILL_BACKUP SQLite không hợp lệ: ${error.message}`);
  } finally {
    backupDb?.close();
  }
}

async function runBackfill({
  apply = false,
  register = false,
  db: injectedDb,
  reconcile: injectedReconcile,
  databasePath = DEFAULT_DATABASE_PATH,
} = {}) {
  if (apply) requireExistingBackup(databasePath, !injectedDb || databasePath !== DEFAULT_DATABASE_PATH);

  let db = injectedDb;
  let reconcile = injectedReconcile;
  if (!db) {
    if (apply) {
      db = require('../src/database');
    }
  }
  if (apply && !reconcile) {
    if (injectedDb) {
      throw new Error('Apply với database injection cần reconcile injection');
    }
    ({ reconcileDeliveredOrder: reconcile } = require('../src/services/twofaBindingService'));
  }

  const snapshot = db
    ? { orders: getDeliveredOrders(db), bindings: getExistingBindings(db) }
    : getDeliveredOrdersFromSnapshot(databasePath);
  const orders = snapshot.orders;
  const report = {
    apply: Boolean(apply),
    ...analyzeOrders(orders, snapshot.bindings),
    created: 0,
    active: 0,
    conflicts: 0,
    failed: 0,
  };

  if (!apply) return report;

  // Materialize toàn bộ binding và conflict trước khi đăng ký remote để một
  // UURL xuất hiện ở nhiều đơn không bao giờ được activate tạm thời.
  for (const order of orders) {
    const result = await reconcile(order.id, { register: false });
    report.created += result.created;
    report.failed += result.failed;
  }

  if (register) {
    for (const order of orders) {
      const needsRemoteSync = db.prepare(`
        SELECT 1 FROM twofa_order_bindings
        WHERE shop_order_id = ?
          AND (
            status IN ('pending', 'sync_failed')
            OR (status IN ('inactive', 'conflict') AND synced_at IS NOT NULL)
          )
        LIMIT 1
      `).get(order.id);
      if (!needsRemoteSync) continue;
      const result = await reconcile(order.id, { register: true });
      report.active += result.active;
      report.failed += result.failed;
    }
  }
  report.conflicts = orders.reduce((count, order) => (
    count + db.prepare(`
      SELECT COUNT(*) AS count
      FROM twofa_order_bindings
      WHERE shop_order_id = ? AND status = 'conflict'
    `).get(order.id).count
  ), 0);
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
