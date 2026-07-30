const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');
const config = require('../../src/config');

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

function snapshotDirectory(directory) {
  return fs.readdirSync(directory).sort().map((name) => {
    const filePath = path.join(directory, name);
    return {
      name,
      hash: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex'),
    };
  });
}

function createValidBackup(filePath) {
  const backupDb = new Database(filePath);
  backupDb.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      delivered_keys_json TEXT
    )
  `);
  backupDb.close();
}

function runDryRunChild(databasePath) {
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
      databasePath: ${JSON.stringify(databasePath)}
    }).then(report => {
      process.stdout.write(JSON.stringify(report));
    }).catch(error => {
      console.error(error.stack);
      process.exitCode = 1;
    });
  `;
  return spawnSync(process.execPath, ['-e', childSource], {
    cwd: path.resolve(__dirname, '../..'),
    encoding: 'utf8',
  });
}

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
    `Xem lại: https://order.subhub.vn/${uniqueUurl}?source=backfill`,
    `https://order.taikhoantenhat.com/${sharedUurl}`,
    'https://order.subhub.vn/invalid/path',
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
  assert.strictEqual(report.invalidLinks, 1);
  assert.strictEqual(report.conflictUurls, 1);
  assert.strictEqual(report.bindingsToCreate, 3);
  assert.strictEqual(report.bindingsToReactivate, 0);
  assert.strictEqual(report.bindingsToDeactivate, 0);
});

test('dry-run projects create, reactivate and deactivate changes from local rows', async (t) => {
  const localDb = new Database(':memory:');
  localDb.pragma('foreign_keys = ON');
  localDb.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      delivered_keys_json TEXT
    )
  `);
  require('../../src/database/migrations/062_twofa_order_bindings').up(localDb);
  localDb.prepare(`
    INSERT INTO orders (id, status, delivered_keys_json)
    VALUES (1, 'delivered', ?)
  `).run(JSON.stringify([
    'https://order.subhub.vn/retained-uurl',
    'https://order.subhub.vn/new-uurl',
  ]));
  localDb.prepare(`
    INSERT INTO orders (id, status, delivered_keys_json)
    VALUES (2, 'paid', '[]')
  `).run();
  const insertBinding = localDb.prepare(`
    INSERT INTO twofa_order_bindings (
      binding_id, shop_order_id, telegram_user_id, uurl, order_host, order_url,
      recipient_label, status
    ) VALUES (?, 1, 101, ?, 'order.subhub.vn', ?, 'Telegram ID ••••0101', ?)
  `);
  insertBinding.run(
    'retained-binding',
    'retained-uurl',
    'https://order.subhub.vn/retained-uurl',
    'inactive',
  );
  insertBinding.run(
    'removed-binding',
    'removed-uurl',
    'https://order.subhub.vn/removed-uurl',
    'active',
  );
  localDb.prepare(`
    INSERT INTO twofa_order_bindings (
      binding_id, shop_order_id, telegram_user_id, uurl, order_host, order_url,
      recipient_label, status
    ) VALUES (
      'ignored-binding', 2, 101, 'ignored-uurl', 'order.subhub.vn',
      'https://order.subhub.vn/ignored-uurl', 'Telegram ID ••••0101', 'active'
    )
  `).run();
  t.after(() => localDb.close());

  const report = await runBackfill({
    apply: false,
    register: false,
    db: localDb,
  });

  assert.strictEqual(report.bindingsToCreate, 1);
  assert.strictEqual(report.bindingsToReactivate, 1);
  assert.strictEqual(report.bindingsToDeactivate, 1);
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

test('apply rejects a backup that is not a valid SQLite database', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-backfill-invalid-backup-'));
  const backupPath = path.join(tempDir, 'shop.db.backup');
  fs.writeFileSync(backupPath, 'not sqlite');
  const originalBackup = process.env.TWOFA_BACKFILL_BACKUP;
  process.env.TWOFA_BACKFILL_BACKUP = backupPath;
  t.after(() => {
    if (originalBackup === undefined) delete process.env.TWOFA_BACKFILL_BACKUP;
    else process.env.TWOFA_BACKFILL_BACKUP = originalBackup;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await assert.rejects(
    runBackfill({
      apply: true,
      register: false,
      db: memoryDb,
      reconcile: reconcileDeliveredOrder,
    }),
    /SQLite|integrity|orders/,
  );
});

test('apply rejects a SQLite backup without the orders table', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-backfill-missing-orders-'));
  const backupPath = path.join(tempDir, 'shop.db.backup');
  const backupDb = new Database(backupPath);
  backupDb.exec('CREATE TABLE metadata (key TEXT PRIMARY KEY)');
  backupDb.close();
  const originalBackup = process.env.TWOFA_BACKFILL_BACKUP;
  process.env.TWOFA_BACKFILL_BACKUP = backupPath;
  t.after(() => {
    if (originalBackup === undefined) delete process.env.TWOFA_BACKFILL_BACKUP;
    else process.env.TWOFA_BACKFILL_BACKUP = originalBackup;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await assert.rejects(
    runBackfill({
      apply: true,
      register: false,
      db: memoryDb,
      reconcile: reconcileDeliveredOrder,
    }),
    /orders/,
  );
});

test('apply rejects using the target database itself as backup', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-backfill-same-target-'));
  const targetPath = path.join(tempDir, 'shop.db');
  createValidBackup(targetPath);
  const originalBackup = process.env.TWOFA_BACKFILL_BACKUP;
  process.env.TWOFA_BACKFILL_BACKUP = targetPath;
  t.after(() => {
    if (originalBackup === undefined) delete process.env.TWOFA_BACKFILL_BACKUP;
    else process.env.TWOFA_BACKFILL_BACKUP = originalBackup;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await assert.rejects(
    runBackfill({
      apply: true,
      register: false,
      db: memoryDb,
      reconcile: reconcileDeliveredOrder,
      databasePath: targetPath,
    }),
    /khác database target/,
  );
});

test('apply is idempotent, skips non-delivered orders and leaves duplicate UURL as conflict', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-backfill-'));
  const backupPath = path.join(tempDir, 'shop.db.backup');
  createValidBackup(backupPath);
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

test('register apply materializes all conflicts before POST and skips the shared UURL', async (t) => {
  memoryDb.prepare('DELETE FROM twofa_order_bindings').run();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-backfill-two-phase-'));
  const backupPath = path.join(tempDir, 'shop.db.backup');
  createValidBackup(backupPath);
  const originalBackup = process.env.TWOFA_BACKFILL_BACKUP;
  const originalFetch = global.fetch;
  const originalUrl = config.TWOFA_INTERNAL_URL;
  const originalSecret = config.TWOFA_TMA_SHARED_SECRET;
  process.env.TWOFA_BACKFILL_BACKUP = backupPath;
  config.TWOFA_INTERNAL_URL = 'https://twofa.example.test';
  config.TWOFA_TMA_SHARED_SECRET = 'shared-secret';
  const phases = [];
  const postedUurls = [];
  global.fetch = async (_url, options) => {
    postedUurls.push(JSON.parse(options.body.toString()).uurl);
    return new Response(
      JSON.stringify({ success: true, data: { status: 'active' } }),
      { status: 200 },
    );
  };
  t.after(() => {
    if (originalBackup === undefined) delete process.env.TWOFA_BACKFILL_BACKUP;
    else process.env.TWOFA_BACKFILL_BACKUP = originalBackup;
    global.fetch = originalFetch;
    config.TWOFA_INTERNAL_URL = originalUrl;
    config.TWOFA_TMA_SHARED_SECRET = originalSecret;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const report = await runBackfill({
    apply: true,
    register: true,
    db: memoryDb,
    reconcile: async (orderId, options) => {
      phases.push({ orderId, register: options.register });
      return reconcileDeliveredOrder(orderId, options);
    },
  });

  assert.deepStrictEqual(phases, [
    { orderId: firstOrderId, register: false },
    { orderId: secondOrderId, register: false },
    { orderId: firstOrderId, register: true },
  ]);
  assert.deepStrictEqual(postedUurls, [uniqueUurl]);
  assert.ok(!postedUurls.includes(sharedUurl));
  assert.strictEqual(report.active, 1);
});

test('production dry-run does not create sidecars beside a WAL-mode source database', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-backfill-readonly-'));
  const tempDbPath = path.join(tempDir, 'shop.db');
  const tempDb = new Database(tempDbPath);
  tempDb.pragma('journal_mode = WAL');
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
  tempDb.pragma('wal_checkpoint(TRUNCATE)');
  tempDb.close();
  const before = snapshotDirectory(tempDir);
  assert.deepStrictEqual(before.map(entry => entry.name), ['shop.db']);
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const child = runDryRunChild(tempDbPath);

  assert.strictEqual(child.status, 0, child.stderr);
  assert.strictEqual(JSON.parse(child.stdout).deliveredOrders, 1);
  assert.deepStrictEqual(snapshotDirectory(tempDir), before);
});

test('production dry-run snapshot includes delivered rows not checkpointed from WAL', (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twofa-backfill-wal-'));
  const tempDbPath = path.join(tempDir, 'shop.db');
  const writerDb = new Database(tempDbPath);
  writerDb.pragma('journal_mode = WAL');
  writerDb.exec(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      status TEXT NOT NULL,
      delivered_keys_json TEXT
    )
  `);
  writerDb.pragma('wal_checkpoint(TRUNCATE)');
  writerDb.pragma('wal_autocheckpoint = 0');
  writerDb.prepare(`
    INSERT INTO orders (id, status, delivered_keys_json)
    VALUES (1, 'delivered', ?)
  `).run(JSON.stringify([`https://order.subhub.vn/wal-${suffix}`]));
  const before = snapshotDirectory(tempDir);
  assert.ok(before.some(entry => entry.name === 'shop.db-wal'));
  t.after(() => {
    writerDb.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const child = runDryRunChild(tempDbPath);

  assert.strictEqual(child.status, 0, child.stderr);
  assert.strictEqual(JSON.parse(child.stdout).deliveredOrders, 1);
  assert.strictEqual(JSON.parse(child.stdout).validLinks, 1);
  assert.deepStrictEqual(snapshotDirectory(tempDir), before);
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
