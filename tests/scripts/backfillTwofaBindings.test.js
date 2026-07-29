const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const memoryDb = new Database(':memory:');
memoryDb.pragma('foreign_keys = ON');
memoryDb.exec(`
  CREATE TABLE users (
    telegram_id INTEGER PRIMARY KEY,
    username TEXT
  );
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    delivered_keys_json TEXT,
    FOREIGN KEY (user_id) REFERENCES users(telegram_id)
  );
`);
require('../../src/database/migrations/062_twofa_order_bindings').up(memoryDb);

const databasePath = require.resolve('../../src/database');
require.cache[databasePath] = {
  id: databasePath,
  filename: databasePath,
  loaded: true,
  exports: memoryDb,
};
const { reconcileDeliveredOrder } = require('../../src/services/twofaBindingService');
const { runBackfill } = require('../../scripts/backfill-twofa-order-bindings');
const scriptPath = path.resolve(__dirname, '../../scripts/backfill-twofa-order-bindings.js');
const appDatabaseDirectory = path.resolve(__dirname, '../../src/database');
const bindingServicePath = path.resolve(__dirname, '../../src/services/twofaBindingService.js');

const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const uniqueUurl = `backfill-unique-${suffix}`;
const sharedUurl = `backfill-shared-${suffix}`;
let firstOrderId;
let secondOrderId;
let ignoredOrderId;

test.before(() => {
  memoryDb.prepare('INSERT INTO users (telegram_id, username) VALUES (?, ?)').run(101, 'backfilluser');
  firstOrderId = Number(memoryDb.prepare(`
    INSERT INTO orders (user_id, status, delivered_keys_json)
    VALUES (101, 'delivered', ?)
  `).run(JSON.stringify([
    `https://order.subhub.vn/${uniqueUurl}`,
    `https://order.taikhoantenhat.com/${sharedUurl}`,
  ])).lastInsertRowid);
  secondOrderId = Number(memoryDb.prepare(`
    INSERT INTO orders (user_id, status, delivered_keys_json)
    VALUES (101, 'delivered', ?)
  `).run(JSON.stringify([
    `https://order.godstudy.me/${sharedUurl}`,
  ])).lastInsertRowid);
  ignoredOrderId = Number(memoryDb.prepare(`
    INSERT INTO orders (user_id, status, delivered_keys_json)
    VALUES (101, 'paid', ?)
  `).run(JSON.stringify([
    `https://order.subhub.vn/backfill-ignored-${suffix}`,
  ])).lastInsertRowid);
});

test.after(() => {
  memoryDb.close();
});

test('dry-run reports counts without writing bindings', async () => {
  const before = memoryDb.prepare('SELECT total_changes() AS count').get().count;
  const bindingCountBefore = memoryDb.prepare('SELECT COUNT(*) AS count FROM twofa_order_bindings').get().count;

  const report = await runBackfill({
    apply: false,
    register: false,
    db: memoryDb,
  });

  const after = memoryDb.prepare('SELECT total_changes() AS count').get().count;
  const bindingCountAfter = memoryDb.prepare('SELECT COUNT(*) AS count FROM twofa_order_bindings').get().count;
  assert.strictEqual(after, before);
  assert.strictEqual(bindingCountAfter, bindingCountBefore);
  assert.strictEqual(report.deliveredOrders, 2);
  assert.strictEqual(report.validLinks, 3);
  assert.strictEqual(report.conflictUurls, 1);
});

test('apply refuses to write without an existing backup file', async (t) => {
  const originalBackup = process.env.TWOFA_BACKFILL_BACKUP;
  delete process.env.TWOFA_BACKFILL_BACKUP;
  t.after(() => {
    if (originalBackup === undefined) delete process.env.TWOFA_BACKFILL_BACKUP;
    else process.env.TWOFA_BACKFILL_BACKUP = originalBackup;
  });

  await assert.rejects(
    runBackfill({
      apply: true,
      register: false,
      db: memoryDb,
      reconcile: reconcileDeliveredOrder,
    }),
    /TWOFA_BACKFILL_BACKUP/,
  );
  assert.strictEqual(
    memoryDb.prepare('SELECT COUNT(*) AS count FROM twofa_order_bindings').get().count,
    0,
  );
});

test('apply is idempotent, skips non-delivered orders and leaves duplicate UURL as conflict', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-backfill-'));
  const backupPath = path.join(tempDir, 'shop.db.backup');
  fs.writeFileSync(backupPath, 'existing backup');
  const originalBackup = process.env.TWOFA_BACKFILL_BACKUP;
  process.env.TWOFA_BACKFILL_BACKUP = backupPath;
  t.after(() => {
    if (originalBackup === undefined) delete process.env.TWOFA_BACKFILL_BACKUP;
    else process.env.TWOFA_BACKFILL_BACKUP = originalBackup;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await runBackfill({
    apply: true,
    register: false,
    db: memoryDb,
    reconcile: reconcileDeliveredOrder,
  });
  await runBackfill({
    apply: true,
    register: false,
    db: memoryDb,
    reconcile: reconcileDeliveredOrder,
  });

  const rows = memoryDb.prepare(`
    SELECT shop_order_id, uurl, status
    FROM twofa_order_bindings
    ORDER BY shop_order_id, uurl
  `).all();
  assert.deepStrictEqual(rows, [
    { shop_order_id: firstOrderId, uurl: sharedUurl, status: 'conflict' },
    { shop_order_id: firstOrderId, uurl: uniqueUurl, status: 'pending' },
    { shop_order_id: secondOrderId, uurl: sharedUurl, status: 'conflict' },
  ]);
  assert.ok(rows.every(row => row.shop_order_id !== ignoredOrderId));
});

test('production dry-run opens an unmigrated database read-only without loading app database modules', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-backfill-readonly-'));
  const tempDbPath = path.join(tempDir, 'shop.db');
  const tempDb = new Database(tempDbPath);
  tempDb.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      delivered_keys_json TEXT
    )
  `);
  tempDb.prepare(`
    INSERT INTO orders (id, status, delivered_keys_json)
    VALUES (1, 'delivered', ?)
  `).run(JSON.stringify([`https://order.subhub.vn/readonly-${suffix}`]));
  tempDb.close();
  const beforeHash = crypto.createHash('sha256').update(fs.readFileSync(tempDbPath)).digest('hex');
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const childSource = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (
        resolved === ${JSON.stringify(bindingServicePath)}
        || resolved.startsWith(${JSON.stringify(`${appDatabaseDirectory}${path.sep}`)})
      ) {
        throw new Error('EARLY_DATABASE_LOAD:' + resolved);
      }
      return originalLoad.apply(this, arguments);
    };
    const { runBackfill } = require(${JSON.stringify(scriptPath)});
    runBackfill({
      apply: false,
      register: false,
      databasePath: ${JSON.stringify(tempDbPath)}
    }).then(report => {
      process.stdout.write(JSON.stringify(report));
    }).catch(error => {
      console.error(error.stack);
      process.exitCode = 1;
    });
  `;
  const child = spawnSync(process.execPath, ['-e', childSource], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
  });

  assert.strictEqual(child.status, 0, child.stderr);
  assert.strictEqual(JSON.parse(child.stdout).deliveredOrders, 1);
  const afterHash = crypto.createHash('sha256').update(fs.readFileSync(tempDbPath)).digest('hex');
  assert.strictEqual(afterHash, beforeHash);
  assert.strictEqual(fs.existsSync(`${tempDbPath}-wal`), false);
  assert.strictEqual(fs.existsSync(`${tempDbPath}-shm`), false);
  const verifyDb = new Database(tempDbPath, { readonly: true, fileMustExist: true });
  assert.deepStrictEqual(
    verifyDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all(),
    [{ name: 'orders' }],
  );
  verifyDb.close();
});

test('apply validates backup before loading app database modules', () => {
  const childSource = `
    const Module = require('node:module');
    const originalLoad = Module._load;
    Module._load = function(request, parent, isMain) {
      const resolved = Module._resolveFilename(request, parent, isMain);
      if (
        resolved === ${JSON.stringify(bindingServicePath)}
        || resolved.startsWith(${JSON.stringify(`${appDatabaseDirectory}${path.sep}`)})
      ) {
        throw new Error('EARLY_DATABASE_LOAD:' + resolved);
      }
      return originalLoad.apply(this, arguments);
    };
    const { runBackfill } = require(${JSON.stringify(scriptPath)});
    runBackfill({ apply: true, register: false }).then(() => {
      process.exitCode = 2;
    }).catch(error => {
      if (!/TWOFA_BACKFILL_BACKUP/.test(error.message)) {
        console.error(error.stack);
        process.exitCode = 1;
      }
    });
  `;
  const child = spawnSync(process.execPath, ['-e', childSource], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
    env: { ...process.env, TWOFA_BACKFILL_BACKUP: '' },
  });

  assert.strictEqual(child.status, 0, child.stderr);
});
